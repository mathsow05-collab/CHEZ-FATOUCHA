/* Images à la volée : redimensionnement + WebP.
   ------------------------------------------------------------------
   Le problème : une photo de téléphone fait 3 à 5 Mo, et une vignette de
   300 px n'a aucune raison de peser ça sur un forfait data. Plutôt que de
   demander à la boutique de traiter ses fichiers, le serveur produit
   lui-même les tailles utiles :

     GET /img/<largeur>/<url d'origine>     → image recadrée, en AVIF ou WebP
                                              selon ce que le navigateur accepte

   - les largeurs sont une liste fermée (220, 480, 900, 1200) : pas de
     conversion arbitraire à chaque requête ;
   - le résultat est écrit dans data/img-cache → une seule fois par fichier
     et par taille, puis servi en immutable (les clientes ne re-téléchargent
     rien sur un retour) ;
   - les SVG (visuels de repli) et les fichiers manquants renvoient une
     redirection vers l'original ;
   - si `sharp` est absent de l'installation, tout continue de fonctionner :
     on renvoie simplement l'original (le site n'est jamais cassé par ça). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PUBLIC_DIR, UPLOADS_DIR, DATA_DIR } = require('./paths');

const LARGEURS = [220, 480, 900, 1200];
const QUALITE = 78;
/* Deux formats modernes, choisis selon ce que le navigateur annonce. À 480 px,
   l'AVIF pèse environ moitié moins que le WebP — sur un forfait data à Dakar,
   ça se paie en secondes, pas en octets gagnés. */
const FORMATS = {
  avif: { mime: 'image/avif', qualite: 44, effort: 4 },
  webp: { mime: 'image/webp', qualite: QUALITE, effort: 4 },
};
const CACHE_DIR = path.join(DATA_DIR, 'img-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

/* Racine de hachage : un chemin RELATIF au dépôt, pour que la clé calculée
   pendant la construction soit la même que celle du serveur qui tourne. */
const REPO = path.join(__dirname, '..');
/* Les variantes pré-cuites au build (`npm run build` → scripts/prepare-images.js)
   sont lues ici, avant tout calcul : sur une instance qui vient de se réveiller,
   la première visiteuse ne paie plus une seconde d'encodage. */
const CACHE_BUILD = path.join(REPO, '.img-cache');

/* Une seule instance de sharp, chargée paresseusement. */
let _sharp;
let _essayé = false;
function leModule() {
  if (_essayé) return _sharp;
  _essayé = true;
  try {
    _sharp = require('sharp');
  } catch {
    _sharp = null;
    console.warn('[images] sharp indisponible : les photos sont servies à leur taille d’origine.');
  }
  return _sharp;
}
const disponible = () => !!leModule();

/* Extensions qu'on sait re-encoder. */
const OPTIMISABLES = /\.(jpe?g|png|webp|avif|tiff)$/i;
const peutOptimiser = (url) => OPTIMISABLES.test(String(url || '').split('?')[0]) && disponible();

/* Une URL publique (/media/… ou /uploads/…) ramenée à un fichier réel, sans
   possibilité de sortir des deux dossiers autorisés. */
function fichierSource(urlPublique) {
  const u = String(urlPublique || '').split('?')[0].split('#')[0];
  let racine = null;
  let relatif = null;
  if (u.startsWith('/media/')) {
    racine = path.join(PUBLIC_DIR, 'media');
    relatif = u.slice('/media/'.length);
  } else if (u.startsWith('/uploads/')) {
    racine = UPLOADS_DIR;
    relatif = u.slice('/uploads/'.length);
  } else {
    return null;
  }
  const abs = path.resolve(racine, relatif);
  if (abs !== racine && !abs.startsWith(racine + path.sep)) return null;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 64) return null;
  } catch {
    return null;
  }
  return abs;
}

/* Clé de cache. Elle est calculée sur le chemin RELATIF au dossier servi :
   une variante cuite pendant la construction (dans un autre répertoire
   d'installation) retrouve donc la même clé au moment de tourner. C'est ce qui
   permet de pré-cuire les images au build et de ne rien calculer à la première
   visite. `vers` = répertoire de sortie (cache d'exécution ou dépôt du build). */
/* Chemin canonique de la source : indépendant du dossier d'installation, donc
   la clé calculée au build est retrouvée par le serveur qui tourne. */
function sourceCanonique(abs) {
  const n = String(abs).split(path.sep).join('/');
  const sous = (racine, etiquette) => {
    const r = String(racine).split(path.sep).join('/');
    return n.startsWith(r + '/') ? etiquette + n.slice(r.length) : null;
  };
  /* 1) les racines connues de cette machine ; 2) à défaut, le repère dans le
     chemin — c'est ce qui rend la clé identique entre le répertoire du build et
     celui du serveur quand ils ne portent pas le même préfixe. */
  return sous(PUBLIC_DIR, 'public')
    || sous(UPLOADS_DIR, 'uploads')
    || ((() => {
      const i = n.lastIndexOf('/public/');
      if (i >= 0) return 'public/' + n.slice(i + '/public/'.length);
      const j = n.lastIndexOf('/uploads/');
      if (j >= 0) return 'uploads/' + n.slice(j + '/uploads/'.length);
      return null;
    })())
    || ('fichier/' + path.basename(n));
}

const cleDeCache = (abs, largeur, format = 'webp', vers = CACHE_DIR) =>
  path.join(vers,
    crypto.createHash('sha1').update(sourceCanonique(abs) + '@' + largeur + '@' + format).digest('hex')
    + '-' + largeur + '.' + format);

/* Le format que le navigateur sait décoder (rien d'annoncé → WebP, sûr partout). */
function formatAccepte(enteteAccept) {
  const a = String(enteteAccept || '');
  if (/image\/avif/i.test(a)) return 'avif';
  if (/image\/webp/i.test(a)) return 'webp';
  return 'webp';
}

const enCours = new Map();

/* Produit (ou renvoie le chemin déjà en cache) le fichier redimensionné.
   Retourne { fichier, format, depuisCache } — ou null si rien n'est possible. */
async function generer(abs, largeur, format = 'webp', options = {}) {
  const sharp = leModule();
  if (!sharp) return null;
  const demande = FORMATS[format] ? format : 'webp';
  const vers = options.vers || CACHE_DIR;
  const cle = cleDeCache(abs, largeur, demande, vers);
  /* 1) déjà dans le cache d'exécution ; 2) pré-cuit au build ; 3) à calculer */
  if (fs.existsSync(cle)) return { fichier: cle, format: demande, depuisCache: true };
  if (!options.vers) {
    const cuite = cleDeCache(abs, largeur, demande, CACHE_BUILD);
    if (fs.existsSync(cuite)) return { fichier: cuite, format: demande, depuisCache: true, depuis: 'build' };
  }
  if (enCours.has(cle)) return enCours.get(cle);
  const t = (async () => {
    /* si l'encodage demandé échoue (libvips sans AV1, fichier piégé…), on
       retente en WebP avant de renvoyer l'original */
    for (const essai of demande === 'webp' ? ['webp'] : [demande, 'webp']) {
      try {
        const tampon = await sharp(abs, { failOn: 'none' })
          .rotate()
          .resize({ width: largeur, withoutEnlargement: true })
          .toFormat(essai, { quality: FORMATS[essai].qualite, effort: FORMATS[essai].effort })
          .toBuffer();
        /* écriture atomique : pas de fichier à moitié lu par une autre requête */
        const final = cleDeCache(abs, largeur, essai, vers);
        const temp = final + '.' + process.pid + '.tmp';
        fs.mkdirSync(path.dirname(final), { recursive: true });
        fs.writeFileSync(temp, tampon);
        fs.renameSync(temp, final);
        return { fichier: final, format: essai, depuisCache: false };
      } catch (e) {
        console.warn('[images] conversion ' + essai + ' impossible (' + e.message.slice(0, 80) + ')');
      }
    }
    console.warn('[images] aucun format moderne disponible : original servi.');
    return null;
  })().finally(() => enCours.delete(cle));
  enCours.set(cle, t);
  return t;
}

/* URL d'une taille donnée (ou l'originale si l'image n'est pas convertible). */
function urlPour(urlPublique, largeur) {
  const u = String(urlPublique || '');
  if (!u || !peutOptimiser(u)) return u;
  return `/img/${largeur}${u.startsWith('/') ? '' : '/'}${u}`;
}

/* Attribut srcset pour une image : le navigateur choisit la bonne taille. */
function srcsetPour(urlPublique, largeurs = LARGEURS) {
  if (!peutOptimiser(urlPublique)) return '';
  return largeurs.map((l) => `${urlPour(urlPublique, l)} ${l}w`).join(', ');
}

/* Balise <img> complète : srcset + sizes + lazy + decoding. Utilisée par le
   rendu serveur (pages visibles par les moteurs) ; le front construit la même
   chose côté navigateur avec la fonction jumelle de public/js/app.js. */
function baliseImage(url, alt, opts = {}) {
  const {
    largeurs = LARGEURS,
    sizes = '320px',
    priorité = false,
    cls = '',
    id = '',
    repli = '/media/demo/robe-boheme.svg',
  } = opts;
  const ss = srcsetPour(url, largeurs);
  const chargement = priorité ? 'eager' : 'lazy';
  return `<img src="${echapperHtml(urlPour(url, priorité ? largeurs[Math.max(0, largeurs.length - 2)] : largeurs[1]))}"${ss ? ` srcset="${ss}"` : ''}${ss ? ` sizes="${echapperHtml(sizes)}"` : ''} alt="${echapperHtml(alt || '')}" width="${priorité ? 900 : 480}" height="${priorité ? 1200 : 640}" loading="${chargement}" decoding="async"${priorité ? ' fetchpriority="high"' : ''}${cls ? ` class="${cls}"` : ''}${id ? ` id="${id}"` : ''} onerror="this.onerror=null;this.src='${repli}'" />`;
}

const echapperHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Express : /img/<largeur>/<url d'origine>. Découpé à la main plutôt qu'avec un
   motif de route — Express 5 refuse les jokers non nommés, et de toute façon la
   partie « origine » contient des barres obliques. */
function route() {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const morceaux = String(req.path || '').split('/').filter(Boolean); // [largeur, ...chemin]
    const largeur = Number(morceaux.shift());
    if (!LARGEURS.includes(largeur)) return next();
    const origine = '/' + morceaux.join('/');
    const abs = fichierSource(origine);
    if (!abs) return next();
    if (!peutOptimiser(origine)) return res.redirect(302, origine);
    const derive = await generer(abs, largeur, formatAccepte(req.headers.accept));
    if (!derive) return res.redirect(302, origine);
    res.setHeader('Content-Type', FORMATS[derive.format].mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Vary', 'Accept');
    res.setHeader('X-Image-Original', String(Math.round(fs.statSync(abs).size / 1024)) + 'Ko');
    res.setHeader('X-Image-Cache', derive.depuisCache ? 'disque' : 'genere');
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(derive.fichier).pipe(res);
  };
}

/* À l'import/téléversement : on ramène la photo d'origine à une taille
   raisonnable sur le disque (le stockage est limité, et 1200 px suffisent
   largement pour une fiche produit). L'échec n'est jamais bloquant. */
async function reduire(dir, nom, { largeurMax = 1200, qualite = 82 } = {}) {
  const sharp = leModule();
  const abs = path.join(dir, nom);
  if (!sharp || !OPTIMISABLES.test(nom)) return nom;
  try {
    const infos = await sharp(abs, { failOn: 'none' }).metadata();
    if ((infos.width || 0) <= largeurMax && (infos.pageLength || 1) <= 1 && fs.statSync(abs).size < 400 * 1024) return nom;
    const base = nom.replace(/\.[a-z0-9]+$/i, '');
    /* une animation GIF reste telle quelle (sharp ne la conserverait pas) */
    if (infos.format === 'gif' || (infos.pageLength || 1) > 1) return nom;
    const sorti = `${base}.webp`;
    await sharp(abs, { failOn: 'none' })
      .rotate()
      .resize({ width: largeurMax, withoutEnlargement: true })
      .webp({ quality: qualite })
      .toFile(path.join(dir, sorti));
    if (sorti !== nom) fs.rmSync(abs, { force: true });
    return sorti;
  } catch (e) {
    console.warn('[images] réduction impossible :', e.message);
    return nom;
  }
}

module.exports = { LARGEURS, FORMATS, disponible, peutOptimiser, fichierSource, generer, cleDeCache, sourceCanonique, formatAccepte, urlPour, srcsetPour, baliseImage, route, reduire, echapperHtml, CACHE_DIR, CACHE_BUILD };
