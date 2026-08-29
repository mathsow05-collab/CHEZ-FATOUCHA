#!/usr/bin/env node
/* =========================================================================
   CHEZ FATOUCHA — pré-cuisson des images (npm run build)

   Pourquoi ce script : les vignettes ne sont pas les fichiers du dépôt, ce
   sont des déclinaisons (220/480/900/1200 px en AVIF et WebP) calculées à la
   demande. Sur une petite instance qui vient de se réveiller — et qui repart
   en sommeil dix minutes après — le cache de données est VIDE à chaque fois,
   donc la première personne à arriver attendait une seconde par image.

   Ce script fait le même travail, mais pendant la construction : les variantes
   sont écrites dans `.img-cache/` (dossier du build, pas du disque éphémère),
   avec exactement la clé que le serveur cherche. Au premier visiteur, il ne
   reste plus qu'à lire un fichier.

   Idempotent : une variante déjà cuite est sautée, donc un `npm run build`
   répété ne coûte presque rien.
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const optima = require('../server/optima');

const RACINE = path.join(__dirname, '..', 'public', 'media');
const POIDS = [8192];            /* en dessous, c'est un témoin, pas une photo */

function images(dossier, acc = []) {
  let noms = [];
  try { noms = fs.readdirSync(dossier, { withFileTypes: true }); } catch { return acc; }
  for (const d of noms) {
    const plein = path.join(dossier, d.name);
    if (d.isDirectory()) images(plein, acc);
    else if (/\.(jpe?g|png|webp)$/i.test(d.name) && fs.statSync(plein).size >= POIDS[0]) acc.push(plein);
  }
  return acc;
}

(async () => {
  if (!optima.disponible || !optima.disponible()) {
    console.log('[images] module de redimensionnement absent : rien à pré-cuire (les photos seront servies telles quelles).');
    return;
  }
  const fichiers = images(RACINE);
  fs.mkdirSync(optima.CACHE_BUILD, { recursive: true });
  let cuites = 0;
  let deja = 0;
  let sauts = 0;
  const t0 = Date.now();
  for (const abs of fichiers) {
    /* TOUTES les largeurs, y compris le 1200 px : le bandeau de l'accueil et la
       loupe de la fiche le réclament sur écran d'ordinateur, et une variante qui
       n'est pas cuite d'avance se paie en secondes d'attente (mesuré : 23 s sur
       l'instance gratuite, le CPU y est bridé). Réglable sans toucher au code si
       un build devient trop long : PRECUIRE="220,480,900". */
    const largeurs = (process.env.PRECUIRE || '')
      .split(',').map((x) => Number(x.trim())).filter((x) => optima.LARGEURS.includes(x));
    for (const largeur of (largeurs.length ? largeurs : optima.LARGEURS)) {
      for (const format of ['avif', 'webp']) {
        const cle = optima.cleDeCache(abs, largeur, format, optima.CACHE_BUILD);
        if (fs.existsSync(cle)) { deja++; continue; }
        const r = await optima.generer(abs, largeur, format, { vers: optima.CACHE_BUILD });
        if (r && !r.depuisCache) cuites++;
        else deja++;
        if (!r) sauts++;
      }
    }
  }
  const poids = fs.readdirSync(optima.CACHE_BUILD)
    .reduce((a, f) => a + fs.statSync(path.join(optima.CACHE_BUILD, f)).size, 0);
  console.log(`[images] ${fichiers.length} visuels · ${cuites} variantes cuites, ${deja} déjà prêtes, ${sauts} sautées · `
    + `${(poids / 1048576).toFixed(1)} Mo dans .img-cache · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
