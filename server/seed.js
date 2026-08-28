/* Seed : zones de livraison, réglages boutique, produit de démo, compte admin.
   Idempotent : n'écrase jamais ce que l'admin a déjà modifié. */
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting, allSettings } = require('./db');
const { PUBLIC_DIR } = require('./paths');

/* Visuel de démo : JPG réel s'il est là, sinon le SVG généré (léger, hors-ligne). */
function visuel(nom) {
  const jpg = path.join(PUBLIC_DIR, 'media', 'demo', nom + '.jpg');
  try {
    if (fs.existsSync(jpg) && fs.statSync(jpg).size > 2048) return `/media/demo/${nom}.jpg`;
  } catch { /* ignore */ }
  return `/media/demo/${nom}.svg`;
}
const { hashPassword } = require('./security');

const ZONES = [
  // ---- Dakar (quartiers) : 1 000 – 2 000 F
  { nom: 'Plateau / Medina / Sedhiou Dakar', ville: 'Dakar', frais: 1000, delai_heures: 24 },
  { nom: 'Almadies / Ngor / Yoff / Ouakam', ville: 'Dakar', frais: 1000, delai_heures: 24 },
  { nom: 'Mermoz / Sacré-Cœur / Point E / Fann / Victor Hugo', ville: 'Dakar', frais: 1000, delai_heures: 24 },
  { nom: 'Grand Yoff / Liberté 6 / Ouest Foire / Sicap', ville: 'Dakar', frais: 1500, delai_heures: 30 },
  { nom: 'Grand-Dakar / Bango / Gueule Tapée / Fanal', ville: 'Dakar', frais: 1500, delai_heures: 30 },
  { nom: 'Médina Gounass / HLM / Guedi Site / Kirkoujar', ville: 'Dakar', frais: 1500, delai_heures: 36 },
  { nom: 'Nord-Foire / Malika / OuakamPlage / Thiaroye', ville: 'Dakar', frais: 2000, delai_heures: 36 },
  // ---- Banlieue : 2 000 – 2 500 F
  { nom: 'Pikine (Sicage, Niacou-Ndick, Mbingne, Yeumbeul, Cambérène)', ville: 'Banlieue', frais: 2000, delai_heures: 36 },
  { nom: 'Guédiawaye ( Golf, Sam Notaire, Ndiaffate, Keur Massar)', ville: 'Banlieue', frais: 2000, delai_heures: 36 },
  { nom: 'Rufisque / Bargy / Thiack / Yarakh', ville: 'Banlieue', frais: 2500, delai_heures: 48 },
  // ---- Autres régions (nosgara / yalwa) : 3 000 – 5 000 F
  { nom: 'Thiès / Kayar / Pout', ville: 'Région', frais: 3000, delai_heures: 60 },
  { nom: 'Mbour / Saly / Popenguine', ville: 'Région', frais: 3500, delai_heures: 66 },
  { nom: 'Diourbel / Bambey / Ndamatou', ville: 'Région', frais: 3500, delai_heures: 66 },
  { nom: 'Touba / Ndangalma / Touba Mosquée', ville: 'Région', frais: 4000, delai_heures: 72 },
  { nom: 'Kaolack / Nioro / Guinguinéo', ville: 'Région', frais: 4500, delai_heures: 78 },
  { nom: 'Fatick / Foundiougne / Sokone', ville: 'Région', frais: 4500, delai_heures: 78 },
  { nom: 'Saint-Louis / Darou Mousty / Richard Toll', ville: 'Région', frais: 5000, delai_heures: 90 },
  { nom: 'Louga / Linguère / Kébémer', ville: 'Région', frais: 5000, delai_heures: 90 },
  { nom: 'Tambacounda / Goudiry / Bakel', ville: 'Région', frais: 5000, delai_heures: 96 },
  { nom: 'Ziguinchor / Bignona / Oussouye', ville: 'Région', frais: 5000, delai_heures: 96 },
  { nom: 'Kolda / Vélingara / Sédhiou', ville: 'Région', frais: 5000, delai_heures: 96 },
];

const CATEGORIES = [
  { name: 'Femmes', emoji: '👗' },
  { name: 'Hommes', emoji: '👔' },
  { name: 'Enfants', emoji: '🧒' },
  { name: 'Chaussures & Sacs', emoji: '👜' },
  { name: 'Beauté & Parfums', emoji: '💄' },
  { name: 'Bijoux & Montres', emoji: '⌚' },
  { name: 'Maison & Divers', emoji: '🏠' },
];

const DEFAULT_SETTINGS = {
  nom_boutique: 'CHEZ FATOUCHA',
  slogan: 'La mode livrée chez toi, à Dakar et partout au Sénégal',
  boutique_description:
    'Robes, ensembles, sacs, chaussures, parfums… sélectionnés avec soin. Tu commandes, tu paies par Wave ou Orange Money, on livre.',
  telephone: '77 000 00 00',
  whatsapp: '221770000000',
  email: 'chezfatoucha@gmail.com',
  adresse_retrait: 'Pikine, en face du marché (quartier Sicage), Dakar',
  horaires_retrait: 'Lundi – Samedi, 9h – 19h',
  wave_numero: '77 000 00 00',
  wave_nom: 'Fatou (CHEZ FATOUCHA)',
  orange_numero: '76 000 00 00',
  orange_nom: 'Fatou (CHEZ FATOUCHA)',
  livraison_gratuite_a_partir: '35000',
  franchise_livraison: '0',
  caution_pourcentage: '20',
  expiration_commande_h: '6',
  delai_retrait_heures: '24',
  cinetpay_site_id: '',
  cinetpay_api_key: '',
  mode_paiement: 'auto', // auto = CinetPay si les clés existent, sinon déclaration + validation admin
  seo_keywords: 'mode, Dakar, livraison, robe, ensemble, sac, parfum, SHEIN, Wave, Orange Money',
};

function seed() {
  const out = { admins: [], zones: 0, categories: 0, produits: 0, settings: 0 };

  /* --- Réglages : on n'insère que les clés absentes --- */
  const exists = allSettings();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in exists)) {
      setSetting(k, v);
      out.settings += 1;
    }
  }

  /* --- Catégories --- */
  const nbCat = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (!nbCat) {
    const ins = db.prepare('INSERT INTO categories (name, emoji, ordre) VALUES (?,?,?)');
    CATEGORIES.forEach((c, i) => ins.run(c.name, c.emoji, i + 1));
    out.categories = CATEGORIES.length;
  }

  /* --- Zones de livraison --- */
  const nbZones = db.prepare('SELECT COUNT(*) AS n FROM zones_livraison').get().n;
  if (!nbZones) {
    const ins = db.prepare(
      'INSERT INTO zones_livraison (nom, ville, frais, delai_heures, ordre) VALUES (?,?,?,?,?)'
    );
    ZONES.forEach((z, i) => ins.run(z.nom, z.ville, z.frais, z.delai_heures, i + 1));
    out.zones = ZONES.length;
  }

  /* --- Administrateurs depuis l'environnement --- */
  const comptes = [
    { u: process.env.ADMIN1_USERNAME || 'admin', p: process.env.ADMIN1_PASSWORD || 'fatoucha2026', n: 'Fatou (propriétaire)' },
    { u: process.env.ADMIN2_USERNAME, p: process.env.ADMIN2_PASSWORD, n: 'Équipe boutique' },
  ].filter((a) => a.u && a.p);
  const insAdmin = db.prepare('INSERT INTO admins (username, password_hash, display_name) VALUES (?,?,?)');
  for (const a of comptes) {
    const deja = db.prepare('SELECT id FROM admins WHERE username = ?').get(a.u);
    if (!deja) {
      insAdmin.run(a.u, hashPassword(a.p), a.n);
      out.admins.push({ username: a.u, password: a.p });
    }
  }

  /* --- Produits de démonstration (premier lancement uniquement) --- */
  const nbProduits = db.prepare('SELECT COUNT(*) AS n FROM produits').get().n;
  if (!nbProduits) {
    const cat = (n) => db.prepare('SELECT id FROM categories WHERE name = ?').get(n)?.id || null;
    const ins = db.prepare(
      `INSERT INTO produits (titre, description, prix, prix_barre, prix_achat, marque, lien_source,
        delai_jours, images, tailles, coloris, stock, categorie_id, vedette)
       VALUES (@titre,@description,@prix,@prix_barre,@prix_achat,@marque,@lien_source,
        @delai_jours,@images,@tailles,@coloris,@stock,@categorie_id,@vedette)`
    );
    const insVar = db.prepare('INSERT INTO variantes (produit_id, taille, coloris, stock) VALUES (?,?,?,?)');
    const DEMO = [
      {
        titre: 'Robe longue bohème fleurie',
        description:
          'Robe fluide mi-saison, motif fleuri, bretelles réglables et taille resserrée par un lien. Parfaite pour les sorties et les cérémonies décontractées.',
        prix: 15000, prix_barre: 21000, prix_achat: 8500, marque: 'SHEIN',
        delai_jours: 7, stock: 12, categorie: 'Femmes', vedette: 1, img: 'robe-boheme',
        tailles: ['S', 'M', 'L', 'XL'], coloris: ['Rouge', 'Bleu nuit'],
      },
      {
        titre: 'Ensemble two-piece crop top + pantalon large',
        description: 'Ensemble 2 pièces en tissu viscose : top court à manches ballon et pantalon taille haute fluide.',
        prix: 19500, prix_barre: null, prix_achat: 11000, marque: 'SHEIN',
        delai_jours: 7, stock: 8, categorie: 'Femmes', vedette: 1, img: 'ensemble-two-piece',
        tailles: ['S', 'M', 'L'], coloris: ['Beige', 'Noir'],
      },
      {
        titre: 'Sac à main simili-cuir matelassé',
        description: 'Sac bandoulière matelassé, chaîne dorée, compartiment zippé + poche intérieure. Format A4.',
        prix: 12000, prix_barre: 15500, prix_achat: 6000, marque: 'TEMU',
        delai_jours: 10, stock: 15, categorie: 'Chaussures & Sacs', vedette: 1, img: 'sac-matelasse',
        tailles: [], coloris: ['Noir', 'Blanc', 'Rouge bordeaux'],
      },
      {
        titre: 'Baskets montantes street',
        description: 'Sneakers montantes semelle épaisse, laçage complet, doublure respirante. Pointures européennes.',
        prix: 24000, prix_barre: null, prix_achat: 13000, marque: '(vendeur local)',
        delai_jours: 5, stock: 9, categorie: 'Chaussures & Sacs', vedette: 0, img: 'baskets',
        tailles: ['39', '40', '41', '42', '43', '44'], coloris: ['Blanc', 'Noir'],
      },
      {
        titre: 'Parfum femme “Golden Oud” 100 ml',
        description: 'Eau de parfum sillage boisé-vanillé, tenue 8 h. Flacon verre doré, coffret offert.',
        prix: 9000, prix_barre: 12500, prix_achat: 4200, marque: 'Arabe import',
        delai_jours: 4, stock: 20, categorie: 'Beauté & Parfums', vedette: 1, img: 'parfum',
        tailles: [], coloris: [],
      },
      {
        titre: 'Montre femme acier doré + bracelet de rechange',
        description: 'Montre quartz boîtier acier plaqué or, bracelet maille milanaise + bracelet cuir offert.',
        prix: 11500, prix_barre: null, prix_achat: 5000, marque: 'TEMU',
        delai_jours: 10, stock: 6, categorie: 'Bijoux & Montres', vedette: 0, img: 'montre',
        tailles: [], coloris: ['Doré', 'Argenté'],
      },
      {
        titre: 'Chemise homme lin lavé',
        description: 'Chemise homme coupe droite en lin lavé, col cubain, respirante — idéale saison des pluies / harmattan.',
        prix: 13000, prix_barre: 17000, prix_achat: 7000, marque: 'SHEIN',
        delai_jours: 7, stock: 10, categorie: 'Hommes', vedette: 0, img: 'chemise-homme',
        tailles: ['M', 'L', 'XL', 'XXL'], coloris: ['Blanc', 'Vert kaki', 'Bleu ciel'],
      },
      {
        titre: 'Lot 3 bijoux acier inoxydable (collier + boucles)',
        description: 'Trois pièces acier inoxydable, ne noircissent pas, résistent à l’eau.',
        prix: 6500, prix_barre: 9000, prix_achat: 2500, marque: 'TEMU',
        delai_jours: 12, stock: 25, categorie: 'Bijoux & Montres', vedette: 0, img: 'bijoux',
        tailles: [], coloris: [],
      },
    ];
    const insCat = (n) => db.prepare('SELECT id FROM categories WHERE name = ?').get(n)?.id || null;
    for (const p of DEMO) {
      const images = [{ url: visuel(p.img), is_main: 1, legende: p.titre }];
      const r = ins.run({
        titre: p.titre,
        description: p.description,
        prix: p.prix,
        prix_barre: p.prix_barre,
        prix_achat: p.prix_achat,
        marque: p.marque,
        lien_source: '',
        delai_jours: p.delai_jours,
        images: JSON.stringify(images),
        tailles: JSON.stringify(p.tailles),
        coloris: JSON.stringify(p.coloris),
        stock: p.stock,
        categorie_id: insCat(p.categorie),
        vedette: p.vedette,
      });
      const pid = Number(r.lastInsertRowid);
      const sizes = p.tailles.length ? p.tailles : [null];
      const colors = p.coloris.length ? p.coloris : [null];
      const nb = sizes.length * colors.length;
      const parVariante = Math.max(2, Math.round(p.stock / nb));
      let total = 0;
      for (const s of sizes) for (const c of colors) { insVar.run(pid, s, c, parVariante); total += parVariante; }
      db.prepare('UPDATE produits SET stock = ? WHERE id = ?').run(total, pid);
      out.produits += 1;
    }
  }

  return out;
}

module.exports = { seed, ZONES, DEFAULT_SETTINGS };
