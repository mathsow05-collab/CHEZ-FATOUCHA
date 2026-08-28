/* Mini-chargeur .env (format KEY=VALUE), sans dépendance externe.
   Identique au reste du dépôt : pas de dotenv, on lit le fichier .env du projet. */
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  for (const file of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
})();

module.exports = {};
