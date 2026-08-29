/* Service worker — CHEZ FATOUCHA.
   Objectif : une boutique qui s'ouvre vite sur un réseau lent, et qui montre
   encore le catalogue quand la connexion tombe. Rien d'automatique côté argent :
   les pages de commande, de paiement et le back-office ne sont jamais mis en
   cache, pour qu'aucune cliente ne voie un prix ou un stock périmé. */
const VERSION = 'fatoucha-v3';
const MAX_IMG = 80;

const JAMAIS = [/^\/api\/admin/, /^\/api\/commandes/, /^\/api\/paiement/, /^\/admin/, /\/(panier|commande|paiement)/];
const RESEAU_DABORD = [/^\/$/, /^\/boutique/, /^\/produit\//, /^\/categorie\//, /^\/faq/, /^\/retours/, /^\/livraison/, /^\/a-propos/, /^\/api\/(config|produits|categories|zones|stats|pages)/];
const CACHE_DABORD = [/^\/css\//, /^\/js\//, /^\/img\//, /^\/media\//, /^\/uploads\//, /^\/manifest\.webmanifest$/];

const estPour = (reg, url) => reg.some((r) => r.test(url));

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/css/style.css', '/js/icones.js', '/js/mouvement.js', '/js/api.js', '/js/app.js', '/manifest.webmanifest', '/media/favicon.svg',
        '/media/polices/fraunces-latin-standard-normal.woff2', '/media/polices/manrope-latin-wght-normal.woff2', '/media/polices/fraunces-latin-standard-italic.woff2', '/media/polices/manrope-latin-ext-wght-normal.woff2'])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const cle of await caches.keys()) if (cle !== VERSION) await caches.delete(cle);
      await self.clients.claim();
    })()
  );
});

/* On garde un nombre borné d'images en cache : le disque des forfaits
   gratuits est petit et le navigateur de la cliente aussi. */
async function ranger(cachette) {
  const cles = await cachette.keys();
  const images = cles.filter((u) => /\/(img|media|uploads)\//.test(u.pathname));
  if (images.length <= MAX_IMG) return;
  for (const vieille of images.slice(0, images.length - MAX_IMG)) await cachette.delete(vieille);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const chemin = url.pathname + url.search;
  if (estPour(JAMAIS, chemin)) return;

  if (estPour(CACHE_DABORD, chemin) && !chemin.startsWith('/api/')) {
    e.respondWith(
      (async () => {
        const cachette = await caches.open(VERSION);
        const enCache = await cachette.match(req);
        if (enCache) return enCache;
        const reponse = await fetch(req);
        if (reponse && reponse.ok) {
          cachette.put(req, reponse.clone()).then(() => ranger(cachette)).catch(() => {});
        }
        return reponse;
      })()
    );
    return;
  }

  /* Pages et données du catalogue : le réseau d'abord (prix et stock doivent
     être justes), le cache ne sert que de filet quand rien ne répond. */
  if (estPour(RESEAU_DABORD, chemin)) {
    e.respondWith(
      (async () => {
        const cachette = await caches.open(VERSION);
        try {
          const reponse = await fetch(req);
          if (reponse && reponse.ok && req.destination !== 'document') cachette.put(req, reponse.clone()).catch(() => {});
          if (reponse && reponse.ok && req.destination === 'document') cachette.put(new Request(url.pathname), reponse.clone()).then(() => ranger(cachette)).catch(() => {});
          return reponse;
        } catch {
          const dansCache = (await cachette.match(req)) || (await cachette.match(new Request(url.pathname)));
          if (dansCache) return dansCache;
          if (req.destination === 'document') {
            const accueil = await cachette.match(new Request('/'));
            if (accueil) return accueil;
          }
          return new Response('<!DOCTYPE html><html lang="fr"><meta charset="utf-8"><title>Hors ligne</title><body style="font:16px system-ui;padding:32px"><h1>Pas de connexion</h1><p>Le catalogue était chargé : rallume ta data et réessaie. Pour commander tout de suite : WhatsApp 77 000 00 00.</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })()
    );
  }
});
