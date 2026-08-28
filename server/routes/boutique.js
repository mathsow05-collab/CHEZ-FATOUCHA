/* API publique du catalogue : tout ce dont le client a besoin. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { UPLOADS_DIR } = require('../paths');
const optima = require('../optima');
const { db, getSetting, allSettings, addLog, STOCK_STATUTS_ACTIFS } = require('../db');
const {
  produitPublic, listerProduits, produitParId, produitParCle, listeVariantes, balayageCommandesImpayees,
  avisPublics, resumeAvis, similaires, completeLeLook, stockVariante, majStock, annulerCommande,
} = require('../catalogue');
const { generateReference, normalizePhone, isValidSenegalPhone, rateLimiter } = require('../security');
const paiement = require('../paiement');

const router = express.Router();

/* ---------------- Réglages publics (nom, contact, zones, paiement) ---------------- */
const PUBLIC_KEYS = [
  'nom_boutique', 'slogan', 'boutique_description', 'telephone', 'whatsapp', 'email',
  'adresse_retrait', 'horaires_retrait', 'wave_numero', 'wave_nom', 'orange_numero', 'orange_nom',
  'livraison_gratuite_a_partir', 'caution_pourcentage', 'delai_retrait_heures', 'seo_keywords',
  'cod_acompte_a_partir', 'cod_acompte_montant', 'faq_url', 'retours_url',
];

router.get('/config', (req, res) => {
  const all = allSettings();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = all[k] ?? '';
  out.paiement_mode = paiement.mode(); // 'cinetpay' | 'manuel'
  out.paiement_methodes = Object.entries(paiement.METHODES).map(([id, m]) => ({ id, libelle: m.libelle, couleur: m.couleur }));
  out.zones = db.prepare('SELECT id, nom, ville, frais, delai_heures FROM zones_livraison WHERE actif = 1 ORDER BY ordre, frais').all();
  out.categories = db.prepare('SELECT id, name, emoji FROM categories ORDER BY ordre, name').all();
  return res.json(out);
});

router.get('/categories', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.emoji, c.slug, COUNT(p.id) AS n
         FROM categories c LEFT JOIN produits p ON p.categorie_id = c.id AND p.actif = 1
        GROUP BY c.id ORDER BY c.ordre, c.name`
    )
    .all();
  res.json(rows);
});

router.get('/zones', (req, res) => {
  res.json(
    db.prepare('SELECT id, nom, ville, frais, delai_heures FROM zones_livraison WHERE actif = 1 ORDER BY ordre, frais').all()
  );
});

/* ---------------- Produits ---------------- */
router.get('/produits', (req, res) => {
  balayageCommandesImpayees();
  const { categorie, q, tri, limit, page, taille, prix_min, prix_max, dispo } = req.query;
  const n = Math.min(Number(limit) || 0, 60);
  const off = Math.max(0, ((Number(page) || 1) - 1) * (n || 0));
  const rows = listerProduits({
    categorieId: categorie,
    q: typeof q === 'string' ? q.slice(0, 80) : '',
    tri: ['recent', 'prix_asc', 'prix_desc', 'alpha', 'promo'].includes(tri) ? tri : 'recent',
    taille: typeof taille === 'string' ? taille.slice(0, 20) : '',
    prixMin: prix_min,
    prixMax: prix_max,
    dispoSeul: dispo === '1',
    limit: n,
    offset: off,
  });
  res.json(rows.map(produitPublic));
});

router.get('/produits/vedette', (req, res) => {
  const rows = db.prepare('SELECT p.*, c.name AS categorie_nom FROM produits p LEFT JOIN categories c ON c.id = p.categorie_id WHERE p.actif = 1 AND p.vedette = 1 ORDER BY p.id DESC LIMIT 6').all();
  res.json(rows.map(produitPublic));
});

router.get('/produits/:id', (req, res) => {
  const row = produitParCle(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produit indisponible.' });
  db.prepare('UPDATE produits SET vues = vues + 1 WHERE id = ?').run(row.id);
  const p = produitPublic(row);
  p.avis_liste = avisPublics(row.id, 8);
  p.dans_le_meme_esprit = similaires(row, { limite: 8 });
  p.ca_complete_le_look = completeLeLook(row, { limite: 6 });
  p.dispo_par_variante = listeVariantes(row.id).map((v) => ({ taille: v.taille, coloris: v.coloris, stock: Math.max(0, v.stock) }));
  p.stock_initial = p.stock + db
    .prepare(
      `SELECT COALESCE(SUM(l.quantite),0) AS n FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id
        WHERE l.produit_id = ? AND c.statut IN (${STOCK_STATUTS_ACTIFS.map(() => '?').join(',')})`
    )
    .get(row.id, ...STOCK_STATUTS_ACTIFS).n;
  return res.json(p);
});

/* Nombre de produits disponibles par catégorie (pour la home). */
router.get('/stats', (req, res) => {
  res.json({
    disponibles: db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1 AND stock > 0').get().n,
    total: db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1').get().n,
    livraison_gratuite: Number(getSetting('livraison_gratuite_a_partir', '0')) || 0,
  });
});

/* ---------------- Recommandations seules (bouton « voir plus ») ---------------- */
router.get('/produits/:id/aussi', (req, res) => {
  const row = produitParCle(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produit indisponible.' });
  res.json({
    dans_le_meme_esprit: similaires(row, { limite: Number(req.query.limit) || 8 }),
    ca_complete_le_look: completeLeLook(row, { limite: Number(req.query.limit) || 6 }),
  });
});

/* ---------------- Avis des acheteuses ---------------- */
const limiterAvis = rateLimiter({ max: 6, windowMs: 10 * 60_000, message: 'Trop d’avis envoyés d’affilée. Réessaie dans quelques minutes.' });

/* Un avis n'est « vérifié » — et publié tout de suite — que s'il vient d'une
   commande LIVRÉE contenant cet article (référence + fin du numéro). Sinon il
   attend la validation de la boutique : zéro faux avis, zéro avis d'agent. */
function commandeLivreePour(reference, telephone, produitId) {
  const ref = String(reference || '').trim().toUpperCase();
  if (ref.length < 6) return null;
  const c = db.prepare("SELECT * FROM commandes WHERE reference = ? AND statut = 'livree'").get(ref);
  if (!c) return null;
  const fin = normalizePhone(telephone).slice(-4);
  if (!fin || String(normalizePhone(c.telephone)).slice(-4) !== fin) return null;
  const ligne = db.prepare('SELECT id FROM commande_lignes WHERE commande_id = ? AND produit_id = ?').get(c.id, Number(produitId));
  return ligne ? c : null;
}

router.get('/produits/:id/avis', (req, res) => {
  const row = produitParCle(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produit indisponible.' });
  res.json({ resume: resumeAvis(row.id), avis: avisPublics(row.id, Number(req.query.limite) || 12) });
});

router.post('/produits/:id/avis', limiterAvis, (req, res) => {
  const row = produitParCle(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produit indisponible.' });
  const b = req.body || {};
  const prenom = String(b.prenom || '').trim().slice(0, 30);
  const note = Math.round(Number(b.note) || 0);
  const texte = String(b.texte || '').trim().slice(0, 900);
  const taille = b.taille ? String(b.taille).slice(0, 20) : null;
  const photo = /^\/uploads\/avis\/[a-z0-9._-]+\.webp$/i.test(String(b.photo || '')) ? String(b.photo) : null;
  const errs = [];
  if (prenom.length < 2) errs.push('Indique un prénom (2 lettres minimum).');
  if (note < 1 || note > 5) errs.push('Choisis une note de 1 à 5 étoiles.');
  if (texte.length && texte.length < 8) errs.push('Ton mot est trop court : quelques mots de plus ?');
  if (!texte && !photo) errs.push('Écris une phrase ou ajoute une photo.');
  if (errs.length) return res.status(400).json({ error: errs.join(' '), champs: errs });

  const cmd = commandeLivreePour(b.reference, b.telephone, row.id);
  if (b.reference && !cmd) {
    return res.status(403).json({
      error: 'Impossible de retrouver une commande livrée avec cet article et ce numéro. Tu peux quand même envoyer ton avis : il sera vérifié par la boutique.',
      verification_impossible: true,
    });
  }
  const r = db
    .prepare(
      `INSERT INTO avis (produit_id, commande_id, prenom, note, texte, photo, taille, achat_verifie, approuve)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(row.id, cmd ? cmd.id : null, prenom, note, texte || null, photo, taille, cmd ? 1 : 0, cmd ? 1 : 0);
  db.prepare("UPDATE produits SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  addLog('avis_recu', { source: 'client', ref: row.slug || String(row.id), details: cmd ? 'vérifié' : 'à valider', req });
  return res.status(201).json({
    ok: true,
    publie: !!cmd,
    message: cmd
      ? 'Merci ✔ Ton avis est en ligne (achat vérifié).'
      : 'Merci ! Ton avis est reçu — la boutique le publie après vérification.',
  });
});

/* Photo d'acheteuse : le fichier est recodé en WebP par le serveur (un fichier
   piégé ne survit pas à la re-encode), 5 Mo max, et n'est jamais exécuté. */
const DOSSIER_AVIS = path.join(UPLOADS_DIR, 'avis');
fs.mkdirSync(DOSSIER_AVIS, { recursive: true });
const stockerAvis = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOSSIER_AVIS),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.src`),
});
const uploadAvis = multer({
  storage: stockerAvis,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimetype) ? cb(null, true) : cb(new Error('Envoie une photo (JPG, PNG ou WEBP).'))),
});
router.post('/avis-photo', uploadAvis.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune photo reçue.' });
    const brut = path.join(DOSSIER_AVIS, req.file.filename);
    const sharp = require('sharp');
    const nom = req.file.filename.replace(/\.src$/, '.webp');
    await sharp(brut, { failOn: 'none' }).rotate().resize({ width: 900, withoutEnlargement: true }).webp({ quality: 76 }).toFile(path.join(DOSSIER_AVIS, nom));
    fs.rmSync(brut, { force: true });
    return res.json({ url: '/uploads/avis/' + nom });
  } catch (e) {
    try { if (req.file) fs.rmSync(path.join(DOSSIER_AVIS, req.file.filename), { force: true }); } catch { /* rien */ }
    return res.status(422).json({ error: 'Photo illisible : réessaie avec une autre image.' });
  }
});

/* ---------------- « Préviens-moi quand ça revient » ---------------- */
router.post('/alertes-stock', rateLimiter({ max: 10, windowMs: 10 * 60_000, message: 'Trop de demandes, patiente.' }), (req, res) => {
  const produitId = Number(req.body?.produit_id);
  const telephone = normalizePhone(req.body?.telephone);
  const p = db.prepare('SELECT id, titre, stock FROM produits WHERE id = ? AND actif = 1').get(produitId);
  if (!p) return res.status(404).json({ error: 'Article introuvable.' });
  if (!isValidSenegalPhone(telephone)) return res.status(400).json({ error: 'Numéro invalide (ex. 77 123 45 67).' });
  if (p.stock > 0) return res.json({ ok: true, deja: true, message: 'Bonne nouvelle : cet article est de retour en stock.' });
  db.prepare('INSERT INTO alertes_stock (produit_id, telephone) VALUES (?,?) ON CONFLICT(produit_id, telephone) DO NOTHING').run(p.id, telephone);
  addLog('alerte_stock', { source: 'client', ref: p.titre, details: telephone, req });
  return res.json({ ok: true, message: `Noté ✔ on t’envoie un WhatsApp dès que « ${p.titre} » revient.` });
});

/* ---------------- Panier enregistré (reprise + relance) ---------------- */
const CLEAN_ITEMS = (items) =>
  (Array.isArray(items) ? items : []).slice(0, 20).map((i) => ({
    produit_id: Number(i.produit_id) || 0,
    quantite: Math.min(20, Math.max(1, Math.floor(Number(i.quantite) || 1))),
    taille: i.taille ? String(i.taille).slice(0, 20) : null,
    coloris: i.coloris ? String(i.coloris).slice(0, 30) : null,
  }));

router.post('/panier', (req, res) => {
  const jeton = String(req.body?.jeton || '').trim().slice(0, 40);
  if (!/^[a-z0-9-]{8,40}$/i.test(jeton)) return res.status(400).json({ error: 'Jeton de panier invalide.' });
  const lignes = CLEAN_ITEMS(req.body?.items).filter((i) => i.produit_id > 0);
  let total = 0;
  for (const l of lignes) {
    const p = db.prepare('SELECT prix FROM produits WHERE id = ? AND actif = 1').get(l.produit_id);
    if (p) total += p.prix * l.quantite;
  }
  const telephone = req.body?.telephone ? normalizePhone(req.body.telephone) : null;
  const existant = db.prepare('SELECT code_reprise FROM paniers WHERE jeton = ?').get(jeton);
  const code = existant?.code_reprise || crypto.randomBytes(2).toString('hex').toUpperCase();
  db.prepare(
    `INSERT INTO paniers (jeton, telephone, client, items, total, code_reprise, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(jeton) DO UPDATE SET telephone = excluded.telephone, client = excluded.client,
       items = excluded.items, total = excluded.total, code_reprise = excluded.code_reprise, updated_at = excluded.updated_at`
  ).run(jeton, telephone || null, String(req.body?.client || '').slice(0, 60) || null, JSON.stringify(lignes), total, code, new Date().toISOString());
  res.json({ ok: true, total, lignes: lignes.length, etabli: code });
});

/* Reprise sur un autre téléphone : le numéro seul ne suffit pas, il faut le
   code de reprise donné au moment de l'enregistrement. */
router.get('/panier', (req, res) => {
  const jeton = String(req.query.jeton || '').trim();
  const telephone = normalizePhone(req.query.tel);
  const code = String(req.query.code || '').trim().toUpperCase();
  let r = null;
  if (jeton) r = db.prepare('SELECT * FROM paniers WHERE jeton = ?').get(jeton);
  if (!r && telephone.length >= 9) {
    const fin = telephone.slice(-9);
    r = db.prepare("SELECT * FROM paniers WHERE telephone IS NOT NULL AND updated_at > datetime('now','-30 days') ORDER BY updated_at DESC LIMIT 40")
      .all().find((x) => String(normalizePhone(x.telephone)).slice(-9) === fin && String(x.code_reprise).toUpperCase() === code);
  }
  if (!r) return res.json({ found: false });
  if (!jeton && r.code_reprise && code !== String(r.code_reprise).toUpperCase()) return res.status(403).json({ error: 'Code de reprise incorrect.' });
  const items = (parseJsonSafe(r.items) || [])
    .map((i) => {
      const p = db.prepare('SELECT id, titre, slug, prix, prix_barre, images, stock, delai_jours FROM produits WHERE id = ? AND actif = 1').get(i.produit_id);
      if (!p) return null;
      const imgs = parseJsonSafe(p.images) || [];
      return {
        produit_id: p.id,
        titre: p.titre,
        slug: p.slug,
        prix: p.prix,
        prix_barre: p.prix_barre,
        image: (imgs.find((x) => x.is_main) || imgs[0])?.url || null,
        quantite: i.quantite,
        taille: i.taille,
        coloris: i.coloris,
        stock: p.stock,
        delai_jours: p.delai_jours,
        en_rupture: p.stock <= 0,
      };
    })
    .filter(Boolean);
  res.json({ found: true, items, total: items.reduce((s, i) => s + i.prix * i.quantite, 0), updated_at: r.updated_at });
});

router.post('/panier/vider', (req, res) => {
  db.prepare('DELETE FROM paniers WHERE jeton = ?').run(String(req.body?.jeton || '').slice(0, 40));
  res.json({ ok: true });
});

function parseJsonSafe(v) { try { return JSON.parse(v); } catch { return null; } }

/* ---------------- Pages de contenu (FAQ, retours…) ---------------- */
router.get('/pages/:slug', (req, res) => {
  const p = db.prepare('SELECT slug, titre, corps, meta_desc, updated_at FROM pages WHERE slug = ?').get(String(req.params.slug || '').slice(0, 40));
  if (!p) return res.status(404).json({ error: 'Page introuvable.' });
  res.json(p);
});

/* ---------------- Mesure (entonnoir) ---------------- */
const TYPES_EVENEMENTS = [
  'vue_fiche', 'ajout_panier', 'retrait_panier', 'ouverture_commande', 'paiement_engage',
  'commande_validee', 'recherche', 'clic_whatsapp', 'alerte_stock', 'avis_publie', 'zoom_photo', 'guide_tailles',
];
router.post('/evenements', rateLimiter({ max: 40, windowMs: 10 * 60_000, message: 'Trop d’événements.' }), (req, res) => {
  const seance = String(req.body?.seance || '').slice(0, 40);
  const evs = (Array.isArray(req.body?.evenements) ? req.body.evenements : []).slice(0, 25);
  const ins = db.prepare('INSERT INTO evenements (type, produit_id, seance, meta) VALUES (?,?,?,?)');
  let n = 0;
  db.transaction(() => {
    for (const e of evs) {
      if (!TYPES_EVENEMENTS.includes(e?.type)) continue;
      ins.run(e.type, Number(e.produit_id) || null, seance || null, e.meta ? String(e.meta).slice(0, 80) : null);
      n++;
    }
  })();
  res.json({ ok: true, enregistres: n });
});

/* ---------------- Création de commande ---------------- */
const limiterCommande = rateLimiter({ max: 12, windowMs: 10 * 60_000, message: 'Trop de commandes tryées. Réessaie dans 10 minutes.' });

router.post('/commandes', limiterCommande, (req, res) => {
  balayageCommandesImpayees();
  const b = req.body || {};
  const client = String(b.client || '').trim().slice(0, 80);
  const telephone = normalizePhone(b.telephone);
  const mode = b.mode === 'retrait' ? 'retrait' : 'livraison';
  const meth = paiement.methodeValide(b.paiement);
  const items = Array.isArray(b.items) ? b.items.slice(0, 40) : [];

  const erreurs = [];
  if (client.length < 3) erreurs.push('Indique ton nom complet.');
  if (!isValidSenegalPhone(telephone)) erreurs.push('Numéro invalide (ex. 77 123 45 67).');
  if (!items.length) erreurs.push('Ton panier est vide.');
  if (erreurs.length) return res.status(400).json({ error: erreurs.join(' '), champs: erreurs });

  let adresse = null;
  let zone = null;
  if (mode === 'livraison') {
    adresse = String(b.adresse || '').trim().slice(0, 200);
    zone = db.prepare('SELECT * FROM zones_livraison WHERE id = ? AND actif = 1').get(Number(b.zone_id) || 0);
    if (!zone) return res.status(400).json({ error: 'Choisis ta zone de livraison.' });
    if (adresse.length < 6) return res.status(400).json({ error: 'Précise l’adresse (quartier, rue, repère).' });
  }

  /* On recalcule tout depuis la base : jamais de prix envoyé par le client. */
  const lignes = [];
  let sousTotal = 0;
  let delaiMax = 0;
  for (const it of items) {
    const row = produitParId(it.produit_id);
    if (!row) {
      return res.status(400).json({ error: 'Un article du panier n’est plus disponible.', produit: it.produit_id });
    }
    const qte = Math.floor(Number(it.quantite) || 0);
    if (qte < 1 || qte > 20) {
      return res.status(400).json({ error: `Quantité invalide pour « ${row.titre} » (1 à 20).` });
    }
    const taille = it.taille ? String(it.taille).slice(0, 20) : null;
    const coloris = it.coloris ? String(it.coloris).slice(0, 30) : null;
    let dispo = row.stock;
    if (taille || coloris) {
      const v = stockVariante(row.id, taille, coloris);
      if (v === null) return res.status(400).json({ error: `La variante choisie n’existe plus pour « ${row.titre} ».` });
      dispo = v;
    }
    if (dispo < qte) {
      return res.status(409).json({
        error: `Il reste seulement ${dispo} « ${row.titre} »${taille ? ' en ' + taille : ''}.`,
        disponible: dispo,
        produit_id: row.id,
      });
    }
    const img = (() => {
      try {
        const a = JSON.parse(row.images || '[]');
        return (a.find((x) => x.is_main) || a[0])?.url || null;
      } catch {
        return null;
      }
    })();
    sousTotal += row.prix * qte;
    delaiMax = Math.max(delaiMax, row.delai_jours || 0);
    lignes.push({
      produit_id: row.id,
      titre: row.titre,
      image: img,
      taille,
      coloris,
      prix_unitaire: row.prix,
      quantite: qte,
      total_ligne: row.prix * qte,
      delai_jours: row.delai_jours || 7,
    });
  }

  let frais = 0;
  if (mode === 'livraison') {
    frais = zone.frais;
    const seuil = Number(getSetting('livraison_gratuite_a_partir', '0')) || 0;
    if (seuil > 0 && sousTotal >= seuil) frais = 0;
  }
  const total = sousTotal + frais;

  /* ETA lisible pour le client. */
  const delaiLivraisonJ = mode === 'livraison' ? Math.ceil((zone.delai_heures || 24) / 24) : Math.ceil((Number(getSetting('delai_retrait_heures', '24')) || 24) / 24);
  const etaTexte =
    mode === 'livraison'
      ? `Article commandé au fournisseur : ~${delaiMax} j · puis livraison ${zone.nom} (~${delaiLivraisonJ} j) → reçu en ~${delaiMax + delaiLivraisonJ} jours`
      : `Retrait en boutique : article prêt sous ~${delaiMax} jours, dispo au retrait sous ${delaiLivraisonJ} h après préparation`;

  /* --- Paiement en espèces : un acompte et une confirmation avant départ ---
     Le paiement à la livraison est un signe de confiance (la cliente veut voir
     l'article avant de payer) : on le garde. Mais une commande sur deux en
     espèces n'aboutit pas, et chaque course ratée est de l'argent perdu. D'où :
     1) un code à rappeler (ou un bouton sur le lien reçu) pour dire « je suis là » ;
     2) un petit acompte au-dessus d'un certain montant, encaissé tout de suite. */
  const codeConfirmation = crypto.randomBytes(3).toString('hex').toUpperCase();
  let acompte = 0;
  let codRisque = 0;
  const annuleesAvant = db
    .prepare("SELECT COUNT(*) AS n FROM commandes WHERE telephone = ? AND paiement = 'especes' AND statut = 'annulee'")
    .get(telephone).n;
  if (meth === 'especes') {
    const seuilAcompte = Number(getSetting('cod_acompte_a_partir', '0')) || 0;
    const montantAcompte = Number(getSetting('cod_acompte_montant', '0')) || 0;
    codRisque = annuleesAvant >= 2 ? 1 : 0;
    if (montantAcompte > 0 && (seuilAcompte > 0 ? total >= seuilAcompte : true)) {
      acompte = Math.min(total - 500, montantAcompte);
      if (acompte < 0) acompte = 0;
    }
    if (codRisque && acompte <= 0) acompte = Math.min(total, 1000);
  }

  const reference = generateReference('CMD');
  const insCommande = db.prepare(
    `INSERT INTO commandes (reference, client, telephone, adresse, zone_id, mode, instructions, sous_total, frais, total, paiement, statut,
       code_confirmation, acompte, reste_a_payer, cod_risque)
     VALUES (@reference,@client,@telephone,@adresse,@zone_id,@mode,@instructions,@sous_total,@frais,@total,@paiement,'nouvelle',
       @code_confirmation,@acompte,@reste_a_payer,@cod_risque)`
  );
  const insLigne = db.prepare(
    `INSERT INTO commande_lignes (commande_id, produit_id, titre, image, taille, coloris, prix_unitaire, quantite, total_ligne, delai_jours)
     VALUES (@commande_id,@produit_id,@titre,@image,@taille,@coloris,@prix_unitaire,@quantite,@total_ligne,@delai_jours)`
  );

  const result = db.transaction(() => {
    const r = insCommande.run({
      reference,
      client,
      telephone,
      adresse,
      zone_id: mode === 'livraison' ? zone.id : null,
      mode,
      instructions: String(b.instructions || '').slice(0, 300) || null,
      sous_total: sousTotal,
      frais,
      total,
      paiement: meth,
      code_confirmation: codeConfirmation,
      acompte,
      reste_a_payer: Math.max(0, total - acompte),
      cod_risque: codRisque,
    });
    const commandeId = Number(r.lastInsertRowid);
    for (const l of lignes) {
      insLigne.run({ ...l, commande_id: commandeId });
      majStock(l.produit_id, l.taille, l.coloris, l.quantite, -1); // réservation du stock
    }
    return commandeId;
  })();

  const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(result);
  addLog('commande_creee', { source: 'client', ref: reference, details: `${total} FCFA · ${mode} · ${meth}`, req });

  return res.status(201).json({
    reference: commande.reference,
    id: commande.id,
    total: commande.total,
    sous_total: commande.sous_total,
    frais: commande.frais,
    acompte: commande.acompte,
    reste_a_payer: commande.reste_a_payer,
    code_confirmation: commande.code_confirmation,
    page_confirmation: `/confirmer/${commande.reference}/${commande.code_confirmation}`,
    statut: commande.statut,
    paiement_mode: paiement.mode(),
    delai: etaTexte,
    message: 'Commande enregistrée ! Il ne reste plus qu’à payer pour la valider.',
  });
});

/* Suivi client : référence + 4 derniers chiffres du numéro. */
router.get('/commandes/:reference', (req, res) => {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const c = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(ref);
  const fin = normalizePhone(req.query.tel).slice(-4);
  const code = String(req.query.code || '').trim().toUpperCase();
  /* Référence seule = aucune information. Il faut le numéro (4 derniers
     chiffres) OU le code de confirmation reçu sur le site — sinon n'importe qui
     devinerait nom, téléphone et adresse d'une cliente. */
  if (!c) return res.status(404).json({ error: 'Commande introuvable (vérifie la référence et le numéro).' });
  const parTel = fin && String(normalizePhone(c.telephone)).slice(-4) === fin;
  const parCode = code.length >= 4 && c.code_confirmation && code === String(c.code_confirmation).toUpperCase();
  if (!parTel && !parCode) {
    /* 404 et non 401 : une référence devinée ne doit pas révéler qu'elle existe. */
    return res.status(404).json({ error: 'Commande introuvable (vérifie la référence et le numéro).' });
  }
  const lignes = db
    .prepare('SELECT l.*, p.slug AS produit_slug FROM commande_lignes l LEFT JOIN produits p ON p.id = l.produit_id WHERE l.commande_id = ? ORDER BY l.id')
    .all(c.id);
  const zone = c.zone_id ? db.prepare('SELECT nom, ville, frais, delai_heures FROM zones_livraison WHERE id = ?').get(c.zone_id) : null;
  const delaiMax = lignes.reduce((m, l) => Math.max(m, l.delai_jours), 0);
  return res.json({
    reference: c.reference,
    client: c.client,
    telephone: c.telephone,
    statut: c.statut,
    statut_paiement: c.statut_paiement,
    paiement: c.paiement,
    sous_total: c.sous_total,
    frais: c.frais,
    total: c.total,
    mode: c.mode,
    adresse: c.adresse,
    zone: zone ? zone.nom : null,
    created_at: c.created_at,
    payee_le: c.payee_le,
    expediee_le: c.expediee_le,
    livree_le: c.livree_le,
    acompte: c.acompte || 0,
    reste_a_payer: c.reste_a_payer || 0,
    code_confirmation: parCode || parTel ? c.code_confirmation || null : null,
    client_confirme_le: c.client_confirme_le || null,
    page_confirmation: c.code_confirmation ? `/confirmer/${c.reference}/${c.code_confirmation}` : null,
    delai_estime_jours: delaiMax + (c.mode === 'livraison' && zone ? Math.ceil((zone.delai_heures || 24) / 24) : 0),
    lignes: lignes.map((l) => ({
      titre: l.titre,
      produit_slug: l.produit_slug || null,
      image: l.image,
      taille: l.taille,
      coloris: l.coloris,
      prix_unitaire: l.prix_unitaire,
      quantite: l.quantite,
      total_ligne: l.total_ligne,
      delai_jours: l.delai_jours,
    })),
  });
});

/* Annulation client tant que rien n'a été payé. */
router.post('/commandes/:reference/annuler', (req, res) => {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const c = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(ref);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  const fin = normalizePhone(req.body?.telephone).slice(-4);
  if (!fin || String(normalizePhone(c.telephone)).slice(-4) !== fin) {
    return res.status(403).json({ error: 'Le numéro ne correspond pas à cette commande.' });
  }
  if (c.statut_paiement === 'paye') {
    return res.status(400).json({ error: 'Commande déjà payée : appelle la boutique au ' + getSetting('telephone', '') + '.' });
  }
  if (c.statut !== 'nouvelle') return res.status(400).json({ error: 'Cette commande n’est plus annulable en ligne.' });
  annulerCommande(c.id, 'annulation_client');
  return res.json({ ok: true, message: 'Commande annulée, le stock est remis en rayon.' });
});

/* Confirmation de la cliente avant que le livreur parte (surtout en espèces).
   Deux portes : ce point d'entrée (bouton sur le site) et le formulaire POST
   de la page /confirmer/<ref>/<code>, qui marche même sans JavaScript. */
const limiterConfirmation = rateLimiter({ max: 20, windowMs: 10 * 60_000, message: 'Trop de tentatives, patiente un peu.' });
router.post('/commandes/:reference/confirmer', limiterConfirmation, (req, res) => {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const c = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(ref);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  const code = String(req.body?.code || req.query.code || '').trim().toUpperCase();
  const parCode = c.code_confirmation && code === String(c.code_confirmation).toUpperCase();
  /* Le numéro seul ne suffit pas : quatre chiffres se devinent. On exige le
     numéro complet tel qu'il a été saisi à la commande (repli si la cliente a
     perdu le lien, mais elle seule le connaît en entier). */
  const telRecu = normalizePhone(req.body?.telephone);
  const parTel = telRecu.length >= 9 && telRecu === String(normalizePhone(c.telephone));
  if (!parCode && !parTel) return res.status(401).json({ error: 'Code de confirmation invalide.' });
  if (c.statut === 'annulee') return res.status(400).json({ error: 'Cette commande est annulée : réécris-nous sur WhatsApp.' });
  if (c.client_confirme_le) return res.json({ ok: true, deja: true, message: 'C’est déjà noté ✔ on t’appelle avant que le livreur parte.' });
  db.prepare("UPDATE commandes SET client_confirme_le = ? WHERE id = ?").run(new Date().toISOString(), c.id);
  addLog('commande_confirmee', { source: 'client', ref, details: code ? 'code' : 'numero', req });
  return res.json({
    ok: true,
    message: 'Merci ! Commande confirmée. ' + (c.paiement === 'especes' ? `Prépare ${c.reste_a_payer ? (c.reste_a_payer + ' F') : 'le montant'} à donner au livreur.` : 'On valide dès réception de ton envoi.'),
    client_confirme_le: new Date().toISOString(),
  });
});

/* Vérification du paiement d'une commande (le front peut polled après le retour CinetPay). */
router.get('/commandes/:reference/paiement', async (req, res) => {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const c = db.prepare('SELECT id, reference, statut, statut_paiement, total FROM commandes WHERE reference = ?').get(ref);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  return res.json(c);
});

module.exports = router;
