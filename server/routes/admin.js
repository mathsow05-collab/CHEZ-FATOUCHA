/* Espace administrateur (CHEZ FATOUCHA). Token JWT en Bearer, rôle admin uniquement. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const multer = require('multer');

const { db, getSetting, setSetting, allSettings, addLog, STOCK_STATUTS_ACTIFS } = require('../db');
const { hashPassword, verifyPassword, signToken, verifyToken, rateLimiter, normalizePhone } = require('../security');
const { produitPublic, listeVariantes, majStock, balayageCommandesImpayees, parseJson } = require('../catalogue');
const paiement = require('../paiement');
const scrape = require('../scrape');

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
      prix_achat: r.prix_achat,
      lien_source: r.lien_source || '',
      updated_at: r.updated_at,
      reserve: qReserve.get(r.id, ...STOCK_STATUTS_ACTIFS).n,
    }))
  );
});

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
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  const r = db
    .prepare(
      `INSERT INTO produits (titre, description, prix, prix_barre, prix_achat, marque, lien_source, delai_jours,
        images, tailles, coloris, stock, categorie_id, actif, vedette) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(...Object.values(valeurs));
  appliquerVariantes(Number(r.lastInsertRowid), req.body);
  addLog('produit_cree', { source: 'admin', ref: valeurs.titre, req });
  return res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.put('/produits/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM produits WHERE id = ?').get(id)) return res.status(404).json({ error: 'Produit introuvable.' });
  const { errs, valeurs } = nettoyerProduit(req.body || {});
  if (errs.length) return res.status(400).json({ error: errs.join(' ') });
  db.prepare(
    `UPDATE produits SET titre=@titre, description=@description, prix=@prix, prix_barre=@prix_barre, prix_achat=@prix_achat,
       marque=@marque, lien_source=@lien_source, delai_jours=@delai_jours, images=@images, tailles=@tailles, coloris=@coloris,
       stock=@stock, categorie_id=@categorie_id, actif=@actif, vedette=@vedette, updated_at=@updated_at WHERE id=@id`
  ).run({ ...valeurs, id, updated_at: new Date().toISOString() });
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
  if ('stock' in b) { maj.push('stock = ?'); args.push(Math.max(0, Math.round(Number(b.stock) || 0))); }
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
      locales.push(await scrape.telechargerImage(im, IMG_DIR));
    } catch (e) {
      echecs.push(e.message);
    }
  }
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
      const nom = await scrape.telechargerImage(String(u), IMG_DIR);
      urls_ok.push('/uploads/produits/' + nom);
    } catch (e) {
      erreurs.push(e.message || 'échec');
    }
  }
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

router.post('/upload', upload.array('files', 10), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/produits/${f.filename}`);
  if (!urls.length) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  addLog('upload_images', { source: 'admin', ref: String(req.admin.username), details: urls.join(' ') });
  return res.json({ urls });
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
  const entetes = ['reference', 'created_at', 'client', 'telephone', 'mode', 'zone_id', 'adresse', 'sous_total', 'frais', 'total', 'paiement', 'statut_paiement', 'statut', 'payee_le'];
  const csv = [entetes.join(',')].concat(
    rows.map((r) => entetes.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="commandes-fatoucha-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv);
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
];

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const changes = [];
  for (const k of SETTINGS_EDITABLE) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'livraison_gratuite_a_partir' || k === 'caution_pourcentage' || k === 'delai_retrait_heures' || k === 'expiration_commande_h') {
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
