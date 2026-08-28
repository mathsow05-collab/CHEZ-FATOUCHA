/* Génère les visuels de démonstration (SVG légers, aucune dépendance réseau).
   L'admin remplacera ces images par ses vraies photos depuis l'espace admin. */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'media', 'demo');
fs.mkdirSync(OUT, { recursive: true });

const ITEMS = [
  { file: 'robe-boheme', emoji: '👗', titre: 'Robe longue bohème', a: '#c9455c', b: '#7c1f36' },
  { file: 'ensemble-two-piece', emoji: '🧥', titre: 'Ensemble two-piece', a: '#c98b4b', b: '#7a4a17' },
  { file: 'sac-matelasse', emoji: '👜', titre: 'Sac matelassé', a: '#2f2b28', b: '#0f0d0c' },
  { file: 'baskets', emoji: '👟', titre: 'Baskets montantes', a: '#4c6ef5', b: '#25307a' },
  { file: 'parfum', emoji: '🧴', titre: 'Parfum Golden Oud', a: '#d4a017', b: '#8a5c07' },
  { file: 'montre', emoji: '⌚', titre: 'Montre acier doré', a: '#d0a63c', b: '#77551a' },
  { file: 'chemise-homme', emoji: '👕', titre: 'Chemise lin lavé', a: '#5f9ea0', b: '#22545a' },
  { file: 'bijoux', emoji: '💍', titre: 'Lot 3 bijoux inox', a: '#b0864a', b: '#5d3f18' },
];

/* Tuile de repli (utilisée seulement si la photo est absente) : ivoire,
   filet or, titre en serif — dans le thème « Prestige » de la boutique. */
const SERIF = 'Hoefler Text, Didot, "Cormorant Garamond", Palatino, Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function svg({ emoji, titre, a }) {
  const teinte = /^[#][0-9a-fA-F]{6}$/.test(a) ? a : '#6d1f46';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200" role="img" aria-label="${titre}">
  <defs>
    <radialGradient id="j" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="#fffdf9" /><stop offset="70%" stop-color="#f5efe6" /><stop offset="100%" stop-color="#eae1d4" />
    </radialGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#j)" />
  <rect width="900" height="1200" fill="${teinte}" opacity=".06" />
  <g opacity=".5">
    <ellipse cx="450" cy="880" rx="250" ry="34" fill="#241a22" opacity=".12" />
  </g>
  <text x="450" y="700" font-size="330" text-anchor="middle">${emoji}</text>
  <rect x="46" y="46" width="808" height="1108" fill="none" stroke="#b8912f" stroke-opacity=".55" stroke-width="2" />
  <rect x="46" y="46" width="220" height="58" fill="#241a22" />
  <text x="156" y="83" font-family="${SANS}" font-size="22" font-weight="600" letter-spacing="6" fill="#d9b968" text-anchor="middle">SÉLECTION</text>
  <text x="450" y="985" font-family="${SERIF}" font-size="47" fill="#241a22" text-anchor="middle">${titre}</text>
  <rect x="380" y="1020" width="140" height="1" fill="#b8912f" />
  <text x="450" y="1075" font-family="${SANS}" font-size="21" letter-spacing="5" fill="#8c6a1f" text-anchor="middle">CHEZ FATOUCHA · PHOTO DE DÉMONSTRATION</text>
</svg>`;
}

async function principal() {
let n = 0;
for (const it of ITEMS) {
  const clean = { ...it, a: it.a.replace(/[^#0-9a-fA-F]/g, '') || '#c9455c' };
  fs.writeFileSync(path.join(OUT, it.file + '.svg'), svg(clean), 'utf8');
  n += 1;
}

/* Favicon : monogramme « CF » or sur aubergine, filet champagne. */
fs.writeFileSync(
  path.join(OUT, '..', 'favicon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="4" fill="#241a22"/><rect x="1.5" y="1.5" width="61" height="61" rx="3" fill="none" stroke="#b8912f" stroke-opacity=".55"/><text x="32" y="41" text-anchor="middle" font-family="Hoefler Text, Didot, Palatino, Georgia, serif" font-size="26" letter-spacing="1" fill="#d9b968">CF</text></svg>\n',
  'utf8'
);

/* ------------------------------------------------------------------ */
/* Deux vues de plus par produit, taillées dans la photo existante.     */
/* Une fiche de mode a besoin de plusieurs plans (globale / détail du  */
/* tissu / tombé du bas) : c'est ce qui fait qu'on achète sans essayer. */
/* ------------------------------------------------------------------ */
let vus = 0;
try {
  const sharp = require('sharp');
  for (const it of ITEMS) {
    const src = path.join(OUT, it.file + '.jpg');
    if (!fs.existsSync(src)) continue;
    let meta;
    try { meta = await sharp(src).metadata(); } catch { continue; }
    const W = meta.width, H = meta.height;
    if (!W || !H) continue;
    const plans = [
      { sortie: it.file + '-2.jpg', x: 0.19, y: 0.04, w: 0.62, h: 0.62 },
      { sortie: it.file + '-3.jpg', x: 0.10, y: 0.34, w: 0.72, h: 0.64 },
    ];
    for (const plan of plans) {
      const cw = Math.round(W * plan.w);
      let ch = Math.round(cw * (4 / 3));
      ch = Math.min(ch, H - Math.round(H * plan.y));
      const gauche = Math.min(W - cw, Math.round(W * plan.x));
      const haut = Math.min(H - ch, Math.round(H * plan.y));
      if (cw < 200 || ch < 200) continue;
      await sharp(src)
        .extract({ left: gauche, top: haut, width: cw, height: ch })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(path.join(OUT, plan.sortie));
      vus += 1;
    }
  }
} catch (e) {
  console.warn('  (sharp indisponible : les vues supplémentaires sont sautées —', e.message + ')');
}

/* ------------------------------------------------------------------ */
/* Icônes de l'application (PWA) : monogramme « CF » sur aubergine.     */
/* ------------------------------------------------------------------ */
let icone = 0;
try {
  const sharp = require('sharp');
  const SVG_ICONE = (taille) => `<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#241a22"/>
  <rect x="12" y="12" width="488" height="488" fill="none" stroke="#b8912f" stroke-opacity=".55" stroke-width="4"/>
  <text x="256" y="${taille === 512 ? 322 : 318}" text-anchor="middle" font-family="Hoefler Text, Didot, Palatino, Georgia, serif" font-size="212" letter-spacing="8" fill="#d9b968">CF</text>
</svg>`;
  const PUB = path.join(__dirname, '..', 'public', 'media');
  for (const taille of [192, 512]) {
    await sharp(Buffer.from(SVG_ICONE(taille))).png().toFile(path.join(PUB, `icone-${taille}.png`));
    icone += 1;
  }
  /* version « maskable » : marges plus larges pour les lances Android */
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#241a22"/><text x="256" y="330" text-anchor="middle" font-family="Hoefler Text, Didot, Palatino, Georgia, serif" font-size="168" letter-spacing="6" fill="#d9b968">CF</text></svg>`))
    .png().toFile(path.join(PUB, 'icone-maskable.png'));
  icone += 1;
} catch (e) {
  console.warn('  (icônes PWA non générées :', e.message + ')');
}

console.log(`✔ ${n} visuels de démo (+${vus} vues supplémentaires, ${icone} icône(s) PWA) dans ${OUT}`);


}

principal().catch((e) => {
  console.error('✖ génération impossible :', e.message);
  process.exit(1);
});
