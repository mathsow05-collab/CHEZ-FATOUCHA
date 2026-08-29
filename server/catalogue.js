/* Logique catalogue partagée (front client, rendu serveur, espace admin). */
const { db, getSetting, addLog, STOCK_STATUTS_ACTIFS, slugifier, slugLibre } = require('./db');
const optima = require('./optima');
const videos = require('./videos');

function parseJson(raw, fallback = []) {
  if (Array.isArray(raw)) return raw;
  /* un objet déjà décodé arrive telle quelle : une mise à jour partielle envoie
     ce que la lecture avait rendu (le guide des tailles, surtout) — le passer par
     JSON.parse le transformait en chaîne et faisait disparaître la donnée. */
  if (raw && typeof raw === 'object') return raw;
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

/* Stock réellement dispo pour une variante choisie.
   Une cliente peut ne sélectionner qu'une taille (sans coloris) : on additionne
   alors toutes les variantes qui correspondent, au lieu de la rejeter. */
function variantesVises(produitId, taille, coloris) {
  return db
    .prepare(
      `SELECT id, stock FROM variantes
        WHERE produit_id = @produit
          AND (@taille IS NULL OR IFNULL(taille, '') = @taille)
          AND (@coloris IS NULL OR IFNULL(coloris, '') = @coloris)`
    )
    .all({ produit: produitId, taille: taille || null, coloris: coloris || null });
}

function stockVariante(produitId, taille, coloris) {
  if (!taille && !coloris) return db.prepare('SELECT stock FROM produits WHERE id = ?').get(produitId)?.stock ?? 0;
  const v = variantesVises(produitId, taille, coloris);
  if (!v.length) return null; // variante supprimée entre-temps
  return v.reduce((t, x) => t + (x.stock || 0), 0);
}

/* Décrémente le stock global + les variantes correspondantes (réparti du plus
   fourni au moins fourni, pour ne pas vider un coloris d'un coup). */
const majStock = db.transaction((produitId, taille, coloris, qte, sens = -1) => {
  db.prepare('UPDATE produits SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?').run(
    sens * qte,
    new Date().toISOString(),
    produitId
  );
  if (!taille && !coloris) return;
  const v = variantesVises(produitId, taille, coloris);
  if (!v.length) return;
  if (v.length === 1) {
    db.prepare('UPDATE variantes SET stock = MAX(0, stock + ?) WHERE id = ?').run(sens * qte, v[0].id);
    return;
  }
  if (sens < 0) {
    const ordre = v.slice().sort((a, b) => (b.stock || 0) - (a.stock || 0));
    let reste = qte;
    for (const x of ordre) {
      if (reste <= 0) break;
      const prend = Math.min(x.stock || 0, reste);
      if (prend > 0) {
        db.prepare('UPDATE variantes SET stock = stock - ? WHERE id = ?').run(prend, x.id);
        reste -= prend;
      }
    }
    /* plus assez en stock détaillé : on retire le solde sur la première */
    if (reste > 0) db.prepare('UPDATE variantes SET stock = MAX(0, stock - ?) WHERE id = ?').run(reste, ordre[0].id);
  } else {
    let reste = qte;
    for (const x of v) {
      const rend = Math.max(1, Math.floor(reste / (v.filter((y) => y.stock <= (x.stock || 0)).length || 1)));
      const don = Math.min(rend, reste);
      db.prepare('UPDATE variantes SET stock = stock + ? WHERE id = ?').run(don, x.id);
      reste -= don;
      if (reste <= 0) break;
    }
    if (reste > 0) db.prepare('UPDATE variantes SET stock = stock + ? WHERE id = ?').run(reste, v[0].id);
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

/* ------------------------------------------------------------------ */
/* Avis clients : résumé (pour la fiche, l'accueil et le JSON-LD).      */
/* ------------------------------------------------------------------ */
function resumeAvis(produitId) {
  const r = db
    .prepare('SELECT COUNT(*) AS n, AVG(note) AS moyenne FROM avis WHERE produit_id = ? AND approuve = 1')
    .get(produitId);
  return { nombre: r?.n || 0, moyenne: r?.n ? Math.round((r.moyenne || 0) * 10) / 10 : 0 };
}

function avisPublics(produitId, limite = 12) {
  return db
    .prepare(
      `SELECT a.id, a.prenom, a.note, a.texte, a.photo, a.taille, a.achat_verifie, a.reponse, a.created_at,
              p.titre AS produit_titre, p.slug AS produit_slug
         FROM avis a LEFT JOIN produits p ON p.id = a.produit_id
        WHERE a.produit_id = ? AND a.approuve = 1
        ORDER BY a.achat_verifie DESC, a.id DESC LIMIT ?`
    )
    .all(produitId, limite);
}

/* Petites photos d'acheteuses, sur toute la boutique (bandeau de confiance). */
function avisPhotos(limite = 8) {
  return db
    .prepare(
      `SELECT a.photo, a.prenom, a.note, p.slug AS produit_slug, p.titre AS produit_titre
         FROM avis a JOIN produits p ON p.id = a.produit_id
        WHERE a.approuve = 1 AND a.photo IS NOT NULL AND a.photo != '' AND p.actif = 1
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(limite);
}

/* ------------------------------------------------------------------ */
/* Images d'une fiche : chaque visuel gagne ses tailles prêtes à l'emploi */
/* ------------------------------------------------------------------ */
function imagesEnrichies(brut) {
  const liste = parseJson(brut).slice(0, 12);
  const normalisees = liste.map((x) => (typeof x === 'string' ? { url: x } : x));
  const principale = normalisees.findIndex((x) => x.is_main) ;
  const tete = principale >= 0 ? [normalisees.splice(principale, 1)[0], ...normalisees] : normalisees;
  return tete.map((x) => {
    const url = String(x.url || '');
    return {
      url,
      legende: x.legende ? String(x.legende).slice(0, 120) : null,
      grande: optima.urlPour(url, 900),
      miniature: optima.urlPour(url, 220),
      srcset: optima.srcsetPour(url),
    };
  });
}

/* Guide des tailles : { "S": { poitrine: 88, taille: 70, hanches: 94 }, ... } */
function lireGuide(brut) {
  const obj = parseJson(brut, {});
  const out = {};
  for (const [taille, mes] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    const ligne = {};
    for (const k of ['poitrine', 'taille', 'hanches', 'longueur', 'epaule', 'manche']) {
      const v = Number(mes?.[k]);
      if (Number.isFinite(v) && v >= 20 && v <= 300) ligne[k] = Math.round(v);
    }
    if (Object.keys(ligne).length) out[String(taille).slice(0, 20)] = ligne;
  }
  return out;
}

function ecrireGuide(brut) {
  return JSON.stringify(lireGuide(brut));
}

/* Articles à proposer sous la fiche. Deux rangées, comme sur les grands sites :
   « dans le même esprit » (même catégorie) et « ça complète le look » (le sac,
   les chaussures, le parfum qui vont avec). Un moteur maison, sans dépendance :
   en stock d'abord, vedettes et plus vus ensuite. */
function similaires(row, { limite = 8 } = {}) {
  if (!row) return [];
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS categorie_nom FROM produits p
         LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.actif = 1 AND p.id != @id AND p.categorie_id = @cat
        ORDER BY (p.stock > 0) DESC, p.vedette DESC, p.vues DESC, p.id DESC
        LIMIT @limite`
    )
    .all({ id: row.id, cat: row.categorie_id ?? -1, limite });
  return rows.map(produitPublic);
}

/* Ce qui va avec : une autre catégorie, un prix dans le prolongement. */
function completeLeLook(row, { limite = 8 } = {}) {
  if (!row) return [];
  const min = Math.round(row.prix * 0.25);
  const max = Math.round(row.prix * 2.2);
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS categorie_nom FROM produits p
         LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.actif = 1 AND p.id != @id
          AND (p.categorie_id IS NULL OR p.categorie_id != @cat)
          AND p.prix BETWEEN @min AND @max
        ORDER BY p.vedette DESC, (p.stock > 0) DESC, p.vues DESC, p.id DESC
        LIMIT @limite`
    )
    .all({ id: row.id, cat: row.categorie_id ?? -1, min, max, limite });
  return rows.map(produitPublic);
}

/** La vidéo de la fiche, prête à être posée dans le gabarit : ni la page cliente
 *  ni le rendu serveur n'ont à reconnaître un lien. Renvoie null si le lien n'est
 *  pas un fournisseur connu (dans ce cas on ne montre rien d'intégré).
 *  `cadre` n'est rempli que si l'adresse est bien l'un des lecteurs autorisés. */
function videoDe(row) {
  const brut = row.video_url || null;
  if (!brut) return null;
  const a = videos.analyser(brut);
  if (!a.ok) return { brut, fournisseur: 'inconnu', etiquette: 'lien', page: brut, cadre: null, miniature: null, format: 'libre' };
  const miniature = row.video_miniature || a.miniature || null;
  return {
    brut,
    fournisseur: a.fournisseur,
    etiquette: a.etiquette,
    page: a.page,
    /* un fichier du site s'affiche dans un <video>, les autres dans un cadre
       qui n'est jamais fabriqué ici mais reconnu à l'enregistrement */
    cadre: a.local ? null : videos.cadreAutorise(a.cadre) ? a.cadre : null,
    fichier: a.local ? a.page : null,
    miniature,
    miniature_du_site: !!row.video_miniature,
    format: a.format,
  };
}

function produitPublic(row) {
  if (!row) return null;
  const images = imagesEnrichies(row.images);
  const variantes = listeVariantes(row.id);
  const stockTotal = Math.max(0, row.stock ?? 0); // décrémenté à la commande -> déjà net
  const avis = resumeAvis(row.id);
  return {
    id: row.id,
    titre: row.titre,
    slug: row.slug || null,
    url: '/produit/' + (row.slug || row.id),
    description: row.description || '',
    prix: row.prix,
    prix_barre: row.prix_barre || null,
    /* `marque` (« marque / origine » dans l'espace vendeur : SHEIN, TEMU, vendeur local…) reste
       interne, comme le prix d'achat et le lien fournisseur : c'est la source de la
       boutique, pas un argument de vente. La marque mise en avant reste celle de la maison. */
    delai_jours: row.delai_jours,
    video_url: row.video_url || null,
    video: videoDe(row),
    mannequin: row.mannequin || null,
    guide_tailles: lireGuide(row.guide_tailles),
    images,
    image: images[0]?.url || null,
    avis,
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

const SELECT_PROD = `SELECT p.*, c.name AS categorie_nom, c.slug AS categorie_slug, c.emoji AS categorie_emoji FROM produits p   LEFT JOIN categories c ON c.id = p.categorie_id`;

function listerProduits({ categorieId, q, tri = 'recent', includeInactive = false, limit = 0, offset = 0, taille = null, prixMin = null, prixMax = null, dispoSeul = false } = {}) {
  const where = [];
  const args = [];
  if (!includeInactive) where.push('p.actif = 1');
  if (categorieId) {
    where.push('p.categorie_id = ?');
    args.push(Number(categorieId));
  }
  if (taille) {
    where.push('p.tailles LIKE ?');
    args.push(`%"${String(taille).slice(0, 20)}"%`);
  }
  if (Number.isFinite(Number(prixMin)) && prixMin !== '' && prixMin !== null) {
    where.push('p.prix >= ?');
    args.push(Math.round(Number(prixMin)));
  }
  if (Number.isFinite(Number(prixMax)) && prixMax !== '' && prixMax !== null) {
    where.push('p.prix <= ?');
    args.push(Math.round(Number(prixMax)));
  }
  if (dispoSeul) where.push('p.stock > 0');
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
    promo: 'CASE WHEN p.prix_barre > p.prix THEN (1.0 * p.prix / p.prix_barre) ELSE 1 END ASC',
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

/* La clé d'une fiche peut être son identifiant (ancien lien #/produit/5) ou
   son URL lisible (/produit/robe-longue-boheme). */
function produitParCle(cle, { includeInactive = false } = {}) {
  const brut = String(cle ?? '').trim();
  if (!brut) return null;
  if (/^\d+$/.test(brut)) return produitParId(brut, { includeInactive });
  const p = db.prepare(`${SELECT_PROD} WHERE p.slug = ? COLLATE NOCASE`).get(brut.toLowerCase());
  if (!p) return null;
  if (!includeInactive && !p.actif) return null;
  return p;
}

function categorieParCle(cle) {
  const brut = String(cle ?? '').trim();
  if (!brut) return null;
  if (/^\d+$/.test(brut)) return db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(brut)) || null;
  return db.prepare('SELECT * FROM categories WHERE slug = ? COLLATE NOCASE').get(brut.toLowerCase()) || null;
}

/* Slug d'un article : dérivé du titre, figé une fois créé (les liens déjà
   partagés doivent continuer à marcher). */
function preparerSlug(titre, id = null, slugDemande = '') {
  const base = slugifier(slugDemande || titre, id ? 'article' : 'article');
  const deja = id ? db.prepare('SELECT slug FROM produits WHERE id = ?').get(id) : null;
  if (id && deja?.slug && (!slugDemande || slugDemande === deja.slug)) return deja.slug;
  return slugLibre(base, 'produits', id);
}

module.exports = { videoDe, produitPublic,
  db,
  parseJson,
  optima,
  resumeAvis,
  avisPublics,
  avisPhotos,
  imagesEnrichies,
  lireGuide,
  ecrireGuide,
  similaires,
  completeLeLook,
  preparerSlug,
  produitParCle,
  categorieParCle,
  produitPublic,
  listerProduits,
  produitParId,
  listeVariantes,
  stockReserve,
  stockVariante,
  majStock,
  annulerCommande,
  balayageCommandesImpayees,
};
