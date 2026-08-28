require('./env');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[sécurité] JWT_SECRET absent : secret temporaire généré (les sessions admin sauteront au redémarrage).');
}

const { db, getSetting } = require('./db');
const { seed } = require('./seed');
const { PUBLIC_DIR, UPLOADS_DIR, DATA_DIR } = require('./paths');

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
      "img-src 'self' data: blob: https: http:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
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

/* ---------------- Frontend — espace vendeur (page séparée) ----------------
   /admin sert public/admin/index.html, une page à part : la boutique n'en
   parle nulle part (ni lien, ni menu) et le code admin n'est jamais chargé
   côté cliente. L'URL reste protégée par identifiant + mot de passe. */
const PAGE_ADMIN = path.join(PUBLIC_DIR, 'admin', 'index.html');
app.get(['/admin', '/admin/'], (req, res, next) => {
  if (!fs.existsSync(PAGE_ADMIN)) return res.status(503).send('Page admin absente : public/admin/index.html introuvable.');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); /* hors des moteurs de recherche */
  return res.sendFile(PAGE_ADMIN);
});

/* ------------------------- Frontend (SPA à hash) ------------------------- */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));
/* Toute URL qui n'est pas une ressource de l'API renvoie le SPA (routes à #). */
app.use((req, res, next) => {
  const p = req.path || '/';
  if (req.method !== 'GET' || p.startsWith('/api/') || p.startsWith('/uploads/') || p.startsWith('/media/')) return next();
  /* une URL qui ressemble à un fichier (asset manquant) doit rester un 404 */
  if (/\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|json|txt|xml|woff2?|mp4)$/i.test(p)) return next();
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
  for (const a of seeded.admins) lignes.push(`  ${a.username} / ${a.password}   →  http://localhost:${PORT}/admin`);
  lignes.push('  ⚠ Change ces identifiants via ADMIN1_USERNAME / ADMIN1_PASSWORD (.env ou Render).');
  console.warn(lignes.join('\n'));
}

console.log(
  `🛍️  ${getSetting('nom_boutique', 'CHEZ FATOUCHA')} — http://0.0.0.0:${PORT} ` +
    `(base: ${path.join(DATA_DIR, 'fatoucha.db')} · paiement: ${require('./paiement').mode()})`
);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✔ boutique en ligne sur le port ${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`\n[${sig}] arrêt…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = app;
