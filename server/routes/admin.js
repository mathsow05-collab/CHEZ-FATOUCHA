/* Espace administrateur (CHEZ FATOUCHA). Token JWT en Bearer, rôle admin uniquement. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const multer = require('multer');

const { db, getSetting, setSetting, allSettings, addLog, STOCK_STATUTS_ACTIFS } = require('../db');
const { hashPassword, verifyPassword, signToken, verifyToken, rateLimiter, normalizePhone } = require('../security');
const {
  produitPublic, listeVariantes, majStock, balayageCommandesImpayees, parseJson,
  preparerSlug, ecrireGuide, lireGuide, resumeAvis,
} = require('../catalogue');
const optima = require('../optima');
const paiement = require('../paiement');
const scrape = require('../scrape');
const videos = require('../videos');

const { UPLOADS_DIR } = require('../paths');
const IMG_DIR = path.join(UPLOADS_DIR, 'produits');
fs.mkdirSync(IMG_DIR, { recursive: true });

const router = express.Router();

/* ---------------- Auth ---------------- */
const loginLimiter = rateLimiter({ max: 8, windowMs: 10 * 60_000, message: 'Trop de tentatives : attends 10 minutes.' });

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!a || !verifyPassword(password, a.password_hash)) {
    addLog('login_echoue', { source: 'admin', ref: String(username || '').slice(0, 30), req });
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }
  const token = signToken({ sub: a.id, role: 'admin', username: a.username }, 12 * 3600);
  addLog('login_ok', { source: 'admin', ref: a.username, req });
  return res.json({ token, admin: { id: a.id, username: a.username, display_name: a.display_name } });
});

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion admin requise.' });
  }
  const admin = db.prepare('SELECT id, username, display_name FROM admins WHERE id = ?').get(payload.sub);
  if (!admin) return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Compte admin introuvable.' });
  req.admin = admin;
  return next();
}

router.use(requireAdmin);

router.get('/moi', (req, res) => res.json({ admin: req.admin, paiement_mode: paiement.mode(), cinetpay: paiement.cinetpayActif() }));

router.post('/password', (req, res) => {
  const { ancien, nouveau } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!verifyPassword(ancien, a.password_hash)) return res.status(400).json({ error: 'Ancien mot de passe incorrect.' });
  if (String(nouveau || '').length < 8) return res.status(400).json({ error: 'Nouveau mot de passe : 8 caractères minimum.' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(nouveau), a.id);
  addLog('mot_de_passe_change', { source: 'admin', ref: a.username, req });
  return res.json({ ok: true });
});

/* ---------------- Tableau de bord ---------------- */
router.get('/dashboard', (req, res) => {
  balayageCommandesImpayees();
  const jour = new Date(Date.now() - 86400_000).toISOString();
  const semaine = new Date(Date.now() - 7 * 86400_000).toISOString();
  const somme = (sql, ...args) => db.prepare(sql).get(...args)?.n || 0;
  res.json({
    ca_jour: somme("SELECT SUM(total) AS n FROM commandes WHERE statut_paiement='paye' AND COALESCE(payee_le, created_at) >= ?", jour),
    ca_semaine: somme("SELECT SUM(total) AS n FROM commandes WHERE statut_paiement='paye' AND COALESCE(payee_le, created_at) >= ?", semaine),
    ca_total: somme("SELECT SUM(total) AS n FROM commandes WHERE statut_paiement='paye'"),
    commandes_a_payer: db.prepare("SELECT COUNT(*) AS n FROM commandes WHERE statut='nouvelle' AND statut_paiement='en_attente'").get().n,
    commandes_a_preparer: db.prepare("SELECT COUNT(*) AS n FROM commandes WHERE statut IN ('payee','en_preparation')").get().n,
    commandes_en_route: db.prepare("SELECT COUNT(*) AS n FROM commandes WHERE statut='expediee'").get().n,
    produits_actifs: db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1').get().n,
    produits_rupture: db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1 AND stock <= 0').get().n,
    stock_faible: db
      .prepare('SELECT id, titre, stock FROM produits WHERE actif = 1 AND stock > 0 AND stock <= 3 ORDER BY stock LIMIT 12')
      .all(),
    derniers_commandes: db
      .prepare('SELECT id, reference, client, telephone, total, statut, statut_paiement, paiement, mode, created_at FROM commandes ORDER BY id DESC LIMIT 10')
      .all(),
    top_produits: db
      .prepare(
        `SELECT l.produit_id AS id, l.titre, SUM(l.quantite) AS vendus, SUM(l.total_ligne) AS ca
           FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id
          WHERE c.statut_paiement = 'paye'
          GROUP BY l.produit_id ORDER BY ca DESC LIMIT 8`
      )
      .all(),
    paiement_mode: paiement.mode(),
    avis_en_attente: db.prepare('SELECT COUNT(*) AS n FROM avis WHERE approuve = 0').get().n,
    avis_total: db.prepare('SELECT COUNT(*) AS n FROM avis WHERE approuve = 1').get().n,
    alertes_stock: db.prepare('SELECT COUNT(*) AS n FROM alertes_stock WHERE notifie_le IS NULL').get().n,
    commandes_a_confirmer: db
      .prepare("SELECT COUNT(*) AS n FROM commandes WHERE paiement = 'especes' AND client_confirme_le IS NULL AND statut = 'nouvelle'")
      .get().n,
    paniers_en_attente: db
      .prepare("SELECT COUNT(*) AS n FROM paniers WHERE total > 0 AND updated_at > datetime('now','-3 days')")
      .get().n,
  });
});

/* ---------------- Produits ---------------- */
const COLONNES = {
  titre: 'p.titre',
  prix: 'p.prix',
  stock: 'p.stock',
  created_at: 'p.created_at',
  vues: 'p.vues',
};

router.get('/produits', (req, res) => {
  const { q, categorie, etat = 'tous', tri = 'recent' } = req.query;
  const where = [];
  const args = [];
  if (q) {
    where.push('(p.titre LIKE ? OR p.marque LIKE ? OR p.description LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categorie) {
    where.push('p.categorie_id = ?');
    args.push(Number(categorie));
  }
  if (etat === 'actifs') where.push('p.actif = 1');
  if (etat === 'inactifs') where.push('p.actif = 0');
  if (etat === 'rupture') where.push('p.stock <= 0');
  const sql = `SELECT p.*, c.name AS categorie_nom FROM produits p LEFT JOIN categories c ON c.id = p.categorie_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${COLONNES[tri] || 'p.id DESC'} ${tri === 'prix' || tri === 'vues' ? 'DESC' : ''}`;
  const rows = db.prepare(sql).all(...args);
  const qReserve = db.prepare(
    `SELECT COALESCE(SUM(l.quantite), 0) AS n FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id
      WHERE l.produit_id = ? AND c.statut IN (${STOCK_STATUTS_ACTIFS.map(() => '?').join(',')})`
  );
  res.json(
    rows.map((r) => ({
      ...produitPublic(r),
      actif: !!r.actif,
      /* trois champs que la boutique garde pour elle : prix d'achat, lien du
         fournisseur, marque / origine de la pièce. `produitPublic` ne les envoie
         jamais à la cliente — c'est ici qu'ils reviennent, côté vendeur. */
      marque: r.marque || '',
      prix_achat: r.prix_achat,
      lien_source: r.lien_source || '',
      /* la miniature recopiée pour la vidéo : utile au formulaire pour qu'il la
         renvoie tel quel à l'enregistrement (sinon elle sauterait à chaque modif) */
      video_miniature: r.video_miniature || '',
      updated_at: r.updated_at,
      reserve: qReserve.get(r.id, ...STOCK_STATUTS_ACTIFS).n,
    }))
  );
});

/* Vidéo de fiche : fichier téléversé sur le site, ou lien externe (TikTok/
   YouTube) que la cliente ouvre dans un onglet — on n'encastre pas un lecteur
   tiers dans la page (préférence explicite de la politique de sécurité). */
/* Une seule règle pour savoir si un lien vaut quelque chose : celle du module qui
   le reconnaît — sinon l'aperçu du formulaire accepterait ce que l'enregistrement
   refuse (ou l'inverse), et ce serait le champ lui-même qui ment. */
function nettoyerVideo(v) {
  const brut = String(v || '').trim();
  if (!brut) return null;
  return videos.analyser(brut).ok ? brut.slice(0, 400) : null;
}

/* La miniature n'est pas une URL libre : soit un fichier que le site a recopié
   lui-même, rien d'autre (sinon le champ servirait à pister les visiteuses). */
function nettoyerMiniatureVideo(v) {
  const brut = String(v || '').trim();
  if (!brut) return null;
  return /^\/uploads\/[a-z0-9._\/-]+\.(jpe?g|png|webp|avif)$/i.test(brut) ? brut.slice(0, 400) : null;
}

function nettoyerProduit(b) {
  const prix = Math.round(Number(b.prix));
  const errs = [];
  if (!String(b.titre || '').trim()) errs.push('Le titre est obligatoire.');
  if (!Number.isFinite(prix) || prix < 50 || prix > 10_000_000) errs.push('Prix invalide (50 à 10 000 000 FCFA).');
  const images = (Array.isArray(b.images) ? b.images : [])
    .filter((i) => i && (i.url || i))
    .map((i, idx) => ({
      url: String(typeof i === 'string' ? i : i.url).slice(0, 600),
      from_url: typeof i === 'object' && i.from_url ? String(i.from_url).slice(0, 600) : null,
      legende: typeof i === 'object' && i.legende ? String(i.legende).slice(0, 120) : null,
      is_main: typeof i === 'object' ? (idx === 0 ? 1 : i.is_main ? 1 : 0) : idx === 0 ? 1 : 0,
    }))
    .slice(0, 12);
  return {
    errs,
    valeurs: {
      titre: String(b.titre).trim().slice(0, 140),
      description: String(b.description || '').trim().slice(0, 3000),
      prix,
      prix_barre: b.prix_barre ? Math.round(Number(b.prix_barre)) : null,
      prix_achat: b.prix_achat ? Math.round(Number(b.prix_achat)) : null,
      marque: String(b.marque || '').trim().slice(0, 60) || null,
      lien_source: String(b.lien_source || '').trim().slice(0, 600) || null,
      delai_jours: Math.min(120, Math.max(0, Math.round(Number(b.delai_jours) || 7))),
      /* Une vidéo de 5 secondes qui montre le tissu qui bouge vend mieux que
         trois photos fixes ; soit un fichier du site, soit un lien externe. */
      video_url: nettoyerVideo(b.video_url),
      video_miniature: nettoyerMiniatureVideo(b.video_miniature),
      mannequin: String(b.mannequin || '').trim().slice(0, 160) || null,
      guide_tailles: ecrireGuide(b.guide_tailles),
      images: JSON.stringify(images),
      tailles: JSON.stringify((Array.isArray(b.tailles) ? b.tailles : []).map((s) => String(s).slice(0, 20)).slice(0, 15)),
      coloris: JSON.stringify((Array.isArray(b.coloris) ? b.coloris : []).map((s) => String(s).slice(0, 30)).slice(0, 15)),
      stock: Math.min(9999, Math.max(0, Math.round(Number(b.stock) || 0))),
      categorie_id: b.categorie_id ? Number(b.categorie_id) : null,
      actif: b.actif === false || b.actif === 0 || b.actif === '0' ? 0 : 1,
      vedette: b.vedette ? 1 : 0,
    },
  };
}

router.post('/produits', (req, res) => {
  const { errs, valeurs } = nettoyerProduit(req.body || {});
  const b = req.body || {};
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  const valeurs2 = {
    ...valeurs,
    slug: preparerSlug(valeurs.titre, null, b?.slug || ''),
    video_url: valeurs.video_url,
    mannequin: valeurs.mannequin,
    guide_tailles: valeurs.guide_tailles,
  };
  /* Nommé, pas positionnel : l'ordre des clés d'un objet spread n'est pas celui
     des colonnes, et un décalage d'une colonne écraserait silencieusement les photos. */
  const r = db
    .prepare(
      `INSERT INTO produits (titre, description, prix, prix_barre, prix_achat, marque, lien_source, delai_jours,
        images, tailles, coloris, stock, categorie_id, actif, vedette, slug, video_url, video_miniature,
        mannequin, guide_tailles)
       VALUES (@titre,@description,@prix,@prix_barre,@prix_achat,@marque,@lien_source,@delai_jours,
        @images,@tailles,@coloris,@stock,@categorie_id,@actif,@vedette,@slug,@video_url,@video_miniature,@mannequin,@guide_tailles)`
    )
    .run(valeurs2);
  appliquerVariantes(Number(r.lastInsertRowid), req.body);
  addLog('produit_cree', { source: 'admin', ref: valeurs.titre, req });
  const cree = db.prepare('SELECT id, slug FROM produits WHERE id = ?').get(Number(r.lastInsertRowid));
  return res.status(201).json({ id: cree.id, slug: cree.slug, url: '/produit/' + cree.slug });
});

/* Corps de mise à jour : ce que la boutique n'a pas envoyé reste inchangé.
   Sans ça, un PUT partiel (script, import, vieux formulaire) effacerait les
   photos, le guide des tailles ou la ligne « portée par ». */
function pourMaj(avant) {
  if (!avant) return {};
  return {
    titre: avant.titre,
    description: avant.description,
    prix: avant.prix,
    prix_barre: avant.prix_barre,
    prix_achat: avant.prix_achat,
    marque: avant.marque,
    lien_source: avant.lien_source,
    delai_jours: avant.delai_jours,
    images: parseJson(avant.images, []),
    tailles: parseJson(avant.tailles, []),
    coloris: parseJson(avant.coloris, []),
    stock: avant.stock,
    categorie_id: avant.categorie_id,
    actif: !!avant.actif,
    vedette: !!avant.vedette,
    video_url: avant.video_url || '',
    video_miniature: avant.video_miniature || '',
    mannequin: avant.mannequin || '',
    /* décodé puis renvoyé tel quel : nettoyerProduit le relit, et le guide ne
       doit pas disparaître quand on ne modifie qu'un prix ou un lien vidéo */
    guide_tailles: lireGuide(avant.guide_tailles),
    slug: avant.slug,
  };
}

router.put('/produits/:id', (req, res) => {
  const id = Number(req.params.id);
  const avantComplet = db.prepare('SELECT * FROM produits WHERE id = ?').get(id);
  if (!avantComplet) return res.status(404).json({ error: 'Produit introuvable.' });
  const corps = { ...pourMaj(avantComplet), ...(req.body || {}) };
  const { errs, valeurs } = nettoyerProduit(corps);
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  const avant = db.prepare('SELECT stock, slug FROM produits WHERE id = ?').get(id);
  db.prepare(
    `UPDATE produits SET titre=@titre, description=@description, prix=@prix, prix_barre=@prix_barre, prix_achat=@prix_achat,
       marque=@marque, lien_source=@lien_source, delai_jours=@delai_jours, images=@images, tailles=@tailles, coloris=@coloris,
       stock=@stock, categorie_id=@categorie_id, actif=@actif, vedette=@vedette, slug=@slug, video_url=@video_url,
       video_miniature=@video_miniature,
       mannequin=@mannequin, guide_tailles=@guide_tailles, updated_at=@updated_at WHERE id=@id`
  ).run({
    ...valeurs,
    id,
    slug: preparerSlug(valeurs.titre, id, corps.slug || ''),
    updated_at: new Date().toISOString(),
  });
  alerteRetourEnStock(id, avant?.stock ?? 0, valeurs.stock);
  syncVariantes(id, req.body);
  addLog('produit_modifie', { source: 'admin', ref: String(id), req });
  return res.json({ ok: true });
});

router.patch('/produits/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const maj = [];
  const args = [];
  if ('actif' in b) { maj.push('actif = ?'); args.push(b.actif ? 1 : 0); }
  if ('vedette' in b) { maj.push('vedette = ?'); args.push(b.vedette ? 1 : 0); }
  if ('stock' in b) {
    const nouveau = Math.max(0, Math.round(Number(b.stock) || 0));
    const avant = db.prepare('SELECT stock FROM produits WHERE id = ?').get(id)?.stock ?? 0;
    maj.push('stock = ?');
    args.push(nouveau);
    setTimeout(() => alerteRetourEnStock(id, avant, nouveau), 0);
  }
  if ('prix' in b) { maj.push('prix = ?'); args.push(Math.round(Number(b.prix))); }
  if ('delai_jours' in b) { maj.push('delai_jours = ?'); args.push(Math.round(Number(b.delai_jours) || 0)); }
  if (!maj.length) return res.status(400).json({ error: 'Rien à modifier.' });
  maj.push('updated_at = ?');
  args.push(new Date().toISOString(), id);
  db.prepare(`UPDATE produits SET ${maj.join(', ')} WHERE id = ?`).run(...args);
  return res.json({ ok: true });
});

router.delete('/produits/:id', (req, res) => {
  const id = Number(req.params.id);
  const dur = req.query.dur === '1';
  if (dur) {
    db.prepare('DELETE FROM produits WHERE id = ?').run(id);
    addLog('produit_supprime', { source: 'admin', ref: String(id), req });
    return res.json({ ok: true, dur: true });
  }
  db.prepare("UPDATE produits SET actif = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  addLog('produit_deactive', { source: 'admin', ref: String(id), req });
  return res.json({ ok: true, message: 'Produit masqué du catalogue (les commandes en cours sont conservées).' });
});

/* Variantes.
   - Le formulaire admin envoie `variantes: [{taille, coloris, stock}]` → on reconstruit et
     le stock global devient la somme des variantes (source de vérité).
   - Si seules tailles/coloris changent → produit cartésien en conservant le stock existant
     (une nouvelle combinaison démarre à 0, à l'admin de la remplir). */
function appliquerVariantes(produitId, b) {
  if (!b) return;
  const v = Array.isArray(b.variantes) ? b.variantes : null;
  if (!v) return;
  db.prepare('DELETE FROM variantes WHERE produit_id = ?').run(produitId);
  const ins = db.prepare('INSERT INTO variantes (produit_id, taille, coloris, stock) VALUES (?,?,?,?)');
  for (const x of v.slice(0, 80)) {
    ins.run(
      produitId,
      x.taille ? String(x.taille).slice(0, 20) : null,
      x.coloris ? String(x.coloris).slice(0, 30) : null,
      Math.max(0, Math.min(9999, Math.round(Number(x.stock) || 0)))
    );
  }
  db.prepare('UPDATE produits SET stock = ? WHERE id = ?').run(recalculerStockGlobal(produitId), produitId);
}

function syncVariantes(produitId, b) {
  if (Array.isArray(b?.variantes)) return appliquerVariantes(produitId, b);
  if (!b || (b.tailles === undefined && b.coloris === undefined)) return;
  const p = db.prepare('SELECT tailles, coloris FROM produits WHERE id = ?').get(produitId);
  const tailles = parseJson(p.tailles);
  const coloris = parseJson(p.coloris);
  const avant = new Map(listeVariantes(produitId).map((v) => [`${v.taille || ''}|${v.coloris || ''}`, v.stock]));
  db.prepare('DELETE FROM variantes WHERE produit_id = ?').run(produitId);
  const ins = db.prepare('INSERT INTO variantes (produit_id, taille, coloris, stock) VALUES (?,?,?,?)');
  const ts = tailles.length ? tailles : [null];
  const cs = coloris.length ? coloris : [null];
  for (const t of ts) for (const c of cs) {
    if (!t && !c) continue;
    ins.run(produitId, t, c, avant.get(`${t || ''}|${c || ''}`) ?? 0);
  }
  if (avant.size || ts.length * cs.length > 1) {
    db.prepare('UPDATE produits SET stock = ? WHERE id = ?').run(recalculerStockGlobal(produitId), produitId);
  }
}

/* Quand une rupture revient en stock, on prépare la liste des clientes abonnées
   (le message WhatsApp se clique une par une : c'est le canal qui marche ici) et
   on marque l'alerte comme traitée pour qu'elle ne revienne pas. */
function alerteRetourEnStock(produitId, avant, apres) {
  if (!(Number(avant) <= 0 && Number(apres) > 0)) return;
  const n = db
    .prepare("UPDATE alertes_stock SET notifie_le = ? WHERE produit_id = ? AND notifie_le IS NULL")
    .run(new Date().toISOString(), produitId).changes;
  if (n) addLog('retour_stock', { source: 'admin', ref: String(produitId), details: `${n} alerte(s) à prévenir` });
}

function recalculerStockGlobal(produitId) {
  const n = db.prepare('SELECT COALESCE(SUM(stock),0) AS n FROM variantes WHERE produit_id = ?').get(produitId).n;
  return Number(n);
}

/* Récupère une URL produit (SHEIN/Temu/Jumia…) : titre, prix affiché et — surtout —
   les photos, qui sont RAPATRIÉES dans /uploads pour devenir des visuels du site.
   Le site d'origine bloque souvent la lecture : on renvoie alors ce qu'on a trouvé,
   sans erreur, et l'admin complète à la main. */
router.post('/produits/importer-url', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Colle une URL commençant par http.' });
  let info;
  try {
    info = await scrape.lireUrl(url);
  } catch (e) {
    return res.status(422).json({
      error: 'Lecture impossible sur ce site (' + (e.message || 'blocage') + '). Téléverse tes propres photos : c’est plus rapide.',
      images: [],
      images_locales: [],
    });
  }
  const locales = [];
  const echecs = [];
  for (const im of (info.images || []).slice(0, Number(req.body?.max || 6))) {
    try {
      locales.push(await optima.reduire(IMG_DIR, await scrape.telechargerImage(im, IMG_DIR)));
    } catch (e) {
      echecs.push(e.message);
    }
  }
  locales.forEach((n) => require('../rechauffage').apresUpload('/uploads/produits/' + n));
  addLog('import_url', { source: 'admin', ref: String(req.admin.username), details: `${url} -> ${locales.length} image(s)`, req });
  return res.json({
    titre: info.titre,
    description: info.description,
    prix: info.prix,
    devise: info.devise,
    lien: url,
    images: locales.map((n) => ({ url: `/uploads/produits/${n}` })),
    distant_trouve: (info.images || []).length,
    message: locales.length
      ? `${locales.length} photo(s) récupérée(s) et enregistrées sur le site.`
      : 'Photos protégées par le site : téléverse-les depuis ton téléphone (capture d’écran OK).',
  });
});

/* Même rapatriement, mais pour des URLs d’images directes (boutique qui envoie plusieurs liens). */
router.post('/images-from-url', async (req, res) => {
  const urls = (Array.isArray(req.body?.urls) ? req.body.urls : []).slice(0, 12);
  if (!urls.length) return res.status(400).json({ error: 'Aucune URL fournie.' });
  const urls_ok = [];
  const erreurs = [];
  for (const u of urls) {
    if (!/^https?:\/\//i.test(String(u))) { erreurs.push('URL invalide : ' + String(u).slice(0, 40)); continue; }
    try {
      const nom = await optima.reduire(IMG_DIR, await scrape.telechargerImage(String(u), IMG_DIR));
      urls_ok.push('/uploads/produits/' + nom);
    } catch (e) {
      erreurs.push(e.message || 'échec');
    }
  }
  urls_ok.forEach((u) => require('../rechauffage').apresUpload(u));
  if (!urls_ok.length) return res.status(422).json({ error: 'Aucune image récupérée. ' + (erreurs[0] || ''), erreurs });
  return res.json({ urls: urls_ok, erreurs });
});

/* Upload de photos (multer, disque local → sur Render : monter un disque persistant). */
const stocker = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMG_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext) ? ext : '.jpg'}`);
  },
});
const upload = multer({
  storage: stocker,
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype)) {
      return cb(new Error('Formats acceptés : JPG, PNG, WEBP, GIF, AVIF.'));
    }
    return cb(null, true);
  },
});

/* Une photo de téléphone fait 3 à 5 Mo. On la ramène à 1200 px en WebP tout de
   suite : le disque de l'hébergeur est petit, et les tailles plus petites
   (vignettes) sont fabriquées à la demande par la route /img. */
router.post('/upload', upload.array('files', 10), async (req, res) => {
  const recus = req.files || [];
  if (!recus.length) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  const urls = [];
  let gagner = 0;
  for (const f of recus) {
    const nom = await optima.reduire(IMG_DIR, f.filename);
    const octets = fs.existsSync(path.join(IMG_DIR, nom)) ? fs.statSync(path.join(IMG_DIR, nom)).size : 0;
    gagner += Math.max(0, f.size - octets);
    urls.push(`/uploads/produits/${nom}`);
  }
  /* les vignettes se préparent derrière la réponse : la fiche sera prête avant
     la première visite, au lieu d'encoder pendant qu'elle attend */
  urls.forEach((u) => require('../rechauffage').apresUpload(u));
  addLog('upload_images', { source: 'admin', ref: String(req.admin.username), details: urls.join(' ') });
  return res.json({ urls, economise_ko: Math.round(gagner / 1024) });
});

/* Reconnaître le lien de vidéo collé par la vendeuse : ce qu'on sait l'intégrer,
   son format, et — pour YouTube — la miniature recopiée dans nos dossiers.
   Rien n'est enregistré ici : la fiche est écrite quand le formulaire est validé,
   et la miniature revient avec lui dans `video_miniature`. */
router.post('/video-info', async (req, res) => {
  const brut = String(req.body?.url || '').trim();
  let a = videos.analyser(brut);
  /* un lien raccourci (le « Partager » du téléphone) est déroulé ici : c'est le
     seul moment où on attend quelqu'un d'autre, et c'est le vendeur qui le
     déclenche. L'adresse complète repart dans le formulaire, donc ce qui est en
     base est l'adresse stable, pas le raccourci. */
  let resolution = null;
  if (a.ok && a.fournisseur === 'raccourci') {
    const r = await videos.resoudre(brut);
    const second = videos.analyser(r.url);
    if (second.ok && second.fournisseur !== 'raccourci') {
      a = second;
      resolution = r.url;
    }
  }
  if (!a.ok) return res.status(422).json({ error: a.erreur });
  const reponse = {
    ok: true,
    url: a.page,
    url_remplacee: resolution,
    fournisseur: a.fournisseur,
    etiquette: a.etiquette,
    page: a.page,
    format: a.format,
    integrateur: a.local ? 'fichier' : a.cadre ? 'cadre' : 'lien',
    miniatures: [],
    miniature_site: null,
  };
  if (a.miniature) {
    /* trois tailles de la miniature, pour que la galerie n'attende pas un tiers */
    reponse.miniatures = [a.miniature];
    try {
      const nom = await optima.reduire(IMG_DIR, await scrape.telechargerImage(a.miniature, IMG_DIR));
      reponse.miniature_site = '/uploads/produits/' + nom;
      require('../rechauffage').apresUpload(reponse.miniature_site);
    } catch (e) {
      reponse.avertissement = 'Miniature non récupérée (' + String(e.message || 'échec').slice(0, 60) + ') : celle de ' + a.etiquette + ' sera utilisée.';
    }
  }
  return res.json(reponse);
});

/* Vidéo de fiche (5 à 10 s suffisent) : mp4/webm, 20 Mo max, même dossier. */
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMG_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${(path.extname(file.originalname) || '.mp4').toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/^video\/(mp4|webm|quicktime)$/i.test(file.mimetype) ? cb(null, true) : cb(new Error('Format vidéo accepté : MP4 ou WEBM.'))),
});
router.post('/upload-video', uploadVideo.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune vidéo reçue.' });
  addLog('upload_video', { source: 'admin', ref: String(req.admin.username), details: req.file.filename });
  return res.json({ url: `/uploads/produits/${req.file.filename}`, octets: req.file.size });
});

/* ---------------- Catégories & zones ---------------- */
router.get('/categories', (req, res) => {
  res.json(
    db.prepare('SELECT c.*, (SELECT COUNT(*) FROM produits p WHERE p.categorie_id = c.id AND p.actif=1) AS n FROM categories c ORDER BY c.ordre, c.name').all()
  );
});
router.post('/categories', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Nom requis.' });
  const r = db.prepare('INSERT INTO categories (name, emoji, ordre) VALUES (?,?,?)').run(name, String(req.body?.emoji || '🛍️').slice(0, 8), Number(req.body?.ordre) || 99);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
router.put('/categories/:id', (req, res) => {
  db.prepare('UPDATE categories SET name = ?, emoji = ?, ordre = ? WHERE id = ?').run(
    String(req.body?.name || '').trim().slice(0, 40) || 'Sans nom',
    String(req.body?.emoji || '🛍️').slice(0, 8),
    Number(req.body?.ordre) || 0,
    Number(req.params.id)
  );
  res.json({ ok: true });
});
router.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/zones', (req, res) => res.json(db.prepare('SELECT * FROM zones_livraison ORDER BY ordre, frais').all()));
router.post('/zones', (req, res) => {
  const b = req.body || {};
  const r = db.prepare('INSERT INTO zones_livraison (nom, ville, frais, delai_heures, actif, ordre) VALUES (?,?,?,?,?,?)').run(
    String(b.nom || '').trim().slice(0, 120) || 'Nouvelle zone',
    String(b.ville || 'Dakar').trim().slice(0, 40),
    Math.max(0, Math.round(Number(b.frais) || 0)),
    Math.max(1, Math.round(Number(b.delai_heures) || 24)),
    b.actif === 0 ? 0 : 1,
    Number(b.ordre) || 99
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
router.put('/zones/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE zones_livraison SET nom=?, ville=?, frais=?, delai_heures=?, actif=?, ordre=? WHERE id=?').run(
    String(b.nom || '').trim().slice(0, 120) || 'Zone',
    String(b.ville || 'Dakar').trim().slice(0, 40),
    Math.max(0, Math.round(Number(b.frais) || 0)),
    Math.max(1, Math.round(Number(b.delai_heures) || 24)),
    b.actif ? 1 : 0,
    Number(b.ordre) || 0,
    Number(req.params.id)
  );
  res.json({ ok: true });
});
router.delete('/zones/:id', (req, res) => {
  db.prepare('DELETE FROM zones_livraison WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- Commandes ---------------- */
const STATUTS = ['nouvelle', 'payee', 'en_preparation', 'expediee', 'livree', 'annulee'];

router.get('/commandes', (req, res) => {
  balayageCommandesImpayees();
  const { statut, q, depuis } = req.query;
  const where = [];
  const args = [];
  if (statut && statut !== 'toutes') {
    where.push('c.statut = ?');
    args.push(statut);
  }
  if (q) {
    where.push('(c.reference LIKE ? OR c.client LIKE ? OR c.telephone LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${normalizePhone(q)}%`);
  }
  if (depuis) {
    where.push('c.created_at >= ?');
    args.push(String(depuis));
  }
  const rows = db
    .prepare(
      `SELECT c.*, z.nom AS zone_nom, z.delai_heures AS zone_delai,
              (SELECT COUNT(*) FROM commande_lignes l WHERE l.commande_id = c.id) AS nb_lignes,
              (SELECT COALESCE(SUM(quantite),0) FROM commande_lignes l WHERE l.commande_id = c.id) AS nb_articles
         FROM commandes c LEFT JOIN zones_livraison z ON z.id = c.zone_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.id DESC LIMIT 200`
    )
    .all(...args);
  res.json(rows);
});

router.get('/commandes/:id', (req, res) => {
  const c = db.prepare('SELECT c.*, z.nom AS zone_nom, z.frais AS zone_frais, z.delai_heures AS zone_delai FROM commandes c LEFT JOIN zones_livraison z ON z.id = c.zone_id WHERE c.id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  const lignes = db.prepare('SELECT * FROM commande_lignes WHERE commande_id = ?').all(c.id);
  return res.json({ ...c, lignes });
});

router.patch('/commandes/:id', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT * FROM commandes WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  const b = req.body || {};
  const now = new Date().toISOString();
  const maj = [];
  const args = [];

  if (b.statut && STATUTS.includes(b.statut) && b.statut !== c.statut) {
    maj.push('statut = ?');
    args.push(b.statut);
    if (b.statut === 'payee' && c.statut_paiement !== 'paye') {
      maj.push("statut_paiement = 'paye'");
      maj.push('payee_le = ?');
      args.push(now);
      maj.push("prestataire = ?");
      args.push('manuel');
    }
    if (b.statut === 'expediee') { maj.push('expediee_le = ?'); args.push(now); }
    if (b.statut === 'livree') { maj.push('livree_le = ?'); args.push(now); }
    if (b.statut === 'annulee' && c.statut !== 'annulee') {
      maj.push('annulee_le = ?');
      args.push(now);
      // retour du stock réservé
      for (const l of db.prepare('SELECT * FROM commande_lignes WHERE commande_id = ?').all(id)) {
        if (l.produit_id) majStock(l.produit_id, l.taille, l.coloris, l.quantite, +1);
      }
    }
  }
  if ('statut_paiement' in b && ['paye', 'en_attente', 'echoue'].includes(b.statut_paiement)) {
    maj.push('statut_paiement = ?');
    args.push(b.statut_paiement);
    if (b.statut_paiement === 'paye') {
      maj.push('payee_le = ?');
      args.push(now);
      maj.push("statut = CASE WHEN statut = 'nouvelle' THEN 'payee' ELSE statut END");
    }
  }
  if ('paiement' in b && paiement.METHODES[b.paiement]) { maj.push('paiement = ?'); args.push(b.paiement); }
  if ('transaction_id' in b) { maj.push('transaction_id = ?'); args.push(String(b.transaction_id).slice(0, 120)); }
  if ('instructions' in b) { maj.push('instructions = ?'); args.push(String(b.instructions).slice(0, 500)); }

  if (!maj.length) return res.status(400).json({ error: 'Rien à mettre à jour.' });
  args.push(id);
  db.prepare(`UPDATE commandes SET ${maj.join(', ')} WHERE id = ?`).run(...args);
  addLog('commande_maj', { source: 'admin', ref: c.reference, details: JSON.stringify(b).slice(0, 200), req });
  return res.json({ ok: true, commande: db.prepare('SELECT * FROM commandes WHERE id = ?').get(id) });
});

/* Confirmation de paiement manuel (le client a envoyé l'argent). */
router.post('/commandes/:id/payer', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT * FROM commandes WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  paiement.validerCommande(id, { transactionId: String(req.body?.transaction_id || '').slice(0, 120) || null, source: 'admin_manuel' });
  const cmd = db.prepare('SELECT * FROM commandes WHERE id = ?').get(id);
  return res.json({ ok: true, message: `Paiement de ${c.total} FCFA validé pour ${c.reference}.`, commande: cmd });
});

router.get('/commandes-export', (req, res) => {
  const rows = db.prepare('SELECT * FROM commandes ORDER BY id DESC LIMIT 2000').all();
  const entetes = ['reference', 'created_at', 'client', 'telephone', 'mode', 'zone_id', 'adresse', 'sous_total', 'frais', 'total', 'paiement', 'statut_paiement', 'statut', 'payee_le', 'acompte', 'reste_a_payer', 'client_confirme_le'];
  const csv = [entetes.join(',')].concat(
    rows.map((r) => entetes.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="commandes-fatoucha-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv);
});

/* ---------------- Avis : modération et réponses ---------------- */
router.get('/avis', (req, res) => {
  const etat = req.query.etat === 'tous' ? 'tous' : 'en_attente';
  const rows = db
    .prepare(
      `SELECT a.*, p.titre AS produit_titre, p.slug AS produit_slug, c.reference, c.client
         FROM avis a
         LEFT JOIN produits p ON p.id = a.produit_id
         LEFT JOIN commandes c ON c.id = a.commande_id
        ${etat === 'en_attente' ? 'WHERE a.approuve = 0' : ''}
        ORDER BY a.id DESC LIMIT 300`
    )
    .all();
  res.json(rows);
});

router.patch('/avis/:id', (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare('SELECT * FROM avis WHERE id = ?').get(id);
  if (!a) return res.status(404).json({ error: 'Avis introuvable.' });
  const maj = [];
  const args = [];
  if ('approuve' in req.body) { maj.push('approuve = ?'); args.push(req.body.approuve ? 1 : 0); }
  if ('note' in req.body) { maj.push('note = ?'); args.push(Math.max(1, Math.min(5, Math.round(Number(req.body.note) || 5)))); }
  if ('texte' in req.body) { maj.push('texte = ?'); args.push(String(req.body.texte || '').slice(0, 900) || null); }
  if ('reponse' in req.body) { maj.push('reponse = ?'); args.push(String(req.body.reponse || '').slice(0, 600) || null); }
  if (!maj.length) return res.status(400).json({ error: 'Rien à modifier.' });
  args.push(id);
  db.prepare(`UPDATE avis SET ${maj.join(', ')} WHERE id = ?`).run(...args);
  addLog('avis_maj', { source: 'admin', ref: String(id), details: maj.join(','), req });
  return res.json({ ok: true, resume: resumeAvis(a.produit_id) });
});

router.delete('/avis/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM avis WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Avis introuvable.' });
  db.prepare('DELETE FROM avis WHERE id = ?').run(a.id);
  if (a.photo) fs.rmSync(path.join(UPLOADS_DIR, 'avis', path.basename(a.photo)), { force: true });
  addLog('avis_supprime', { source: 'admin', ref: String(a.id), req });
  return res.json({ ok: true });
});

/* ---------------- Pages de contenu (FAQ, retours, livraison) ---------------- */
const PAGES_AUTORISEES = ['faq', 'retours', 'livraison', 'a-propos'];

router.get('/pages', (req, res) => res.json(db.prepare('SELECT * FROM pages ORDER BY slug').all()));
router.get('/pages/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug = ?').get(String(req.params.slug).slice(0, 40));
  if (!p) return res.status(404).json({ error: 'Page introuvable.' });
  res.json(p);
});
router.put('/pages/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  if (!PAGES_AUTORISEES.includes(slug)) return res.status(400).json({ error: `Page inconnue (choix : ${PAGES_AUTORISEES.join(', ')}).` });
  const titre = String(req.body?.titre || '').trim().slice(0, 120) || 'Information';
  const corps = String(req.body?.corps || '').slice(0, 12000);
  const meta = String(req.body?.meta_desc || '').trim().slice(0, 300) || null;
  db.prepare(
    `INSERT INTO pages (slug, titre, corps, meta_desc, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET titre = excluded.titre, corps = excluded.corps, meta_desc = excluded.meta_desc, updated_at = excluded.updated_at`
  ).run(slug, titre, corps, meta, new Date().toISOString());
  addLog('page_maj', { source: 'admin', ref: slug, req });
  return res.json({ ok: true, url: '/' + slug });
});

/* ---------------- Alertes « retour en stock » ---------------- */
router.get('/alertes-stock', (req, res) => {
  res.json(
    db.prepare(
      `SELECT s.id, s.telephone, s.created_at, s.notifie_le, p.id AS produit_id, p.titre, p.slug, p.stock
         FROM alertes_stock s JOIN produits p ON p.id = s.produit_id
        ORDER BY s.notifie_le IS NOT NULL, s.id DESC LIMIT 200`
    ).all()
  );
});
router.post('/alertes-stock/:id/notifie', (req, res) => {
  db.prepare('UPDATE alertes_stock SET notifie_le = ? WHERE id = ?').run(new Date().toISOString(), Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/alertes-stock/:id', (req, res) => {
  db.prepare('DELETE FROM alertes_stock WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- Paniers enregistrés (relance) ---------------- */
router.get('/paniers', (req, res) => {
  const jours = Math.min(30, Number(req.query.jours) || 7);
  const rows = db
    .prepare("SELECT * FROM paniers WHERE total > 0 AND updated_at >= datetime('now', ?) ORDER BY updated_at DESC LIMIT 200")
    .all('-' + jours + ' days');
  res.json(
    rows.map((r) => {
      let lignes = [];
      try { lignes = JSON.parse(r.items || '[]'); } catch { lignes = []; }
      return {
        jeton: r.jeton,
        client: r.client,
        telephone: r.telephone,
        total: r.total,
        nb: lignes.reduce((s, l) => s + (l.quantite || 1), 0),
        articles: lignes.map((l) => db.prepare('SELECT titre, slug FROM produits WHERE id = ?').get(l.produit_id)?.titre || 'article retiré'),
        updated_at: r.updated_at,
        code_reprise: r.code_reprise || null,
        a_deja_commande: r.telephone
          ? db.prepare('SELECT COUNT(*) AS n FROM commandes WHERE telephone = ?').get(String(r.telephone)).n
          : 0,
      };
    })
  );
});

/* ---------------- Entonnoir de vente ---------------- */
router.get('/entonnoir', (req, res) => {
  const jours = Math.min(90, Number(req.query.jours) || 30);
  const depuis = '-' + jours + ' days';
  const compte = (type) => db.prepare("SELECT COUNT(*) AS n FROM evenements WHERE type = ? AND created_at >= datetime('now', ?)").get(type, depuis).n;
  const vusFiche = compte('vue_fiche');
  const ajoutPanier = compte('ajout_panier');
  const ouverture = compte('ouverture_commande');
  const engage = compte('paiement_engage');
  const validees = db.prepare(`SELECT COUNT(*) AS n FROM commandes WHERE created_at >= datetime('now', ?)`).get(depuis).n;
  const payees = db.prepare(`SELECT COUNT(*) AS n FROM commandes WHERE statut_paiement = 'paye' AND created_at >= datetime('now', ?)`).get(depuis).n;
  return res.json({
    jours,
    etapes: [
      { cle: 'fiches_vues', libelle: 'Fiches vues', n: vusFiche },
      { cle: 'paniers', libelle: 'Ajouts au panier', n: ajoutPanier },
      { cle: 'checkout', libelle: 'Commandes commencées', n: ouverture },
      { cle: 'paiements', libelle: 'Paiements engagés', n: engage },
      { cle: 'commandes', libelle: 'Commandes enregistrées', n: validees },
      { cle: 'payees', libelle: 'Commandes payées', n: payees },
    ],
    conversion_fiche_commande: vusFiche ? Math.round((validees / vusFiche) * 1000) / 10 : 0,
    panier_moyen: db.prepare(`SELECT COALESCE(AVG(total),0) AS n FROM commandes WHERE created_at >= datetime('now', ?)`).get(depuis).n,
    top_vus: db
      .prepare(
        `SELECT e.produit_id AS id, p.titre, p.slug, COUNT(*) AS vues
           FROM evenements e LEFT JOIN produits p ON p.id = e.produit_id
          WHERE e.type = 'vue_fiche' AND e.created_at >= datetime('now', ?)
          GROUP BY e.produit_id ORDER BY vues DESC LIMIT 8`
      )
      .all(depuis),
    sans_avis: db
      .prepare('SELECT p.id, p.titre, p.slug FROM produits p WHERE p.actif = 1 AND p.stock > 0 AND NOT EXISTS (SELECT 1 FROM avis a WHERE a.produit_id = p.id AND a.approuve = 1) ORDER BY p.vues DESC LIMIT 8')
      .all(),
  });
});

/* ---------------- Journaux (comprendre ce qui s'est passé) ---------------- */
router.get('/logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 200').all());
});

/* ---------------- Réglages ---------------- */
router.get('/settings', (req, res) => {
  const all = allSettings();
  // Les clés secrètes ne sortent jamais en clair : on renvoie un masque.
  const mask = (v) => (v ? '•'.repeat(Math.min(12, v.length)) + '··' + String(v).slice(-3) : '');
  return res.json({
    ...all,
    cinetpay_api_key: mask(all.cinetpay_api_key),
    cinetpay_api_key_present: !!all.cinetpay_api_key,
    paiement_mode_effectif: paiement.mode(),
  });
});

const SETTINGS_EDITABLE = [
  'nom_boutique', 'slogan', 'boutique_description', 'telephone', 'whatsapp', 'email',
  'adresse_retrait', 'horaires_retrait', 'wave_numero', 'wave_nom', 'orange_numero', 'orange_nom',
  'livraison_gratuite_a_partir', 'caution_pourcentage', 'delai_retrait_heures', 'expiration_commande_h',
  'mode_paiement', 'cinetpay_site_id', 'cinetpay_api_key', 'seo_keywords',
  'cod_acompte_a_partir', 'cod_acompte_montant',
];

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const changes = [];
  for (const k of SETTINGS_EDITABLE) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'livraison_gratuite_a_partir' || k === 'caution_pourcentage' || k === 'delai_retrait_heures' || k === 'expiration_commande_h' || k === 'cod_acompte_a_partir' || k === 'cod_acompte_montant') {
      v = String(Math.max(0, Math.round(Number(v) || 0)));
    }
    if (k === 'mode_paiement' && !['auto', 'manuel', 'hybride'].includes(String(v))) v = 'auto';
    if (k === 'wave_numero' || k === 'orange_numero') v = String(v).trim().slice(0, 20);
    if (String(v).length > 2000) v = String(v).slice(0, 2000);
    setSetting(k, v);
    changes.push(k);
  }
  addLog('settings_maj', { source: 'admin', ref: String(req.admin.username), details: changes.join(','), req });
  return res.json({ ok: true, maj: changes, paiement_mode_effectif: paiement.mode() });
});

module.exports = router;
