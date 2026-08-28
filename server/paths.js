const path = require('path');

/* CHEZ FATOUCHA — chemins de données.
   En production (Render, VPS…), on redirige vers un disque persistant via
   DATA_DIR / UPLOADS_DIR. Sans ça, tout est perdu au redémarrage (plan gratuit). */
const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PUBLIC_DIR: process.env.PUBLIC_DIR || path.join(ROOT, 'public'),
  /* Le back-office vit HORS de public/ : aucune requête statique ne peut tomber
     dessus. Seule la route CHEMIN_ADMIN de server/index.js le sert. */
  ADMIN_UI_DIR: path.join(ROOT, 'admin-ui'),
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
};
