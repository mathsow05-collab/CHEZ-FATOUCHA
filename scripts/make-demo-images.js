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

function svg({ emoji, titre, a, b }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200" role="img" aria-label="${titre}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}" /><stop offset="100%" stop-color="${b}" />
    </linearGradient>
    <pattern id="wax" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
      <circle cx="30" cy="30" r="14" fill="rgba(255,255,255,.09)" />
      <circle cx="90" cy="78" r="20" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="6" />
      <path d="M6 100 q24 -26 48 0 t48 0" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6" />
    </pattern>
  </defs>
  <rect width="900" height="1200" fill="url(#g)" />
  <rect width="900" height="1200" fill="url(#wax)" />
  <g opacity=".92">
    <circle cx="450" cy="520" r="250" fill="rgba(0,0,0,.22)" />
    <text x="450" y="600" font-size="300" text-anchor="middle">${emoji}</text>
  </g>
  <rect x="60" y="900" width="780" height="200" rx="34" fill="rgba(255,252,245,.94)" />
  <text x="100" y="985" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="46" font-weight="800" fill="#14110f">${titre}</text>
  <text x="100" y="1050" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="30" fill="#7c7166">CHEZ FATOUCHA · photo de démonstration</text>
  <rect x="60" y="60" width="230" height="66" rx="22" fill="rgba(20,17,15,.72)" />
  <text x="175" y="104" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="27" font-weight="800" fill="#fff" text-anchor="middle">NOUVEAU</text>
</svg>`;
}

let n = 0;
for (const it of ITEMS) {
  const clean = { ...it, a: it.a.replace(/[^#0-9a-fA-F]/g, '') || '#c9455c' };
  fs.writeFileSync(path.join(OUT, it.file + '.svg'), svg(clean), 'utf8');
  n += 1;
}

/* Favicon : un « F » doré sur fond encre. */
fs.writeFileSync(
  path.join(OUT, '..', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#14110f"/><path d="M22 47V17h21v7H30v5h11v7H30v11z" fill="#e0a53d"/></svg>`,
  'utf8'
);
console.log(`✔ ${n} visuels de démo + favicon dans ${OUT}`);
