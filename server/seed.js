/* Seed : zones de livraison, réglages boutique, produit de démo, compte admin.
   Idempotent : n'écrase jamais ce que l'admin a déjà modifié. */
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting, allSettings, slugifier, slugLibre } = require('./db');
const { PUBLIC_DIR } = require('./paths');

/* Visuel de démo : JPG réel s'il est là, sinon le SVG généré (léger, hors-ligne). */
function visuel(nom) {
  const jpg = path.join(PUBLIC_DIR, 'media', 'demo', nom + '.jpg');
  try {
    if (fs.existsSync(jpg) && fs.statSync(jpg).size > 2048) return `/media/demo/${nom}.jpg`;
  } catch { /* ignore */ }
  return `/media/demo/${nom}.svg`;
}
/* Les vues supplémentaires (détail du tissu, tombé du bas) sont optionnelles :
   elles existent quand le script de démo a pu tailler dans la photo. */
function vuesEnPlus(nom) {
  const ajoutes = [];
  for (const [suf, legende] of [['-2', 'Détail du tissu'], ['-3', 'Le tombé, vu de plus près']]) {
    const f = path.join(PUBLIC_DIR, 'media', 'demo', nom + suf + '.jpg');
    try {
      if (fs.existsSync(f) && fs.statSync(f).size > 2048) ajoutes.push({ url: `/media/demo/${nom}${suf}.jpg`, legende });
    } catch { /* ignore */ }
  }
  return ajoutes;
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
  /* Paiement à la livraison : au-delà de ce montant, on demande un petit
     acompte — ça divise à peu près par deux les commandes qui n'aboutissent pas. */
  cod_acompte_a_partir: '25000',
  cod_acompte_montant: '2000',
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
    const ins = db.prepare('INSERT INTO categories (name, emoji, ordre, slug) VALUES (?,?,?,?)');
    CATEGORIES.forEach((c, i) => ins.run(c.name, c.emoji, i + 1, slugLibre(slugifier(c.name, 'categorie'), 'categories')));
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
        delai_jours, images, tailles, coloris, stock, categorie_id, vedette, slug, mannequin, guide_tailles)
       VALUES (@titre,@description,@prix,@prix_barre,@prix_achat,@marque,@lien_source,
        @delai_jours,@images,@tailles,@coloris,@stock,@categorie_id,@vedette,@slug,@mannequin,@guide_tailles)`
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
        mannequin: 'Photo portée par Awa, 1,72 m, 58 kg — elle porte du S.',
        guide: { S: { poitrine: 86, taille: 68, hanches: 92, longueur: 132 }, M: { poitrine: 90, taille: 72, hanches: 96, longueur: 134 }, L: { poitrine: 96, taille: 78, hanches: 102, longueur: 136 }, XL: { poitrine: 102, taille: 84, hanches: 108, longueur: 138 } },
      },
      {
        titre: 'Ensemble two-piece crop top + pantalon large',
        description: 'Ensemble 2 pièces en tissu viscose : top court à manches ballon et pantalon taille haute fluide.',
        prix: 19500, prix_barre: null, prix_achat: 11000, marque: 'SHEIN',
        delai_jours: 7, stock: 8, categorie: 'Femmes', vedette: 1, img: 'ensemble-two-piece',
        tailles: ['S', 'M', 'L'], coloris: ['Beige', 'Noir'],
        mannequin: 'Photo portée par Awa, 1,72 m — taille S ; le pantalon taille haute.',
        guide: { S: { poitrine: 88, taille: 66, hanches: 94, longueur: 100 }, M: { poitrine: 92, taille: 70, hanches: 98, longueur: 101 }, L: { poitrine: 98, taille: 76, hanches: 104, longueur: 102 } },
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
        mannequin: 'Pointure habituelle OK — semelle légèrement épaisse, prends ta taille.',
        guide: { 39: { longueur: 245 }, 40: { longueur: 252 }, 41: { longueur: 260 }, 42: { longueur: 267 }, 43: { longueur: 275 }, 44: { longueur: 282 } },
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
        mannequin: 'Portée par Mor, 1,80 m — il prend du L pour une coupe ample.',
        guide: { M: { poitrine: 104, epaule: 45, manche: 62, longueur: 72 }, L: { poitrine: 110, epaule: 46, manche: 63, longueur: 74 }, XL: { poitrine: 116, epaule: 48, manche: 64, longueur: 75 }, XXL: { poitrine: 122, epaule: 50, manche: 65, longueur: 76 } },
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
      const images = [{ url: visuel(p.img), is_main: 1, legende: p.titre }, ...vuesEnPlus(p.img)];
      const r = ins.run({
        slug: slugLibre(slugifier(p.titre), 'produits', null),
        mannequin: p.mannequin || null,
        guide_tailles: JSON.stringify(p.guide || {}),
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

  /* --- Pages de contenu : FAQ, retours, livraison, à-propos -----------------
     Écrites une seule fois au premier lancement ; la boutique les modifie
     ensuite depuis l'espace vendeur (onglet « Contenus & avis »). Elles
     répondent aux questions qui bloquent un achat et rendent le site lisible
     par Google (balisage Questions/Réponses généré depuis ce texte). */
  const PAGES_DEFAUT = {
    faq: {
      titre: 'Questions fréquentes',
      meta_desc: 'Livraison, paiement Wave et Orange Money, tailles, échanges : les réponses aux questions les plus posées chez Chez Fatoucha.',
      corps: `Commander ici est simple. Voici ce que les clientes demandent le plus souvent — et si ta question n'y est pas, écris-nous sur WhatsApp, on répond en quelques minutes.

## Combien coûte la livraison et où livrez-vous ?
À Dakar, la course coûte entre 1 000 F et 2 000 F selon le quartier, et 2 000 F à 2 500 F en banlieue. Dans les régions (Thiès, Mbour, Touba, Kaolack, Saint-Louis, Ziguinchor…), compte 3 000 F à 5 000 F. Le montant exact s'affiche dès que tu choisis ta zone, avant de payer. **La livraison est offerte à partir de 35 000 F d'achats**, et le retrait à la boutique est toujours gratuit.

## En combien de temps je reçois ma commande ?
Chaque fiche indique un délai : c'est le temps que la pièce arrive du fournisseur (en général 4 à 12 jours). Ensuite la livraison à Dakar prend 24 à 36 heures, et 2 à 4 jours pour les régions. Le site additionne les deux et t'annonce une estimation avant que tu paies.

## Comment payer ?
Par Wave ou Orange Money directement depuis le site — le numéro de la boutique et la référence à inscrire en commentaire s'affichent tout seuls. Tu peux aussi payer en espèces à la livraison. Au-delà de 25 000 F en espèces, on demande un acompte de 2 000 F : ça confirme la commande des deux côtés.

## Et si la taille ne va pas ?
Tu as 48 heures après la réception pour nous écrire sur WhatsApp, article non porté et dans son état d'origine. On échange la taille, ou contre un article de même valeur. Les frais de retour restent à ta charge (le prix d'une course).

## Comment être sûre que la pièce ressemble à la photo ?
Les fiches portent les mesures en centimètres (poitrine, taille, hanches, longueur) et indiquent la taille de la personne qui porte le vêtement sur la photo. Tu peux aussi demander une photo ou une vidéo de l'article réel sur WhatsApp avant de payer : on l'envoie volontiers.

## Mes données sont-elles gardées quelque part ?
Seulement ce qu'il faut pour livrer : nom, téléphone, adresse. Pas de compte à créer, aucun outil de suivi publicitaire, rien de revendu. Tu peux demander la suppression en écrivant à la boutique.`,
    },
    retours: {
      titre: 'Échanges & retours',
      meta_desc: 'La taille ne va pas ? Échange possible sous 48 heures chez Chez Fatoucha, à Dakar et en régions.',
      corps: `Commander des vêtements à distance n'est jamais sûr à 100 %. Voici la règle, simple et écrite.

## Le délai
**48 heures** après la réception de ton colis pour nous prévenir sur WhatsApp ou par téléphone. Passé ce délai, on ne peut plus garantir l'échange, sauf si la pièce était abîmée à la livraison.

## L'état de l'article
Article non porté en sortie, non lavé, sans tache ni parfum, dans son emballage d'origine. Les bijoux et les parfums ouverts ne sont pas échangeables, pour des raisons d'hygiène.

## Ce que tu peux choisir
Un échange de taille ou de coloris, un échange contre un article de même valeur, ou un avoir pour une prochaine commande. Si aucune de ces options ne te convient, écris-nous : on trouve une solution amiable.

## Les frais
L'aller-retour reste à ta charge (une course, 1 000 à 2 000 F à Dakar). Si l'erreur vient de nous — mauvaise pièce, article abîmé — on paie tout et la livraison de la nouvelle commande est offerte.

## Comment faire, en pratique
1. Envoie une photo de l'article et ta référence de commande sur WhatsApp.
2. On te confirme l'échange et l'adresse.
3. Le livreur repasse chercher ; tu reçois la nouvelle pièce sous 24 à 48 heures à Dakar.`,
    },
    livraison: {
      titre: 'Livraison & délais',
      meta_desc: '21 zones desservies à Dakar, en banlieue et dans les régions : tarifs, délais et retrait gratuit en boutique.',
      corps: `On livre partout au Sénégal, avec un tarif clair par zone — jamais de surprise au moment de payer.

## Dakar ville
Entre 1 000 F et 2 000 F selon le quartier (Plateau, Almadies, Mermoz, Sicap, Grand Yoff, HLM, Ouakam…). Livraison en 24 à 36 heures une fois la commande validée.

## Banlieue
Pikine, Guédiawaye, Rufisque, Cambérène, Yeumbeul : 2 000 F à 2 500 F, sous 36 à 48 heures.

## Les régions
Thiès, Mbour, Saly, Diourbel, Touba, Kaolack, Fatick, Saint-Louis, Louga, Tambacounda, Ziguinchor, Kolda : 3 000 F à 5 000 F, en 2 à 4 jours. On passe par un transporteur fiable et on t'envoie le numéro du chauffeur.

## Retrait en boutique
Gratuit, du lundi au samedi de 9 h à 19 h. Tu essaies sur place et tu paies sur place si tu préfères.

## Avant que le livreur parte
On t'appelle ou on t'écrit sur WhatsApp pour vérifier que tu es bien là. Les commandes en espèces au-delà de 25 000 F demandent un petit acompte : ça évite les courses perdues pour tout le monde.

## Livraison offerte
Dès 35 000 F d'achats à Dakar et en banlieue.`,
    },
    'a-propos': {
      titre: 'La maison',
      meta_desc: 'Chez Fatoucha : robes, ensembles, sacs, chaussures et parfums choisis pièce par pièce, livrés à Dakar et dans les régions.',
      corps: `Chez Fatoucha, c'est une boutique de quartier à Pikine, en face du marché, devenue site web pour que les clientes des régions puissent commander aussi.

## Ce qu'on choisit
Robes, ensembles, sacs, chaussures, montres, parfums. Chaque pièce est sélectionnée à la main, en petite quantité : quand un modèle est épuisé, il ne revient pas forcément. C'est le principe d'une boutique qui préfère vendre ce qu'elle a essayé.

## Les prix
Ils affichent le coût réel : la pièce, le transport, la douane, la livraison. Pas de prix gonflés puis « -70 % » toute l'année. Les prix barrés correspondent à un prix qui a vraiment existé.

## Pourquoi les photos sont simples
Beaucoup d'articles sont photographiés à la maison, à plat ou portés par une amie. Ce n'est pas parfait, mais c'est la vraie pièce que tu vas recevoir. De plus en plus de fiches montrent des photos de clientes : c'est ce qui rassure le mieux, et tu peux nous envoyer les tiennes après réception.

## Nous joindre
WhatsApp au 77 000 00 00, boutique ouverte du lundi au samedi, 9 h – 19 h.`,
    },
  };
  const insPage = db.prepare('INSERT INTO pages (slug, titre, corps, meta_desc) VALUES (?,?,?,?)');
  let nbPages = 0;
  for (const [slugPage, p] of Object.entries(PAGES_DEFAUT)) {
    if (!db.prepare('SELECT slug FROM pages WHERE slug = ?').get(slugPage)) {
      insPage.run(slugPage, p.titre, p.corps, p.meta_desc);
      nbPages++;
    }
  }
  if (nbPages) out.pages = nbPages;

  /* Les URLs lisibles (catégories comprises) sont calculées ici aussi : sur une
     base neuve, l'appel au démarrage de db.js tombait avant le seed. */
  try { require('./db').assurerSlugs(); } catch { /* non bloquant */ }

  return out;
}

module.exports = { seed, ZONES, DEFAULT_SETTINGS };
