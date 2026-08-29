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
    miniature: (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
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
      format: f.format(u, id),
    };
  }

  return { ok: false, erreur: 'Lien non reconnu : YouTube, YouTube Shorts, Vimeo, TikTok ou Instagram — ou un fichier .mp4 déposé sur le site.' };
}

/* Une adresse de lecteur est-elle bien l'un des cadres qu'on autorise ?
   Utilisé à l'affichage : on ne met jamais dans un <iframe> une adresse qui
   n'aurait pas été fabriquée ici (lien détourné, ancien enregistrement…). */
function cadreAutorise(url) {
  const u = String(url || '');
  if (!/^https:\/\//.test(u)) return false;
  try {
    const h = new URL(u).hostname;
    return /^(www\.youtube-nocookie\.com|player\.vimeo\.com|www\.tiktok\.com|www\.instagram\.com)$/.test(h);
  } catch {
    return false;
  }
}

module.exports = { analyser, cadreAutorise, FOURNISSEURS, FOURNISSEUR_PAR_NOM };
