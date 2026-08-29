/* Réchauffage du cache d'images.
   ------------------------------------------------------------------
   Le « les photos chargent trop long » vient de là : sur Render, le disque est
   VIERGE à chaque démarrage (instance gratuite, pas de volume persistant). La
   première cliente qui ouvre l'accueil ne télécharge pas des images — elle
   déclenche douze conversions AVIF/WebP sur un seul cœur, une par une, pendant
   que les cadres restent beiges. La visiteuse d'après, elle, a tout en 3 ms.

   On fait donc le travail à la place de la première visite : dès que le serveur
   écoute, on fabrique en tâche de fond les variantes dont les pages d'entrée ont
   besoin. Deux à la fois, jamais plus : une conversion en cours ne doit pas
   voler le processeur d'une vraie requête.

     GET /img/<largeur>/<url>   → trouve le fichier, répond « disque », ne calcule rien

   Désactivable sans toucher au code : RECHAUFFE=0. Et si `sharp` est absent,
   on ne chauffe rien : le serveur renverra l'original, comme avant. */
const catalogue = require('./catalogue');
const optima = require('./optima');

const PETITES = [220, 480];        /* vignettes des cartes et des rails : ce que voit l'accueil */
const GRANDES = [900];             /* photo principale d'une fiche */
/* Combien d'articles préparer, et combien d'entre eux ont aussi leur grande
   photo d'office. Réglable sans toucher au code : RECHAUFFE_NB / RECHAUFFE_GRAND. */
const MAX_ARTICLES = Number(process.env.RECHAUFFE_NB || 16) || 16;
const GRAND = Number(process.env.RECHAUFFE_GRAND || 8);
const CONCORDANCE = 2;             /* deux conversions à la fois : le reste attend la place */

const etat = { total: 0, fait: 0, sautes: 0, erreur: null, enCours: false, ms: 0 };
let lance = false;

const imagesDe = (row) => {
  const liste = catalogue.imagesEnrichies(row.images);
  const urls = [];
  for (let i = 0; i < liste.length; i++) {
    const u = liste[i] && liste[i].url;
    if (u) urls.push({ url: u, principale: i === 0 });
  }
  return urls;
};

/* Une fileuse minute : on prend le suivant dès qu'une place se libère. */
async function traitent(taches) {
  const file = taches.slice();
  const ouvriers = Array.from({ length: Math.min(CONCORDANCE, file.length) }, async () => {
    while (file.length) {
      const t = file.shift();
      try {
        const r = await t();
        if (r === 'cache') etat.sautes++; else etat.fait++;
      } catch (e) {
        /* une photo absente ou lisée ne doit pas empêcher les autres de se préparer */
        etat.erreur = String(e && e.message ? e.message : e).slice(0, 160);
      }
      /* on rend la main entre deux images : le serveur doit répondre aux clientes */
      await new Promise((r) => setImmediate(r));
    }
  });
  await Promise.all(ouvriers);
}

/* Une tâche de conversion, prête à être jouée par la fileuse. */
function tacheDe(abs, largeur, format) {
  return async () => {
    const r = await optima.generer(abs, largeur, format);
    return r && r.depuisCache ? 'cache' : 'fait';
  };
}

/* L'ordre est un choix de vitesse : la fileuse traite la liste dans l'ordre,
   donc ce qui est posé en premier est ce que la première visiteuse verra en
   premier. Le bandeau d'abord (il est tout de suite à l'écran), puis les
   vignettes de l'accueil, puis les grandes photos des fiches. */
async function taches() {
  const tete = [];
  const milieu = [];
  const queue = [];

  const hero = optima.fichierSource('/media/demo/lookbook.jpg');
  if (hero) for (const largeur of [480, 900, 1200]) for (const f of ['avif', 'webp']) tete.push(tacheDe(hero, largeur, f));

  /* les articles en ligne, dans l'ordre de la page d'accueil (les inactifs sont exclus ici) */
  const rows = catalogue.listerProduits({ limit: MAX_ARTICLES });
  rows.forEach((row, i) => {
    const vues = imagesDe(row);
    vues.forEach(({ url, principale }) => {
      const abs = optima.fichierSource(url);
      if (!abs) return;
      for (const largeur of PETITES) for (const f of ['avif', 'webp']) milieu.push(tacheDe(abs, largeur, f));
      /* la grande photo ne se prépare que pour les fiches les plus exposées :
         les autres la paieront à la demande, une seule conversion, ~100 ms */
      if (principale && i < GRAND) for (const largeur of GRANDES) for (const f of ['avif', 'webp']) queue.push(tacheDe(abs, largeur, f));
    });
  });

  return tete.concat(milieu, queue);
}

/* Appelé juste après `listen()`. Ne rejette jamais : le réchauffage est une
   politesse, pas une dépendance du démarrage. */
async function lancer() {
  if (lance || !optima.disponible()) return etat;
  lance = true;
  const t0 = Date.now();
  etat.enCours = true;
  try {
    const liste = await taches();
    etat.total = liste.length;
    await traitent(liste);
  } catch (e) {
    etat.erreur = String(e && e.message ? e.message : e).slice(0, 160);
  }
  etat.enCours = false;
  etat.ms = Date.now() - t0;
  console.log(`🖼️  cache d’images préparé : ${etat.fait} variante(s) créée(s), ${etat.sautes} déjà en place, en ${(etat.ms / 1000).toFixed(1)} s${etat.erreur ? ' · un souci : ' + etat.erreur : ''}`);
  return etat;
}

const etatPublic = () => ({
  en_cours: etat.enCours,
  total: etat.total,
  creees: etat.fait,
  deja_la: etat.sautes,
  ms: etat.ms,
  erreur: etat.erreur,
});

/* Une photo vient d'être déposée par la vendeuse : ses vignettes sont préparées
   tout de suite, en tâche de fond, sans retarder la réponse. La fiche sera
   prête avant la première visiteuse, au lieu de coder pendant qu'elle attend.
   (Le module n'a pas besoin d'avoir été « lancé » : c'est une file séparée,
   une image à la fois, et un appel raté ne casse rien — l'original reste servi.) */
function apresUpload(url) {
  setImmediate(async () => {
    try {
      if (!optima.disponible || !optima.disponible()) return;
      const abs = optima.fichierSource(String(url || ''));
      if (!abs) return;
      for (const largeur of PETITES.concat(GRANDES)) {
        for (const format of ['avif', 'webp']) {
          try { await optima.generer(abs, largeur, format); } catch { /* on laisse la demande la faire */ }
          await new Promise((r) => setImmediate(r));
        }
      }
    } catch { /* jamais bloquant pour le téléversement */ }
  });
}

module.exports = { lancer, etatPublic, apresUpload, PETITES, GRANDES, MAX_ARTICLES, CONCORDANCE };
