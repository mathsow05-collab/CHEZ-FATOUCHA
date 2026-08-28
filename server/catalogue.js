/* Logique catalogue partagée (front client + espace admin). */
const { db, getSetting, addLog, STOCK_STATUTS_ACTIFS } = require('./db');

function parseJson(raw, fallback = []) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw ?? 'null');
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/* Quantités déjà réservées par des commandes vivantes (pour l'affichage « plus que 2 ! »). */
function stockReserve(produitId) {
  const q = db
    .prepare(
      `SELECT COALESCE(SUM(l.quantite), 0) AS n
         FROM commande_lignes l JOIN commandes c ON c.id = l.commande_id
        WHERE l.produit_id = ? AND c.statut IN (${STOCK_STATUTS_ACTIFS.map(() => '?').join(',')})`
    )
    .get(produitId, ...STOCK_STATUTS_ACTIFS);
  return q?.n || 0;
}

function listeVariantes(produitId) {
  return db
    .prepare('SELECT taille, coloris, stock FROM variantes WHERE produit_id = ? ORDER BY id')
    .all(produitId);
}

/* Décrémente le stock global + la variante correspondante. */
const majStock = db.transaction((produitId, taille, coloris, qte, sens = -1) => {
  db.prepare('UPDATE produits SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?').run(
    sens * qte,
    new Date().toISOString(),
    produitId
  );
  if (taille || coloris) {
    db.prepare(
      `UPDATE variantes SET stock = MAX(0, stock + ?)
        WHERE produit_id = ? AND IFNULL(taille,'') = IFNULL(?,'') AND IFNULL(coloris,'') = IFNULL(?,'')`
    ).run(sens * qte, produitId, taille || null, coloris || null);
  }
});

/* Annule automatiquement les commandes impayées qui ont dormi trop longtemps
   (le stock retourne en rayon). Balayage paresseux : appelé au fil de l'eau. */
let dernierBalayage = 0;
function balayageCommandesImpayees() {
  const now = Date.now();
  if (now - dernierBalayage < 60_000) return 0; // max 1 fois / minute
  dernierBalayage = now;
  const heures = Number(getSetting('expiration_commande_h', '6')) || 6;
  const limite = new Date(now - heures * 3600_000).toISOString();
  const old = db
    .prepare(
      `SELECT id, reference FROM commandes
        WHERE statut = 'nouvelle' AND created_at < ?`
    )
    .all(limite);
  for (const c of old) {
    annulerCommande(c.id, 'expiration_delai_paiement');
  }
  return old.length;
}

function annulerCommande(commandeId, motif = 'annulation') {
  const c = db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
  if (!c || c.statut === 'annulee') return false;
  const lignes = db.prepare('SELECT * FROM commande_lignes WHERE commande_id = ?').all(commandeId);
  db.transaction(() => {
    for (const l of lignes) {
      if (l.produit_id) majStock(l.produit_id, l.taille, l.coloris, l.quantite, +1);
    }
    db.prepare("UPDATE commandes SET statut = 'annulee', annulee_le = ? WHERE id = ?").run(
      new Date().toISOString(),
      commandeId
    );
  })();
  addLog('commande_annulee', { source: 'system', ref: c.reference, details: motif });
  return true;
}

/* Shape publique : jamais le prix d'achat ni le lien fournisseur. */
function produitPublic(row) {
  if (!row) return null;
  const images = parseJson(row.images);
  const variantes = listeVariantes(row.id);
  const stockTotal = Math.max(0, row.stock ?? 0); // décrémenté à la commande -> déjà net
  return {
    id: row.id,
    titre: row.titre,
    description: row.description || '',
    prix: row.prix,
    prix_barre: row.prix_barre || null,
    marque: row.marque || null,
    delai_jours: row.delai_jours,
    images,
    image: images[0]?.url || null,
    tailles: parseJson(row.tailles),
    coloris: parseJson(row.coloris),
    variantes: variantes.map((v) => ({
      taille: v.taille,
      coloris: v.coloris,
      stock: Math.max(0, v.stock),
    })),
    a_des_variantes: variantes.length > 0,
    stock: stockTotal,
    en_rupture: stockTotal <= 0,
    vedette: !!row.vedette,
    categorie: row.categorie_nom || null,
    categorie_id: row.categorie_id || null,
    vues: row.vues,
    created_at: row.created_at,
  };
}

const SELECT_PROD = `SELECT p.*, c.name AS categorie_nom FROM produits p
  LEFT JOIN categories c ON c.id = p.categorie_id`;

function listerProduits({ categorieId, q, tri = 'recent', includeInactive = false, limit = 0, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (!includeInactive) where.push('p.actif = 1');
  if (categorieId) {
    where.push('p.categorie_id = ?');
    args.push(Number(categorieId));
  }
  if (q) {
    where.push('(p.titre LIKE ? OR p.description LIKE ? OR p.marque LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  const trios = {
    recent: 'p.vedette DESC, p.id DESC',
    prix_asc: 'p.prix ASC',
    prix_desc: 'p.prix DESC',
    alpha: 'p.titre COLLATE NOCASE ASC',
  };
  const sql = `${SELECT_PROD} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${
    trios[tri] || trios.recent
  } ${limit ? 'LIMIT ' + Number(limit) + ' OFFSET ' + Number(offset) : ''}`;
  return db.prepare(sql).all(...args);
}

function produitParId(id, { includeInactive = false } = {}) {
  const p = db.prepare(`${SELECT_PROD} WHERE p.id = ?`).get(Number(id));
  if (!p) return null;
  if (!includeInactive && !p.actif) return null;
  return p;
}

module.exports = {
  db,
  parseJson,
  produitPublic,
  listerProduits,
  produitParId,
  listeVariantes,
  stockReserve,
  majStock,
  annulerCommande,
  balayageCommandesImpayees,
};
