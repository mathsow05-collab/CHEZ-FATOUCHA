/* Contrôle du thème : syntaxe CSS ; variables définies là où la page les charge ;
   aucun sélecteur du back-office dans le CSS public ; aucun sélecteur mort.
   Usage : npm run check:css   (postcss en devDependency, rien n'est modifié) */
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const RACINE = path.join(__dirname, '..');
const LU = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

/* Les deux pages et les feuilles qu'elles chargent réellement. */
const PAGES = {
  'boutique (public/index.html)': { css: ['public/css/style.css'], html: 'public/index.html' },
  'back-office (admin-ui/index.html)': { css: ['public/css/style.css', 'admin-ui/admin.css'], html: 'admin-ui/index.html' },
};

/* Une classe n'est « morte » que si aucun code du projet ne s'en sert. */
/* Le rendu serveur fait partie du front : ses classes comptent comme utilisées. */
const CODE = [
  'public/js/app.js', 'public/js/api.js', 'public/js/icones.js', 'public/js/mouvement.js',
  'public/index.html', 'public/sw.js', 'admin-ui/admin.js', 'admin-ui/index.html', 'server/pages.js',
].map(LU).join('\n');

let pb = 0;
const dit = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✔' : '✖'} ${msg}${cond ? '' : '  → ' + extra}`);
  if (!cond) pb++;
};
const regles = (root) => { const o = []; root.walkRules((r) => o.push(r.selector.replace(/\s+/g, ' '))); return o; };
console.log('\n=== CHEZ FATOUCHA — contrôle CSS / thème ===\n');

const racines = new Map();
for (const f of ['public/css/style.css', 'admin-ui/admin.css']) {
  try {
    racines.set(f, postcss.parse(LU(f), { from: f }));
    dit(true, `${f} : syntaxe valide (${racines.get(f).nodes.length} règles de premier niveau)`);
  } catch (e) {
    dit(false, `${f} : syntaxe CSS`, `${e.reason} (ligne ${e.line})`);
  }
}

/* 1) variables : chaque page doit les trouver dans les feuilles qu'elle charge */
for (const [nom, cfg] of Object.entries(PAGES)) {
  const definies = new Set();
  const utilisees = new Set();
  for (const f of cfg.css) {
    const root = racines.get(f);
    if (!root) continue;
    root.walkDecls((d) => { if (d.prop && d.prop.startsWith('--')) definies.add(d.prop); });
    root.walkDecls((d) => {
      if (d.prop && d.prop.startsWith('--')) return;
      for (const m of (d.value || '').matchAll(/var\((--[a-z0-9-]+)/gi)) utilisees.add(m[1]);
    });
  }
  const absentes = [...utilisees].filter((v) => !definies.has(v));
  dit(absentes.length === 0, `${nom} : ${utilisees.size} variables du thème toutes définies par ses feuilles`, absentes.join(', '));
}

/* 2) cloisonnement : le CSS servi à la cliente ignore tout du back-office */
const public_ = regles(racines.get('public/css/style.css') || postcss.parse(''));
const INTERDITS = /\.(adm|admin|tbl|kpi|var-grid|imgs-admin|drop)\b/;
const fuite = public_.filter((s) => INTERDITS.test(s));
dit(fuite.length === 0, 'aucun sélecteur de l’espace vendeur dans le CSS public', fuite.slice(0, 4).join(' | '));
dit(!/admin\.css/.test(LU('public/index.html')), 'la boutique ne charge pas la feuille du back-office (poids réduit)');

/* 3) admin.css s'appuie sur les variables de style.css : ordre des <link> */
dit(/style\.css[\s\S]*admin\.css/.test(LU('admin-ui/index.html')), 'le back-office charge le thème AVANT sa feuille (variables disponibles)', 'ordre des <link>');

/* 4) pas de CSS mort : toute classe d'une règle est utilisée par un des codes du projet */
const morts = [];
for (const [f, root] of racines) {
  for (const s of regles(root)) {
    const cls = [...new Set([...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
    if (cls.length && cls.every((c) => !CODE.includes(c))) morts.push(`${f}: ${s}`);
  }
}
dit(morts.length === 0, `aucun sélecteur mort (${public_.length} sélecteurs publics, CSS admin inclus)`, morts.slice(0, 6).join(' | '));

console.log(pb ? `\n=== ${pb} problème(s) ===\n` : '\n=== thème conforme ===\n');
process.exit(pb ? 1 : 0);
