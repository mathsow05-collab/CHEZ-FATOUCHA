const path = require('path');

/* CHEZ FATOUCHA — chemins de données.
   En production (Render, VPS…), on redirige vers un disque persistant via
   DATA_DIR / UPLOADS_DIR. Sans ça, tout est perdu au redémarrage (plan gratuit). */
const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PUBLIC_DIR: process.env.PUBLIC_DIR || path.join(ROOT, 'public'),
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
};
