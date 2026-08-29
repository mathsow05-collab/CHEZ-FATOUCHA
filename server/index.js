require('./env');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[sécurité] JWT_SECRET absent : secret temporaire généré (les sessions admin sauteront au redémarrage).');
}

const { db, getSetting, addLog } = require('./db');
const optima = require('./optima');
const { seed } = require('./seed');
const { PUBLIC_DIR, UPLOADS_DIR, DATA_DIR, ADMIN_UI_DIR } = require('./paths');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

/* ------------------------- En-têtes de sécurité ------------------------- */
/* CSP volontairement souple sur les images : les photos produits viennent de
   l'extérieur (un lien téléversé par l'admin). Les scripts restent locaux. */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      /* les lecteurs vidéo intégrés (voir server/videos.js : même liste) */
      require('./videos').directiveCadre(),
      "img-src 'self' data: blob: https: http:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      // Anti click-jacking : strict par défaut. ALLOW_FRAMES=1 ne sert qu'à un
      // aperçu local (iframe d'un outil de dev) — ne jamais l'activer en prod.
      process.env.ALLOW_FRAMES === '1' ? 'frame-ancestors *' : "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
});

/* ------------------------- API ------------------------- */
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    service: getSetting('nom_boutique', 'CHEZ FATOUCHA'),
    paiement: require('./paiement').mode(),
    date: new Date().toISOString(),
    /* où en est la préparation des vignettes (voir server/rechauffage.js) : utile
       pour comprendre pourquoi la toute première visite est plus lente */
    images: require('./rechauffage').etatPublic(),
  })
);

app.use('/api', require('./routes/boutique'));
app.use('/api/paiement', require('./paiement').router);
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable.' }));

/* Photos téléversées par l'admin (contenu public). */
fs.mkdirSync(path.join(UPLOADS_DIR, 'produits'), { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true, index: false }));
/* Visuels de démonstration livrés avec le code. */
app.use('/media', express.static(path.join(PUBLIC_DIR, 'media'), { maxAge: '1d' }));

/* ------------- Frontend — espace vendeur (page privée, URL au choix) -------------
   Le back-office est une page à part, servie sur CHEMIN_ADMIN (défaut /admin).
   Rien, dans les fichiers destinés au public, ne mène à cette URL : ni lien,
   ni menu, ni route interne, et le code du back-office n'est jamais chargé dans
   le navigateur d'une cliente. Les fichiers vivent hors de public/ : ils ne
   sont accessibles que par les trois routes ci-dessous — plus l'identifiant et
   le mot de passe. */
const CHEMIN_ADMIN = (() => {
  const brut = (process.env.CHEMIN_ADMIN || '/admin').trim().replace(/\/+$/, '');
  const net = brut.startsWith('/') ? brut : `/${brut}`;
  if (!/^\/[a-z0-9][a-z0-9_-]{0,39}$/i.test(net) || net === '/api' || net === '/uploads' || net === '/media' || net === '/css' || net === '/js') {
    console.warn(`[admin] CHEMIN_ADMIN « ${process.env.CHEMIN_ADMIN} » refusé (une seule tranche : lettres, chiffres, - et _, ex. /admin) → /admin utilisé.`);
    return '/admin';
  }
  return net;
})();
/* Le HTML est un gabarit : __BASE__ prend la valeur de CHEMIN_ADMIN à chaque
   requête, le fichier sur disque ne mentionne donc jamais l'URL réelle. */
const PAGE_ADMIN = path.join(ADMIN_UI_DIR, 'index.html');
const ENVOI_ADMIN = {
  '': { fichier: 'index.html', type: 'text/html; charset=utf-8' },
  'admin.css': { fichier: 'admin.css', type: 'text/css; charset=utf-8' },
  'admin.js': { fichier: 'admin.js', type: 'text/javascript; charset=utf-8' },
};
for (const [suffixe, meta] of Object.entries(ENVOI_ADMIN)) {
  const url = suffixe ? `${CHEMIN_ADMIN}/${suffixe}` : [CHEMIN_ADMIN, `${CHEMIN_ADMIN}/`];
  app.get(url, (req, res) => {
    const fichier = path.join(ADMIN_UI_DIR, meta.fichier);
    if (!fs.existsSync(fichier)) return res.status(503).send(`Fichier du back-office absent : admin-ui/${meta.fichier}`);
    res.setHeader('Content-Type', meta.type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow'); /* hors des moteurs de recherche */
    if (suffixe) return res.sendFile(fichier);
    return res.send(fs.readFileSync(fichier, 'utf8').split('__BASE__').join(CHEMIN_ADMIN));
  });
}

/* ------------------------- Images optimisées à la volée -------------------------
   /img/480/media/demo/robe-boheme.jpg renvoie un WebP de 480 px, mis en cache
   sur le disque : une vignette ne pèse plus le poids d'un cliché de téléphone. */
app.use('/img', optima.route());

/* ------------------------- Fichiers pour les moteurs -------------------------
   sitemap.xml et robots.txt sont construits depuis la base : ils suivent tout
   seuls les articles publiés ou masqués par la boutique. */
const SEO = require('./pages');
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(SEO.sitemap(SEO.baseAbsolue(req)));
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(SEO.robots(SEO.baseAbsolue(req)));
});

/* Manifeste et service worker : le site s'installe sur l'écran d'accueil et
   garde le catalogue en cache pour les réseaux lents. */
app.get('/manifest.webmanifest', (req, res) => {
  const f = path.join(PUBLIC_DIR, 'manifest.webmanifest');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(fs.readFileSync(f, 'utf8'));
});
app.get('/sw.js', (req, res) => {
  const f = path.join(PUBLIC_DIR, 'sw.js');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); /* un worker périmé serait pire qu'aucun */
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(fs.readFileSync(f, 'utf8'));
});

/* ------------------------- Pages rendues par le serveur -------------------------
   Ce que Google, WhatsApp et Instagram voient de la boutique : titre, prix,
   photos, note moyenne, guide des tailles — directement dans le HTML reçu,
   avant tout JavaScript. Le front prend ensuite la main sur la même URL. */
const cat = require('./catalogue');
const PAGES_SLUGS = ['faq', 'retours', 'livraison', 'a-propos'];

function reponseHTML(res, corps, statut = 200) {
  res.status(statut);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', statut === 200 ? 'public, max-age=60, stale-while-revalidate=300' : 'no-store');
  res.send(corps);
}

function pageSimple(titre, texte, statut = 200) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${SEO.ech(titre)} — ${SEO.ech(getSetting('nom_boutique', 'CHEZ FATOUCHA'))}</title>
<link rel="stylesheet" href="/css/style.css" /></head>
<body><div class="wrap"><div class="bloc"><h1>${SEO.ech(titre)}</h1><p>${SEO.ech(texte)}</p>
<p><a class="btn gold" href="/boutique">← Retour à la boutique</a></p></div></div></body></html>`;
}

function retrouverCommande(req) {
  const ref = String(req.params.reference || '').trim().toUpperCase();
  const code = String(req.params.code || '').trim().toUpperCase();
  const c = db.prepare('SELECT * FROM commandes WHERE reference = ?').get(ref);
  if (!c) return { cmd: null, erreur: 'Commande introuvable.' };
  if (code && String(c.code_confirmation || '').toUpperCase() !== code) return { cmd: null, erreur: 'Ce lien n’est plus valable.' };
  return { cmd: c };
}
const COMMANDE_VIDE = { reference: '—', client: '', total: 0, frais: 0, paiement: 'especes' };

app.get(['/', '/index.html'], (req, res, next) => {
  try {
    reponseHTML(res, SEO.accueil(req));
  } catch (e) {
    console.error('[ssr] accueil :', e.message);
    next();
  }
});

app.get('/boutique', (req, res, next) => {
  try {
    const v = req.query;
    reponseHTML(res, SEO.boutique(req, { q: String(v.q || '').slice(0, 80), categorie: v.categorie || null, tri: String(v.tri || 'recent') }));
  } catch (e) {
    console.error('[ssr] boutique :', e.message);
    next();
  }
});

app.get('/produit/:cle', (req, res, next) => {
  try {
    const cle = String(req.params.cle || '').slice(0, 90);
    const row = cat.produitParCle(cle, { includeInactive: true });
    if (!row) return reponseHTML(res, pageSimple('Article indisponible', 'Cette pièce n’est plus au catalogue.', 404), 404);
    /* un ancien lien partagé /produit/5 repart vers l'URL lisible */
    if (/^\d+$/.test(cle) && row.slug) return res.redirect(301, `/produit/${row.slug}`);
    if (!row.actif) return res.redirect(302, '/boutique');
    reponseHTML(res, SEO.produit(req, row));
  } catch (e) {
    console.error('[ssr] produit :', e.message);
    next();
  }
});

app.get('/categorie/:cle', (req, res, next) => {
  try {
    const c = cat.categorieParCle(String(req.params.cle || '').slice(0, 80));
    if (!c) return reponseHTML(res, pageSimple('Catégorie introuvable', 'Cette catégorie n’existe plus.', 404), 404);
    if (/^\d+$/.test(String(req.params.cle)) && c.slug) return res.redirect(301, `/categorie/${c.slug}`);
    reponseHTML(res, SEO.categorie(req, c));
  } catch (e) {
    console.error('[ssr] catégorie :', e.message);
    next();
  }
});

/* Les Shorts : une vraie page rendue côté serveur (les liens verticaux doivent
   être crawlables et la page doit s'afficher sans JavaScript), et une rubrique
   sur l'accueil. Tant qu'aucun article n'a de vidéo verticale, le menu n'en
   parle pas : mieux vaut une absence qu'une vitrine vide. */
app.get('/shorts', (req, res, next) => {
  try {
    reponseHTML(res, SEO.pageCourts(req));
  } catch (e) {
    console.error('[ssr] shorts :', e.message);
    next();
  }
});

for (const slugP of PAGES_SLUGS) {
  app.get('/' + slugP, (req, res, next) => {
    try {
      const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slugP);
      if (!page) return next();
      reponseHTML(res, SEO.pageContenu(req, page, { avecFaq: slugP === 'faq' }));
    } catch (e) {
      console.error('[ssr] page :', e.message);
      next();
    }
  });
}

/* Confirmation d'une commande en espèces : un bouton, aucun JavaScript
   nécessaire (le lien arrive par WhatsApp). Le code reçu sert de clé. */
app.get('/confirmer/:reference/:code', (req, res, next) => {
  try {
    const { cmd, erreur } = retrouverCommande(req);
    /* Rien trouvé (référence inconnue ou code qui ne colle pas) : surtout pas le
       formulaire « Oui, je confirme » d'une commande vide. Une page qui explique,
       en 404, pour que Google n'indexe rien et que la cliente sache quoi faire. */
    if (!cmd) {
      return reponseHTML(res, SEO.confirmation(req, {
        cmd: { ...COMMANDE_VIDE, reference: String(req.params.reference || '').toUpperCase() || '—' },
        erreur: erreur || 'Commande introuvable.',
        introuvable: true,
      }), 404);
    }
    reponseHTML(res, SEO.confirmation(req, { cmd }), 200);
  } catch (e) {
    console.error('[confirmer] GET :', e.message);
    next();
  }
});
app.post('/confirmer/:reference/:code', (req, res, next) => {
  try {
    const { cmd } = retrouverCommande(req);
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!cmd || (cmd.code_confirmation && code !== String(cmd.code_confirmation).toUpperCase())) {
      return reponseHTML(res, SEO.confirmation(req, {
        cmd: cmd || { ...COMMANDE_VIDE, reference: String(req.params.reference || '').toUpperCase() },
        erreur: 'Ce lien n’est plus valable — écris-nous sur WhatsApp.',
      }), 400);
    }
    if (cmd.statut !== 'annulee' && !cmd.client_confirme_le) {
      db.prepare('UPDATE commandes SET client_confirme_le = ? WHERE id = ?').run(new Date().toISOString(), cmd.id);
      addLog('commande_confirmee', { source: 'client', ref: cmd.reference, details: 'page', req });
    }
    return reponseHTML(res, SEO.confirmation(req, { cmd: db.prepare('SELECT * FROM commandes WHERE id = ?').get(cmd.id), ok: true }));
  } catch (e) {
    console.error('[confirmer] POST :', e.message);
    next();
  }
});

/* ------------------------- Frontend (application) -------------------------
   Le reste du site (panier, commande, paiement, suivi) reste rendu par le
   front ; ces URLs-là sont en noindex, elles n'ont rien à chercher. */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
/* Toute URL qui n'est pas une ressource de l'API renvoie le SPA (routes à #). */
app.use((req, res, next) => {
  const p = req.path || '/';
  if (req.method !== 'GET' || p.startsWith('/api/') || p.startsWith('/uploads/') || p.startsWith('/media/')) return next();
  /* une URL qui ressemble à un fichier (asset manquant) doit rester un 404 */
  if (/\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|json|txt|xml|woff2?|mp4|html?)$/i.test(p)) return next();
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(index)) return res.status(503).send('index.html manquant dans public/.');
  return res.sendFile(index);
});

/* ------------------------- Erreurs ------------------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (max 8 Mo).' : 'Erreur lors de l’envoi du fichier.';
    return res.status(400).json({ error: msg });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
  if (err && err.message && !err.stack?.includes('ENOENT')) return res.status(400).json({ error: err.message });
  console.error('[erreur]', err);
  return res.status(500).json({ error: 'Erreur serveur, réessaie.' });
});

/* ------------------------- Seed ------------------------- */
const seeded = seed();
if (seeded.admins.length) {
  const lignes = ['', '=== CHEZ FATOUCHA — compte admin créé au premier lancement ==='];
  for (const a of seeded.admins) lignes.push(`  ${a.username} / ${a.password}   →  http://localhost:${PORT}${CHEMIN_ADMIN}`);
  lignes.push('  ⚠ Change ces identifiants via ADMIN1_USERNAME / ADMIN1_PASSWORD (.env ou Render).');
  console.warn(lignes.join('\n'));
}

console.log(
  `🛍️  ${getSetting('nom_boutique', 'CHEZ FATOUCHA')} — http://0.0.0.0:${PORT} ` +
    `(base: ${path.join(DATA_DIR, 'fatoucha.db')} · paiement: ${require('./paiement').mode()})`
);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✔ boutique en ligne sur le port ${PORT}`);
  /* les variantes d'images se préparent DERMIÈRE l'ouverture du port : la
     première visiteuse ne paie plus les conversions, et le serveur répond déjà */
  if (process.env.RECHAUFFE !== '0') require('./rechauffage').lancer();
  console.log(`🔒 espace vendeur : http://localhost:${PORT}${CHEMIN_ADMIN} — aucun lien depuis la boutique, à ouvrir directement`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`\n[${sig}] arrêt…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = app;
