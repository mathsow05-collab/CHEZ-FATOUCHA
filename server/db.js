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

module.exports = { db, getSetting, setSetting, allSettings, addLog, STOCK_STATUTS_ACTIFS };
