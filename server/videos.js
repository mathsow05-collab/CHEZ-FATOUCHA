/* =========================================================================
   CHEZ FATOUCHA — reconnaître une vidéo à partir du lien qu'on colle

   La vendeuse filme l'article, le met sur YouTube (ou envoie le lien d'une
   vidéo déjà en ligne), et colle l'URL dans l'espace admin. Ce fichier
   transforme ce lien en trois choses : une page d'origine (le lien qu'on
   montre), une adresse de LECTEUR intégrable, et une miniature.

   Deux règles de sûreté, dans l'ordre :
   - la liste des fournisseurs est fermée. Un lien qu'on ne reconnaît pas ne
     devient JAMAIS un cadre : il reste un simple bouton « ouvrir la vidéo ».
     Sinon n'importe quelle URL collée ici serait chargée dans la fiche de
     toutes les clientes.
   - on ne charge rien à l'affichage. Le lecteur n'est demandé qu'au toucher :
     un cadre YouTube non demandé coûte 500 Ko et deux requêtes DNS, ce qui
     serait exactement la leçon contraire de celle des photos.
   ========================================================================= */
'use strict';

const YOUTUBE_ID = '[A-Za-z0-9_-]{11}';

/* Ce qu'on sait intégrer, et comment. `cadre` = l'adresse du lecteur ;
   `miniature` = une image publique du fournisseur (on la rapatrie chez nous à
   l'enregistrement, pour ne pas dépendre d'un tiers à chaque affichage) ;
   `format` = le ratio du cadre, pour ne pas écraser une vidéo verticale. */
const FOURNISSEURS = [
  {
    nom: 'youtube',
    /* watch?v=, youtu.be/, /shorts/, /embed/, /live/ — les cinq formes du lien. */
    id: (u) => {
      const h = u.hostname.replace(/^www\./, '');
      const chemin = u.pathname;
      if (h === 'youtu.be') return /^\/([A-Za-z0-9_-]{11})$/.exec(chemin)?.[1] || null;
      const q = u.searchParams.get('v');
      if (q && new RegExp('^' + YOUTUBE_ID + '$').test(q)) return q;
      const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(chemin);
      return m ? m[1] : null;
    },
    hotes: /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)$/,
    page: (id) => `https://www.youtube.com/watch?v=${id}`,
    cadre: (id) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
    /* `hqdefault` existe toujours mais cadre le Short dans 480×360 avec deux
       barres noires ; `oardefault` est l'image au format d'origine (1080×1920,
       sans barres) mais YouTube répond parfois 404 — avec une vignette grise
       dedans. On ne montre donc oardefault qu'après l'avoir téléchargée et
       vérifiée (voir `miniatureVerticale` dans les routes admin). */
    miniature: (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    miniatureOriginale: (id) => `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
    format: (u, id) => (/^\/shorts\//.test(u.pathname) ? 'vertical' : 'paysage'),
    etiquette: 'YouTube',
  },
  {
    nom: 'vimeo',
    id: (u) => /^\/video\/(\d+)/.exec(u.pathname)?.[1] || /^\/(\d+)$/.exec(u.pathname)?.[1] || null,
    hotes: /^(www\.|player\.)?vimeo\.com$/,
    page: (id) => `https://vimeo.com/${id}`,
    cadre: (id) => `https://player.vimeo.com/video/${id}`,
    miniature: null,
    format: () => 'paysage',
    etiquette: 'Vimeo',
  },
  {
    nom: 'tiktok',
    id: (u) => /\/video\/(\d{6,})/.exec(u.pathname)?.[1] || /\/photo\/(\d{6,})/.exec(u.pathname)?.[1] || null,
    hotes: /^(www\.|vm\.)?tiktok\.com$/,
    page: (id, u) => 'https://www.tiktok.com' + u.pathname,
    cadre: (id) => `https://www.tiktok.com/embed/v2/${id}`,
    miniature: null,
    format: () => 'vertical',
    etiquette: 'TikTok',
  },
  {
    nom: 'instagram',
    id: (u) => /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{4,})/.exec(u.pathname)?.[1] || null,
    hotes: /^(www\.)?instagram\.com$/,
    page: (id, u) => 'https://www.instagram.com' + u.pathname,
    cadre: (id) => `https://www.instagram.com/p/${id}/embed/captioned/`,
    miniature: null,
    format: (u) => (/^\/reel/.test(u.pathname) ? 'vertical' : 'paysage'),
    etiquette: 'Instagram',
  },
];

const FOURNISSEUR_PAR_NOM = new Map(FOURNISSEURS.map((f) => [f.nom, f]));

/* Les raccourcisseurs : ce que le bouton « Partager » d'un téléphone produit, au
   lieu de l'adresse longue. On ne sait pas encore ce qu'il y a derrière — donc on
   l'accepte comme simple lien (jamais comme cadre), et `resoudre` ci-dessous va
   chercher l'adresse complète pour que la fiche puisse intégrer le lecteur. */
const RACCOURCIS = /^(?:(?:www\.|vm\.|vt\.|m\.)tiktok\.com\/t?\/?[A-Za-z0-9_-]{5,}\b|(?:www\.)?(?:bit\.ly|cutt\.ly|t\.co|tinyurl\.com|is\.gd|rb\.gy|buff\.ly|yi\.se|ow\.ly|shorturl\.at|tly\.io|trib\.mn|rebrand\.ly)\/[^\s]+)/i;

/* Un lien n'est traité comme un raccourci que si aucun fournisseur ne l'a
   reconnu avant : `youtu.be/ID?si=…` est déjà une adresse complète. */
const estRaccourci = (url) => RACCOURCIS.test(String(url || '').replace(/^https?:\/\//i, ''));

/**
 * Déroule un lien raccourci jusqu'à sa vraie adresse (3 sauts maximum), pour
 * reconnaître le fournisseur. Silencieux sur l'échec : le lien collé reste
 * utilisable comme lien, simplement sans lecteur intégré.
 */
async function resoudre(lien, { sauts = 3 } = {}) {
  const brut = String(lien || '').trim();
  if (!/^https?:\/\//i.test(brut)) return { url: brut, ok: false };
  const { verifHote } = require('./scrape');
  let courant = brut;
  /* une adresse « utilisable » = un fournisseur reconnu ; pas simplement « autre chose » */
  const pret = (x) => { const r = analyser(x); return r.ok && r.fournisseur !== 'raccourci'; };
  for (let i = 0; i < sauts; i++) {
    if (pret(courant)) return { url: courant, ok: true, change: courant !== brut };
    try { u = new URL(courant); } catch { return { url: courant, ok: false }; }
    try { await verifHote(u); } catch { return { url: courant, ok: false }; }
    const ctrl = new AbortController();
    const montre = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(u.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChezFatoucha/1.0)' } });
      const loc = res.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        courant = new URL(loc, u).toString();
        continue;
      }
      /* certains partagent une page HTML qui contient la vraie adresse : on la lit
         une fois, sans charger le reste */
      if (res.ok) {
        const extrait = /"url":"(https:\/\/www\.(?:youtube|tiktok|instagram)\.com\/[^"]+)"/.exec(await res.text().catch(() => ''))
          || /property="og:video:url" content="(https:[^"]+)"/.exec(await res.text().catch(() => ''));
        if (extrait) { courant = extrait[1].replace(/\\u0026/g, '&'); continue; }
      }
      return { url: courant, ok: pret(courant), change: pret(courant) ? courant !== brut : false };
    } catch {
      return { url: courant, ok: false };
    } finally {
      clearTimeout(montre);
    }
  }
  return { url: courant, ok: pret(courant), change: pret(courant) ? courant !== brut : false };
}

/**
 * @param {string} lien ce qui a été collé dans le champ « vidéo »
 * @returns {{ok:boolean, local?:boolean, erreur?:string, fournisseur?:string,
 *            etiquette?:string, id?:string, page?:string, cadre?:string,
 *            miniature?:string, format?:string}}
 */
function analyser(lien) {
  const brut = String(lien || '').trim();
  if (!brut) return { ok: false, erreur: 'Aucun lien collé.' };

  /* un fichier déposé sur le site (téléversement) : c'est le lecteur du dépôt
     qui l'affiche, il n'y a rien à intégrer. Un lien direct vers un .mp4
     extérieur est accepté aussi, mais en https seulement — la fiche d'une
     cliente ne doit pas charger de la vidéo en clair sur un réseau public. */
  if (/^\/uploads\/[a-z0-9._/-]+$/i.test(brut)) {
    return { ok: true, local: true, fournisseur: 'fichier', etiquette: 'fichier du site', page: brut, format: 'libre' };
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(brut.split('?')[0])) {
    if (!/^https:\/\//i.test(brut)) return { ok: false, erreur: 'Un fichier vidéo externe doit être en https.' };
    return { ok: true, local: true, fournisseur: 'fichier', etiquette: 'fichier vidéo', page: brut, format: 'libre' };
  }

  let u;
  try {
    u = new URL(brut);
  } catch {
    return { ok: false, erreur: 'Ce lien n’est pas une adresse web complète (http:// ou https://).' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, erreur: 'Seuls les liens http(s) sont acceptés.' };
  }

  /* un lien raccourci est un lien honnête : on l'enregistre, on l'affiche, mais
     on n'en fait jamais un cadre — on ne sait pas ce qu'il deviendra. */
  if (estRaccourci(u.hostname + u.pathname + u.search)) {
    return { ok: true, fournisseur: 'raccourci', etiquette: 'lien raccourci', page: brut, format: 'libre' };
  }

  for (const f of FOURNISSEURS) {
    if (!f.hotes.test(u.hostname)) continue;
    const id = f.id(u);
    if (!id) continue;
    return {
      ok: true,
      fournisseur: f.nom,
      etiquette: f.etiquette,
      id: String(id).slice(0, 40),
      page: f.page(id, u),
      cadre: f.cadre(id),
      miniature: f.miniature ? f.miniature(id) : null,
      miniature_originale: f.miniatureOriginale ? f.miniatureOriginale(id) : null,
      format: f.format(u, id),
    };
  }

  /* reste le lien raccourci : honnête, on l'enregistre et on l'affiche, mais on
     n'en fait jamais un cadre — on ne sait pas ce qu'il devient. */
  if (estRaccourci(u.hostname + u.pathname + u.search + u.hash)) {
    return { ok: true, fournisseur: 'raccourci', etiquette: 'lien raccourci', page: brut, format: 'libre' };
  }
  return { ok: false, erreur: 'Lien non reconnu : YouTube, YouTube Shorts, Vimeo, TikTok ou Instagram — ou un fichier .mp4 déposé sur le site.' };
}

/* Une adresse de lecteur est-elle bien l'un des cadres qu'on autorise ?
   Utilisé à l'affichage : on ne met jamais dans un <iframe> une adresse qui
   n'aurait pas été fabriquée ici (lien détourné, ancien enregistrement…). */
/* Les seuls hôtes dont la boutique accepte d'afficher le lecteur. Une seule
   liste, lue deux fois : par `cadreAutorise` (à l'enregistrement) et par
   l'en-tête Content-Security-Policy (au navigateur). Sans `frame-src`, le
   navigateur applique `default-src 'self'` et refuse le cadre : la fiche
   affiche un lecteur vide, sans rien dire dans le HTML — c'est le « la vidéo
   ne vient pas » le plus tenace, et il ne se voit que dans la console. */
const HOTES_CADRE = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.tiktok.com', 'www.instagram.com'];
const TRAME_CADRE = new RegExp('^(?:' + HOTES_CADRE.map((h) => h.replace(/\./g, '\\.')).join('|') + ')$');

function cadreAutorise(url) {
  const u = String(url || '');
  if (!/^https:\/\//.test(u)) return false;
  try {
    return TRAME_CADRE.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

/** La directive CSP qui va avec la liste ci-dessus — jamais `frame-src *`. */
const directiveCadre = () => 'frame-src ' + HOTES_CADRE.map((h) => 'https://' + h).join(' ');

module.exports = { analyser, resoudre, estRaccourci, cadreAutorise, directiveCadre, HOTES_CADRE, FOURNISSEURS, FOURNISSEUR_PAR_NOM };
