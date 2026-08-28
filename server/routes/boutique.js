/* API publique du catalogue : tout ce dont le client a besoin. */
const express = require('express');
const { db, getSetting, allSettings, addLog, STOCK_STATUTS_ACTIFS } = require('../db');
const { produitPublic, listerProduits, produitParId, listeVariantes, balayageCommandesImpayees } = require('../catalogue');
const { generateReference, normalizePhone, isValidSenegalPhone, rateLimiter } = require('../security');
const paiement = require('../paiement');

const router = express.Router();

/* ---------------- Réglages publics (nom, contact, zones, paiement) ---------------- */
const PUBLIC_KEYS = [
  'nom_boutique', 'slogan', 'boutique_description', 'telephone', 'whatsapp', 'email',
  'adresse_retrait', 'horaires_retrait', 'wave_numero', 'wave_nom', 'orange_numero', 'orange_nom',
  'livraison_gratuite_a_partir', 'caution_pourcentage', 'delai_retrait_heures', 'seo_keywords',
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
      `SELECT c.id, c.name, c.emoji, COUNT(p.id) AS n
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
  const { categorie, q, tri, limit, page } = req.query;
  const n = Math.min(Number(limit) || 0, 60);
  const off = Math.max(0, ((Number(page) || 1) - 1) * (n || 0));
  const rows = listerProduits({
    categorieId: categorie,
    q: typeof q === 'string' ? q.slice(0, 80) : '',
    tri: ['recent', 'prix_asc', 'prix_desc', 'alpha'].includes(tri) ? tri : 'recent',
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
  const row = produitParId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Produit indisponible.' });
  db.prepare('UPDATE produits SET vues = vues + 1 WHERE id = ?').run(row.id);
  const p = produitPublic(row);
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
      const v = db
        .prepare("SELECT stock FROM variantes WHERE produit_id = ? AND IFNULL(taille,'') = IFNULL(?,'') AND IFNULL(coloris,'') = IFNULL(?,'')")
        .get(row.id, taille, coloris);
      if (!v) return res.status(400).json({ error: `La variante choisie n’existe plus pour « ${row.titre} ».` });
      dispo = v.stock;
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

  const reference = generateReference('CMD');
  const insCommande = db.prepare(
    `INSERT INTO commandes (reference, client, telephone, adresse, zone_id, mode, instructions, sous_total, frais, total, paiement, statut)
     VALUES (@reference,@client,@telephone,@adresse,@zone_id,@mode,@instructions,@sous_total,@frais,@total,@paiement,'nouvelle')`
  );
  const insLigne = db.prepare(
    `INSERT INTO commande_lignes (commande_id, produit_id, titre, image, taille, coloris, prix_unitaire, quantite, total_ligne, delai_jours)
     VALUES (@commande_id,@produit_id,@titre,@image,@taille,@coloris,@prix_unitaire,@quantite,@total_ligne,@delai_jours)`
  );
  const majStock = require('../catalogue').majStock;

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
  if (!c || (req.query.tel && fin && String(normalizePhone(c.telephone)).slice(-4) !== fin)) {
    return res.status(404).json({ error: 'Commande introuvable (vérifie la référence et le numéro).' });
  }
  const lignes = db.prepare('SELECT * FROM commande_lignes WHERE commande_id = ?').all(c.id);
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
    delai_estime_jours: delaiMax + (c.mode === 'livraison' && zone ? Math.ceil((zone.delai_heures || 24) / 24) : 0),
    lignes: lignes.map((l) => ({
      titre: l.titre,
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
  require('../catalogue').annulerCommande(c.id, 'annulation_client');
  return res.json({ ok: true, message: 'Commande annulée, le stock est remis en rayon.' });
});

/* Vérification du paiement d'une commande (le front peut polled après le retour CinetPay). */
router.get('/commandes/:reference/paiement', async (req, res) => {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const c = db.prepare('SELECT id, reference, statut, statut_paiement, total FROM commandes WHERE reference = ?').get(ref);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  return res.json(c);
});

module.exports = router;
