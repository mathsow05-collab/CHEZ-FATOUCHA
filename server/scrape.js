/* Récupération des infos d'une page produit depuis une URL (SHEIN, Temu,
   Jumia, Instagram…). Le lien n'est PAS collé par l'admin dans notre cas :
   ce module sert uniquement à récupérer la photo d'un article que Fatou
   a déjà en magasin, quand il n'a pas pris la photo lui-même.

   → 100 % défensif : si le site bloque (c'est le cas de SHEIN), on renvoie
     ce qu'on a pu trouver (souvent l'image og:), et l'admin complète à la main.
   → Anti-SSRF : http/https uniquement, pas d'IP privée, taille plafonnée. */
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const MAX_BYTES = 4 * 1024 * 1024; // 4 Mo de HTML max
const MAX_IMG = 8 * 1024 * 1024; // 8 Mo d'image max
const TIMEOUT = 12_000;

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function ipEstPrivee(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const v6 = String(ip).toLowerCase();
  return v6 === '::1' || v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd');
}

async function verifHote(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Seuls http et https sont autorisés.');
  const host = u.hostname;
  if (!host) throw new Error('URL invalide.');
  if (net.isIP(host)) {
    if (ipEstPrivee(host)) throw new Error('Adresse non autorisée.');
    return;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Nom de domaine introuvable.');
  }
  if (!addrs.length || addrs.some((a) => ipEstPrivee(a.address))) {
    throw new Error('Hébergement interne refusé.');
  }
}

async function fetchText(url) {
  const u = new URL(url);
  await verifHote(u);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(u.toString(), {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    if (!res.ok) throw new Error(`Le site a répondu ${res.status}.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('Page trop volumineuse.');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error('Page trop volumineuse.');
    return { body: Buffer.from(buf).toString('utf8'), finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

/* Extraction défensive : open graph, JSON-LD, <title>, <img>. */
function extraire(html, baseUrl) {
  const out = { titre: null, description: null, prix: null, devise: 'XOF', images: [], lien: baseUrl };
  const abs = (src) => {
    if (!src) return null;
    try {
      return new URL(src.replace(/&amp;/g, '&'), baseUrl).toString();
    } catch {
      return /^https?:/.test(src) ? src : null;
    }
  };
  const meta = (name) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      'i'
    );
    const m = html.match(re);
    return m ? (m[1] || m[2] || '').trim() : null;
  };

  out.titre = meta('og:title') || meta('twitter:title') || html.match(/<title[^>]*>([^<]{3,200})</i)?.[1]?.trim() || null;
  out.description = meta('og:description') || meta('description') || meta('twitter:description') || null;
  const price = meta('product:price:amount') || meta('og:price:amount') || null;
  if (price && /\d/.test(price)) out.prix = Number(String(price).replace(/[^\d.,]/g, '').replace(',', '.'));
  out.devise = meta('product:price:currency') || meta('og:price:currency') || 'XOF';

  const imgs = new Set();
  const addImg = (raw) => {
    const u = abs(raw);
    if (u && !/logo|icon|sprite|blank\.gif|pixel|placeholder/i.test(u)) imgs.add(u);
  };
  addImg(meta('og:image'));
  addImg(meta('og:image:secure_url'));
  addImg(meta('twitter:image'));
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)) addImg(m[1]);
  for (const m of html.matchAll(/https?:\/\/[^"'\s\\]+\.(?:jpe?g|png|webp)(?:\?[^"'\s\\]*)?/gi)) addImg(m[0]);
  out.images = [...imgs].slice(0, 12);
  out.titre = out.titre ? out.titre.replace(/\s*[|–-]\s*(SHEIN|TEMU|Jumia).*$/i, '').slice(0, 140) : null;
  return out;
}

async function lireUrl(url) {
  const { body, finalUrl } = await fetchText(url);
  return extraire(body, finalUrl);
}

/* Télécharge une image distante et l'enregistre dans `destDir`.
   → le produit stocke ensuite une URL locale /uploads/… : aucun blocage CORS,
     aucun hotlink qui casse quand le site d'origine change ses liens, et le
     client voit la photo sans passer par le serveur. */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

async function telechargerImage(url, destDir, profondeur = 0) {
  const { URL } = require('url');
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const u = new URL(url);
  await verifHote(u);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(u.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if ([301, 302, 303, 307, 308].includes(res.status) && profondeur < 3) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirection sans cible.');
      return telechargerImage(new URL(loc, u).toString(), destDir, profondeur + 1);
    }
    if (!res.ok) throw new Error(`Image indisponible (${res.status}).`);
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!EXT[type]) throw new Error('Ce lien n’est pas une image (JPG, PNG, WEBP, GIF ou AVIF).');
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Image vide.');
    if (buf.length > MAX_IMG) throw new Error('Image trop volumineuse (>8 Mo).');
    fs.mkdirSync(destDir, { recursive: true });
    const nom = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${EXT[type]}`;
    fs.writeFileSync(path.join(destDir, nom), buf);
    return nom;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { lireUrl, verifHote, telechargerImage };
