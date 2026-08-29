/* ------------------------------------------------------------------------
   icones.js — le jeu d'icônes animées de la boutique
   ------------------------------------------------------------------------
   Pourquoi ce fichier : les emojis (🔍 🧺 ❤) rendent n'importe quel design
   « bricolé » — chaque système d'exploitation dessine autre chose, la
   graisse est incohérente avec la typographie, et ça ne s'anime pas.

   Ici, chaque icône est un SVG 24×24 en trait (stroke), couleur
   `currentColor`, avec une pièce mobile marquée `data-cible` que le CSS
   anime au survol / à l'état actif — même famille de mouvements que les
   « Motion Icons », mais sans dépendance et sans JavaScript d'animation.

   Le fichier est un UMD : le navigateur lit `window.icone(...)`, le rendu
   serveur (`server/pages.js`) fait `require('../public/js/icones.js')` —
   une seule source pour les deux mondes, donc aucune chance de dérive. */
(function (globalThis_, factory) {
  const module_ = factory();
  if (typeof module === 'object' && module.exports) module.exports = module_;
  globalThis_.icone = module_.icone;
  globalThis_.puceCategorie = module_.puceCategorie;
  globalThis_.sansPictos = module_.sansPictos;
  globalThis_.icones = module_;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TRAIT = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

  /* chaque entrée : le corps du SVG (sans la balise <svg>). La classe est écrite
     en toutes lettres (`cls`) exprès : le contrôle `npm run check:css` vérifie
     qu'aucune classe de la feuille de style n'est morte en la cherchant dans le
     code — une classe fabriquée à la volée (`'ico-' + nom`) serait déclarée morte. */
  const TRACÉS = {
    recherche: { cls: 'ico-recherche', svg: '<circle cx="11" cy="11" r="6.4"/><path data-cible="a" d="M15.8 15.8 20 20"/>' },
    panier: { cls: 'ico-panier', svg: '<path data-cible="a" d="M6.2 8.6h11.6l1 11.4H5.2z"/><path data-cible="b" d="M9.2 8.6V7a2.8 2.8 0 0 1 5.6 0v1.6"/>' },
    coeur: { cls: 'ico-coeur', svg: '<path data-cible="a" d="M12 20s-7.2-4.5-7.2-9.4A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.2 2.4C19.2 15.5 12 20 12 20Z"/>' },
    menu: { cls: 'ico-menu', svg: '<path data-cible="h" d="M4 7.5h16M4 12h16M4 16.5h16"/>' },
    croix: { cls: 'ico-croix', svg: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>' },
    plus: { cls: 'ico-plus', svg: '<path data-cible="a" d="M12 5.8v12.4M5.8 12h12.4"/>' },
    moins: { cls: 'ico-moins', svg: '<path d="M5.8 12h12.4"/>' },
    check: { cls: 'ico-check', svg: '<path data-cible="a" d="m5.4 12.6 4.4 4.4 8.8-10"/>' },
    etoile: { cls: 'ico-etoile', svg: '<path data-cible="a" d="m12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>' },
    camion: { cls: 'ico-camion', svg: '<path data-cible="a" d="M2.8 7.4h9.8v9.2H2.8z"/><path d="M12.6 10.6h3.6l2.9 3v3h-6.5z"/><circle data-cible="r1" cx="6.6" cy="17.8" r="1.7"/><circle data-cible="r2" cx="16.2" cy="17.8" r="1.7"/>' },
    boutique: { cls: 'ico-boutique', svg: '<path data-cible="a" d="M4.2 9.6h15.6V20H4.2z"/><path d="M3 9.6 5.2 4.4h13.6L21 9.6"/><path d="M9.6 20v-5.4h4.8V20"/>' },
    whatsapp: { cls: 'ico-whatsapp', svg: '<path data-cible="a" d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12Z"/><path data-cible="b" d="M9.2 8.8c.4 2.6 3.4 5.6 6 6l1.2-1.6-1.9-1.1-1 .7c-1-.5-2-1.5-2.5-2.5l.7-1-1.1-1.9z"/>' },
    partager: { cls: 'ico-partager', svg: '<circle cx="17.6" cy="6.2" r="2.2"/><circle cx="6.4" cy="12" r="2.2"/><circle cx="17.6" cy="17.8" r="2.2"/><path data-cible="a" d="M8.4 10.9 15.6 7.2M8.4 13.1l7.2 3.7"/>' },
    zoom: { cls: 'ico-zoom', svg: '<circle data-cible="a" cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20 20M11 8.6v4.8M8.6 11h4.8"/>' },
    fleche: { cls: 'ico-fleche', svg: '<path data-cible="a" d="M4.6 12h14"/><path data-cible="b" d="m13.6 6.8 5.2 5.2-5.2 5.2"/>' },
    fleche_gauche: { cls: 'ico-fleche_gauche', svg: '<path data-cible="a" d="M19.4 12h-14"/><path data-cible="b" d="M10.4 6.8 5.2 12l5.2 5.2"/>' },
    bas: { cls: 'ico-bas', svg: '<path data-cible="a" d="M12 4.8v13"/><path data-cible="b" d="m6.6 12.6 5.4 5.4 5.4-5.4"/>' },
    filtres: { cls: 'ico-filtres', svg: '<path data-cible="a" d="M4 8.4h16M4 15.6h16"/><circle cx="9.6" cy="8.4" r="2"/><circle cx="15" cy="15.6" r="2"/>' },
    alerte: { cls: 'ico-alerte', svg: '<path data-cible="a" d="M12 4.4c-3.2 0-5.2 2.3-5.2 5.4 0 4.4-1.6 5.8-1.6 5.8h13.6s-1.6-1.4-1.6-5.8c0-3.1-2-5.4-5.2-5.4Z"/><path data-cible="b" d="M10.2 18.6a2 2 0 0 0 3.6 0"/>' },
    colis: { cls: 'ico-colis', svg: '<path data-cible="a" d="M4.4 9.4 12 5.4l7.6 4v9.2L12 22.6l-7.6-4z"/><path d="M4.4 9.4 12 13.4l7.6-4M12 13.4v9.2"/>' },
    crayon: { cls: 'ico-crayon', svg: '<path data-cible="a" d="M4.6 19.4h3.2l9.4-9.4-3.2-3.2-9.4 9.4z"/><path d="m14 5.6 3.2 3.2 1.8-1.8a1.6 1.6 0 0 0 0-2.3l-.9-.9a1.6 1.6 0 0 0-2.3 0z"/>' },
    image: { cls: 'ico-image', svg: '<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="1.6"/><circle cx="9" cy="10.2" r="1.4"/><path data-cible="a" d="m4.8 17.4 4.6-4 3.2 2.6 3-2.6 4.6 4"/>' },
    video: { cls: 'ico-video', svg: '<rect x="3.4" y="6" width="12.6" height="12" rx="2"/><path data-cible="a" d="m16 12 4.6-3v9L16 15z"/>' },
    regle: { cls: 'ico-regle', svg: '<path data-cible="a" d="M3.6 8.6h16.8v6.8H3.6z"/><path d="M7.4 8.6v2.4M11 8.6v3.4M14.6 8.6v2.4M18.2 8.6v3.4"/>' },
    sablier: { cls: 'ico-sablier', svg: '<path data-cible="a" d="M7 4.6h10M7 19.4h10M8.2 4.6C8.2 9 12 9.6 12 12s-3.8 3-3.8 7.4M15.8 4.6c0 4.4-3.8 5-3.8 7.4s3.8 3 3.8 7.4"/>' },
    utilisateur: { cls: 'ico-utilisateur', svg: '<circle data-cible="a" cx="12" cy="8.4" r="3.4"/><path d="M5.4 19.6a6.9 6.9 0 0 1 13.2 0"/>' },
    poubelle: { cls: 'ico-poubelle', svg: '<path data-cible="a" d="M4.8 7.4h14.4M9.4 7.4V5.6h5.2v1.8"/><path d="M6.6 7.4 7.6 20h8.8l1-12.6"/>' },
    etiquette: { cls: 'ico-etiquette', svg: '<path data-cible="a" d="M12.6 3.8H20v7.4l-8.8 8.8-7.4-7.4z"/><circle cx="16.4" cy="7.4" r="1.4"/>' },
    telephone: { cls: 'ico-telephone', svg: '<path data-cible="a" d="M6.2 4.4h3l1.6 4-2 1.4a10.6 10.6 0 0 0 5.4 5.4l1.4-2 4 1.6v3a1.8 1.8 0 0 1-2 1.8C10.2 19.8 4.2 13.8 4.4 6.4a1.8 1.8 0 0 1 1.8-2Z"/>' },
    localisation: { cls: 'ico-localisation', svg: '<path data-cible="a" d="M12 21s6-6 6-10.4A6 6 0 0 0 6 10.6C6 15 12 21 12 21Z"/><circle cx="12" cy="10.4" r="2.2"/>' },
    oeil: { cls: 'ico-oeil', svg: '<path data-cible="a" d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.6"/>' },
    ondule: { cls: 'ico-ondule', svg: '<path data-cible="a" d="M3 14.4c1.8-2.4 3.6-2.4 5.4 0s3.6 2.4 5.4 0 3.6-2.4 5.4 0"/><path data-cible="b" d="M3 9c1.8-2.4 3.6-2.4 5.4 0s3.6 2.4 5.4 0 3.6-2.4 5.4 0"/>' },
    tri: { cls: 'ico-tri', svg: '<path data-cible="a" d="M6.4 4.6v14.8M6.4 19.4 3.6 16.4M6.4 19.4l2.8-3M12.6 7.4h7.8M12.6 12.4h5.6M12.6 17.4h3.4"/>' },
    grille: { cls: 'ico-grille', svg: '<rect data-cible="a" x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>' },
    carte: { cls: 'ico-carte', svg: '<rect data-cible="a" x="2.8" y="5.8" width="18.4" height="12.4" rx="2.2"/><path d="M2.8 10h18.4"/><path d="M6.2 14.6h3.2"/>' },
    discuter: { cls: 'ico-discuter', svg: '<path data-cible="a" d="M4.4 5.6h15.2v10.2H9.6L5.6 19v-3.2H4.4z"/><path d="M8 9.6h8M8 12.4h5"/>' },
    echange: { cls: 'ico-echange', svg: '<path data-cible="a" d="M4.6 9.6a7.4 7.4 0 0 1 12.6-3.4M19.4 14.4a7.4 7.4 0 0 1-12.6 3.4"/><path d="M17.6 3.2v3.2h-3.2M6.4 20.8v-3.2h3.2"/>' },
    recu: { cls: 'ico-recu', svg: '<path data-cible="a" d="M6 3.6h12v16.8l-3-2-3 2-3-2-3 2z"/><path d="M9 8.4h6M9 12h6M9 15.6h3.6"/>' },
    billets: { cls: 'ico-billets', svg: '<rect data-cible="a" x="2.8" y="6.6" width="18.4" height="10.8" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 10.2v3.6M18 10.2v3.6"/>' },
    cadenas: { cls: 'ico-cadenas', svg: '<rect data-cible="a" x="5" y="10.4" width="14" height="9.2" rx="2"/><path data-cible="b" d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4"/>' },
    disque: { cls: 'ico-disque', svg: '<path data-cible="a" d="M4.6 4.6h11.2l3.6 3.6v11.2H4.6z"/><path d="M8 4.6v5.2h7V4.6"/><rect x="8" y="13.4" width="8" height="6" rx=".8"/>' },
    reglages: { cls: 'ico-reglages', svg: '<circle data-cible="a" cx="12" cy="12" r="3.1"/><path d="M12 3.4v2.1M12 18.5v2.1M4.9 12H7M17 12h2.1M6.9 6.9l1.5 1.5M15.6 15.6l1.5 1.5M17.1 6.9l-1.5 1.5M8.4 15.6l-1.5 1.5"/>' },
    photo: { cls: 'ico-photo', svg: '<rect x="3.4" y="6.6" width="17.2" height="13" rx="2.2"/><circle data-cible="a" cx="12" cy="13.1" r="3.5"/><path d="M8.6 6.6 10 4.4h4l1.4 2.2"/>' },
    importer: { cls: 'ico-importer', svg: '<path data-cible="a" d="M12 16.4V4.6M8.2 8.4 12 4.6l3.8 3.8"/><path d="M4.6 15v3.2a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8V15"/>' },
    graphique: { cls: 'ico-graphique', svg: '<path data-cible="a" d="M4.6 19.4V9.8M9.8 19.4V4.6M15 19.4v-6.8M20.2 19.4v-9.6"/>' },
    document: { cls: 'ico-document', svg: '<path data-cible="a" d="M6 3.6h7.4L19 9.2V20.4H6z"/><path d="M13.4 3.6v5.6H19M8.8 13h6.4M8.8 16.4h6.4"/>' },
    idee: { cls: 'ico-idee', svg: '<path data-cible="a" d="M12 3.8a5.4 5.4 0 0 1 3.2 9.7c-.7.5-1 1.2-1 2h-4.4c0-.8-.3-1.5-1-2A5.4 5.4 0 0 1 12 3.8Z"/><path d="M10 18.4h4M10.6 20.6h2.8"/>' },
    lien: { cls: 'ico-lien', svg: '<path data-cible="a" d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.5-2.5a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1"/><path data-cible="b" d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0L6 12.9a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1"/>' },
    imprimante: { cls: 'ico-imprimante', svg: '<path data-cible="a" d="M7 9.4V4.6h10v4.8"/><rect x="4" y="9.4" width="16" height="7" rx="1.8"/><path d="M7 14.4h10v5H7z"/>' },
    horloge: { cls: 'ico-horloge', svg: '<circle data-cible="a" cx="12" cy="12" r="7.6"/><path data-cible="b" d="M12 7.6V12l3.2 2"/>' },
    robe: { cls: 'ico-robe', svg: '<path data-cible="a" d="M9.4 3.8 12 6.2l2.6-2.4 2.6 2.6-1.8 1.6.4 3 2.4 9.2H5.8l2.4-9.2.4-3-1.8-1.6z"/>' },
    chemise: { cls: 'ico-chemise', svg: '<path data-cible="a" d="M8.6 4.4 12 7.2l3.4-2.8 4.2 2.2-1.6 3.2-1.4-.6V20H7.4v-8.8L6 11.8l-1.6-3.2z"/><path d="M12 7.2V20"/>' },
    sac: { cls: 'ico-sac', svg: '<path data-cible="a" d="M5 9.8h14l1 10.2H4z"/><path d="M8.8 9.8V7.6a3.2 3.2 0 0 1 6.4 0v2.2"/>' },
    basket: { cls: 'ico-basket', svg: '<path data-cible="a" d="M3.6 17.4h12.6c2 0 4.2-1 4.2-2.6 0-1.4-2-2-3.6-2.6l-3.2-1.4-1.6 1.6-2-2L8.2 12c-1.6.6-4.6 1.2-4.6 3.2z"/><path d="M3.6 14.8h16.8"/>' },
    rouge: { cls: 'ico-rouge', svg: '<rect x="9" y="11" width="6" height="9" rx="1.2"/><path data-cible="a" d="M9.8 11V6.2c0-1 .8-1.8 1.8-1.8h.8c1 0 1.8.8 1.8 1.8V11"/>' },
    montre: { cls: 'ico-montre', svg: '<circle data-cible="a" cx="12" cy="12" r="4.6"/><path d="M9.4 7.6 9.8 4h4.4l.4 3.6M9.8 16.4 9.4 20h4.4l.4-3.6"/><path data-cible="b" d="M12 9.8V12l1.8 1.2"/>' },
    bague: { cls: 'ico-bague', svg: '<circle data-cible="a" cx="12" cy="14.8" r="4.6"/><path d="m10.2 10.4 1.8-3.6 1.8 3.6"/>' },
    enfant: { cls: 'ico-enfant', svg: '<circle data-cible="a" cx="12" cy="6.8" r="2.8"/><path d="M8.6 20v-4.4a3.4 3.4 0 0 1 6.8 0V20M6.8 12.6 8.8 11M17.2 12.6 15.2 11"/>' },
    maison: { cls: 'ico-maison', svg: '<path data-cible="a" d="M4 10.6 12 4.4l8 6.2V20H4z"/><path d="M10 20v-5h4v5"/>' },
    pantalon: { cls: 'ico-pantalon', svg: '<path data-cible="a" d="M7.4 4.2h9.2l.8 15.6h-4.2L12 11.4l-1.2 8.4H6.6z"/><path d="M7.4 7.6h9.2"/>' },
    bijoux: { cls: 'ico-bijoux', svg: '<path data-cible="a" d="m12 4.6 3.4 3.4L12 19.4 8.6 8z"/><path d="M8.6 8h6.8M10.2 4.6h3.6"/>' },
    parfum: { cls: 'ico-parfum', svg: '<rect x="9" y="8.8" width="6" height="11.4" rx="1.6"/><path data-cible="a" d="M10.8 8.8V6h2.4v2.8M9.6 4.2h4.8"/>' },
    soleil: { cls: 'ico-soleil', svg: '<circle data-cible="a" cx="12" cy="12" r="4"/><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>' },
  };

  /* les classes d'animation : `data-anime` permet au CSS de cibler le
     mouvement propre à l'icône (sinon tout hériterait de `.ico`) */
  function icone(nom, options) {
    const o = options || {};
    const ico = TRACÉS[nom];
    if (!ico) return '';
    const taille = o.taille ? ` style="--ico:${o.taille}px"` : '';
    const label = o.label ? ` role="img" aria-label="${String(o.label).replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
    const etat = o.etat ? ` data-etat="${o.etat}"` : '';
    const anim = o.anim ? ` data-anim="${o.anim}"` : '';
    return `<span class="ico ${ico.cls}"${taille}${label}${etat}${anim}><svg viewBox="0 0 24 24" ${TRAIT} focusable="false">${ico.svg}</svg></span>`;
  }

  /* --- les catégories ---
     Le champ « icône » d'une catégorie est libre en base (l'espace vendeur y met
    souvent un pictogramme). Sur le site, un pictogramme coloré jure avec le
     trait fin du thème : on le convertit donc en icône dessinée. Un nom d'icône
     (« sac », « robe ») fonctionne aussi, pour ceux qui préfèrent. */
  const PAR_EMOTICONE = {
    /* vêtements */
    '\u{1F457}': 'robe', '\u{1F97B}': 'robe', '\u{1F455}': 'pantalon',
    '\u{1F454}': 'chemise', '\u{1F45A}': 'chemise', '\u{1F9E5}': 'chemise',
    '\u{1F45C}': 'sac', '\u{1F45B}': 'sac', '\u{1F45D}': 'sac', '\u{1F392}': 'sac',
    '\u{1F45F}': 'basket', '\u{1F45E}': 'basket', '\u{1F97F}': 'basket',
    '\u{1F460}': 'basket', '\u{1F462}': 'basket',
    '\u231A': 'montre',
    /* beauté, bijoux, maison, enfants */
    '\u{1F484}': 'rouge', '\u{1F485}': 'rouge', '\u{1F9F4}': 'parfum', '\u{1F338}': 'parfum',
    '\u{1F48D}': 'bague', '\u{1F48E}': 'bijoux', '\u{1F451}': 'bijoux',
    '\u{1F3E0}': 'maison', '\u{1F6CF}': 'maison', '\u{1FAA4}': 'maison',
    '\u{1F9D2}': 'enfant', '\u{1F476}': 'enfant', '\u{1F467}': 'enfant',
    '\u{1F466}': 'enfant', '\u{1F9F8}': 'enfant',
    /* divers */
    '\u2728': 'etoile', '\u2B50': 'etoile', '\u{1F4E6}': 'colis', '\u{1F381}': 'colis',
    /* ce que l'espace vendeur manipule */
    '\u{1F4BE}': 'disque', '\u2699': 'reglages', '\u{1F4E4}': 'importer', '\u{1F4E5}': 'importer',
    '\u{1F4CA}': 'graphique', '\u{1F4C8}': 'graphique', '\u{1F4C9}': 'graphique', '\u{1F4C7}': 'graphique',
    '\u{1F4C4}': 'document', '\u{1F4DD}': 'crayon', '\u{1F4C1}': 'grille', '\u{1F5C2}': 'grille',
    '\u{1F4A1}': 'idee', '\u{1F517}': 'lien', '\u{1F5A8}': 'imprimante', '\u23F1': 'horloge',
    '\u23F2': 'horloge', '\u23F3': 'sablier', '\u231B': 'sablier', '\u{1F6AB}': 'alerte',
    '\u{1F4E6}': 'colis', '\u{1F3EA}': 'boutique', '\u{1F69A}': 'camion', '\u{1F4F7}': 'photo',
    '\u{1F3AC}': 'video', '\u{1F5DD}': 'regle', '\u{1F50F}': 'cadenas', '\u{1F44B}': 'discuter',
    '\u270F': 'crayon', '\u{1F5D1}': 'poubelle', '\u26A0': 'alerte', '\u{1F550}': 'horloge',
  };
  /* Pictogrammes -> tracés. Le champ libre (titre d'article, note de l'admin,
     onglet du back-office) peut contenir un emoji ; le rendre ici évite d'en
     mettre un garde-fou par écran. Les marques typographiques (✔ ★ ● ♥ ✕) sont
     laissées telles quelles : ce ne sont pas des images colorées. */
  const RE_PICTO = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FA}\u{2699}\u{26A0}\u{2611}\u{270F}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

  function sansPictos(html, options) {
    const brut = String(html == null ? '' : html);
    if (!brut || !RE_PICTO.test(brut)) return brut;
    RE_PICTO.lastIndex = 0;
    const taille = (options && options.taille) || 16;
    return brut.replace(RE_PICTO, (m) => {
      const net = m.replace(/\u{FE0F}/gu, '');
      const nom = PAR_EMOTICONE[m] || PAR_EMOTICONE[net] || (TRACÉS[net] ? net : '');
      return nom ? icone(nom, { taille }) : '';
    });
  }

  function puceCategorie(valeur, options) {
    const brut = String(valeur == null ? '' : valeur).trim();
    if (!brut) return '';
    const nom = TRACÉS[brut] ? brut : (PAR_EMOTICONE[brut] || '');
    if (!nom) return '';                     /* on n'affiche jamais un pictogramme brut */
    return icone(nom, Object.assign({ taille: 16 }, options || {}));
  }

  return { icone, puceCategorie, sansPictos, tracés: TRACÉS, noms: Object.keys(TRACÉS), parEmoticone: PAR_EMOTICONE };
});
