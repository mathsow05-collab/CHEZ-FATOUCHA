const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('./paths');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'fatoucha.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* Statuts de commande qui « réservent » le stock : on ne peut pas vendre deux
   fois la même pièce tant que la commande est vivante. */
const STOCK_STATUTS_ACTIFS = ['nouvelle', 'payee', 'en_preparation', 'expediee'];

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  emoji TEXT DEFAULT '🛍️',
  ordre INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS produits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  titre        TEXT NOT NULL,
  description  TEXT,
  prix         INTEGER NOT NULL,           -- prix de vente client, en FCFA
  prix_barre   INTEGER,                    -- ancien prix affiché barré (promo)
  prix_achat   INTEGER,                    -- prix fournisseur (interne admin)
  marque       TEXT,                       -- ex. SHEIN, TEMU, KOTA
  lien_source  TEXT,                       -- lien d'origine (visible admin seulement)
  delai_jours  INTEGER NOT NULL DEFAULT 7, -- délai estimé d'approvisionnement
  images       TEXT NOT NULL DEFAULT '[]', -- JSON [{url, is_main}]
  tailles      TEXT NOT NULL DEFAULT '[]', -- JSON ["S","M","L"]
  coloris      TEXT NOT NULL DEFAULT '[]', -- JSON ["Rouge","Noir"]
  stock        INTEGER NOT NULL DEFAULT 1, -- global si pas de variantes
  categorie_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  actif        INTEGER NOT NULL DEFAULT 1,
  vedette      INTEGER NOT NULL DEFAULT 0, -- mis en avant sur l'accueil
  vues         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_produits_actif ON produits(actif, vedette DESC, id DESC);

-- Stock affiné par variante (« M + Rouge » = 3 pièces). Optionnel.
CREATE TABLE IF NOT EXISTS variantes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  taille     TEXT,
  coloris    TEXT,
  stock      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(produit_id, taille, coloris)
);

CREATE TABLE IF NOT EXISTS zones_livraison (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nom          TEXT NOT NULL,
  ville        TEXT NOT NULL DEFAULT 'Dakar',
  frais        INTEGER NOT NULL DEFAULT 1000,  -- FCFA
  delai_heures INTEGER NOT NULL DEFAULT 24,
  actif        INTEGER NOT NULL DEFAULT 1,
  ordre        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS commandes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT UNIQUE NOT NULL,
  client         TEXT NOT NULL,
  telephone      TEXT NOT NULL,
  adresse        TEXT,
  zone_id        INTEGER REFERENCES zones_livraison(id) ON DELETE SET NULL,
  mode           TEXT NOT NULL DEFAULT 'livraison',  -- 'livraison' | 'retrait'
  instructions   TEXT,
  sous_total     INTEGER NOT NULL DEFAULT 0,
  frais          INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  paiement       TEXT NOT NULL DEFAULT 'wave',       -- 'wave' | 'orange' | 'especes'
  statut_paiement TEXT NOT NULL DEFAULT 'en_attente',-- 'en_attente' | 'paye' | 'echoue'
  prestataire    TEXT,                               -- 'cinetpay' | 'direct' | 'especes'
  transaction_id TEXT,
  statut         TEXT NOT NULL DEFAULT 'nouvelle',   -- nouvelle|payee|en_preparation|expediee|livree|annulee
  payee_le       TEXT,
  expediee_le    TEXT,
  livree_le      TEXT,
  annulee_le     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_commandes_tel ON commandes(telephone);
CREATE INDEX IF NOT EXISTS idx_commandes_statut ON commandes(statut);

CREATE TABLE IF NOT EXISTS commande_lignes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  produit_id  INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  titre       TEXT NOT NULL,      -- copie figée au moment de la commande
  image       TEXT,
  taille      TEXT,
  coloris     TEXT,
  prix_unitaire INTEGER NOT NULL,
  quantite    INTEGER NOT NULL,
  total_ligne INTEGER NOT NULL,
  delai_jours INTEGER NOT NULL DEFAULT 7
);
CREATE INDEX IF NOT EXISTS idx_lignes_commande ON commande_lignes(commande_id);

-- Avis client : notes et photos des acheteuses. Un avis n'est « vérifié » que
-- s'il est rattaché à une commande livrée (clé = référence + fin du numéro).
CREATE TABLE IF NOT EXISTS avis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id      INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  commande_id     INTEGER REFERENCES commandes(id) ON DELETE SET NULL,
  prenom          TEXT NOT NULL,
  note            INTEGER NOT NULL,
  texte           TEXT,
  photo           TEXT,
  taille          TEXT,
  achat_verifie   INTEGER NOT NULL DEFAULT 0,
  approuve        INTEGER NOT NULL DEFAULT 0,
  reponse         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_avis_produit ON avis(produit_id, approuve);

-- Alertes « préviens-moi quand c'est de retour » (ruptures).
CREATE TABLE IF NOT EXISTS alertes_stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  telephone  TEXT NOT NULL,
  notifie_le TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertes_uniques ON alertes_stock(produit_id, telephone);

-- Panier enregistré côté serveur : reprise sur un autre appareil + relance.
CREATE TABLE IF NOT EXISTS paniers (
  jeton      TEXT PRIMARY KEY,
  telephone  TEXT,
  client     TEXT,
  items      TEXT NOT NULL DEFAULT '[]',
  total      INTEGER NOT NULL DEFAULT 0,
  code_reprise TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Événements de mesure (entonnoir) : aucune donnée personnelle, juste des ids.
CREATE INDEX IF NOT EXISTS idx_paniers_tel ON paniers(telephone);

CREATE TABLE IF NOT EXISTS evenements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  produit_id INTEGER,
  seance     TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_evenements_type ON evenements(type, created_at);

-- Pages de contenu (FAQ, retours, livraison…) écrites depuis l'admin.
CREATE TABLE IF NOT EXISTS pages (
  slug       TEXT PRIMARY KEY,
  titre      TEXT NOT NULL,
  corps      TEXT NOT NULL DEFAULT '',
  meta_desc  TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL DEFAULT 'client',
  ref        TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

/* ------------------------------------------------------------------ */
/* Migrations douces — une base déjà peuplée reçoit les nouveautés      */
/* sans rien perdre. Toujours « ajouter », jamais supprimer.            */
/* ------------------------------------------------------------------ */
function colonnes(table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  } catch {
    return new Set();
  }
}

function ajouterColonne(table, definition) {
  const nom = String(definition).trim().split(/\s+/)[0];
  if (!colonnes(table).has(nom)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

/* Fiches produit : URL propre, vidéo, guide des tailles, mannequin, texte alternatif. */
ajouterColonne('produits', 'slug TEXT');
ajouterColonne('produits', 'video_url TEXT');
/* La miniature de la vidéo, recopiée chez nous à l'enregistrement : la fiche ne doit
   pas dépendre d'un serveur tiers pour afficher une image. */
ajouterColonne('produits', 'video_miniature TEXT');
ajouterColonne('produits', 'mannequin TEXT');
ajouterColonne('produits', 'guide_tailles TEXT NOT NULL DEFAULT \'{}\'');
/* Catégories : URL /categorie/<slug>. */
ajouterColonne('categories', 'slug TEXT');
/* Commandes : confirmation de la cliente avant départ du livreur (anti fausses
   commandes en espèces) + acompte éventuel + note de risque. */
ajouterColonne('commandes', 'code_confirmation TEXT');
ajouterColonne('commandes', 'client_confirme_le TEXT');
ajouterColonne('commandes', 'acompte INTEGER NOT NULL DEFAULT 0');
ajouterColonne('commandes', 'reste_a_payer INTEGER NOT NULL DEFAULT 0');
ajouterColonne('commandes', 'cod_risque INTEGER NOT NULL DEFAULT 0');

/* --- Les URLs lisibles (slug) ---------------------------------------------
   /produit/robe-longue-boheme plutot que /#/produit/5 : indispensable pour
   Google et pour l'aperçu de lien dans WhatsApp. Un slug est dérivé du titre ;
   on le remplit une fois pour les articles déjà en base, et on le garde
   stable ensuite (sinon toutes les URLs partagées cesseraient de fonctionner). */
function slugifier(texte, defaut = 'article') {
  const s = String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : defaut;
}

function slugLibre(base, table = 'produits', excepteId = null) {
  let essai = base;
  for (let n = 2; n < 60; n++) {
    const q = excepteId
      ? db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(essai, excepteId)
      : db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(essai);
    if (!q) return essai;
    essai = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function assurerSlugs() {
  let n = 0;
  for (const c of db.prepare('SELECT id, name FROM categories WHERE slug IS NULL OR slug = \'\'').all()) {
    db.prepare('UPDATE categories SET slug = ? WHERE id = ?').run(slugLibre(slugifier(c.name, 'categorie'), 'categories', c.id), c.id);
    n++;
  }
  for (const p of db.prepare('SELECT id, titre FROM produits WHERE slug IS NULL OR slug = \'\'').all()) {
    db.prepare('UPDATE produits SET slug = ? WHERE id = ?').run(slugLibre(slugifier(p.titre), 'produits', p.id), p.id);
    n++;
  }
  if (n) console.log(`[seo] ${n} URL(s) lisible(s) générée(s)`);
  return n;
}
assurerSlugs();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_slug ON produits(slug) WHERE slug IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug) WHERE slug IS NOT NULL');

/* ------------------------------------------------------------------ */
/* Réglages boutique — tout est modifiable depuis l'espace admin.      */
/* ------------------------------------------------------------------ */
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value === null || value === undefined ? '' : String(value));
}

function allSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function addLog(action, { source = 'client', ref = null, details = null, req = null } = {}) {
  try {
    db.prepare('INSERT INTO logs (source, ref, action, details, ip) VALUES (?,?,?,?,?)').run(
      source,
      ref,
      action,
      details,
      req ? req.ip : null
    );
  } catch (e) {
    console.error('[log] écriture impossible :', e.message);
  }
}

module.exports = {
  db,
  getSetting,
  setSetting,
  allSettings,
  addLog,
  STOCK_STATUTS_ACTIFS,
  colonnes,
  ajouterColonne,
  slugifier,
  slugLibre,
  assurerSlugs,
};
