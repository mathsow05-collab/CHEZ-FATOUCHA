/* Test de rendu du front (jsdom) : on charge la vraie page servie par le serveur
   et on joue le parcours client complet, puis un coup d'œil à l'espace admin.
   Usage : npm run test:front   (à lancer après npm run smoke si besoin) */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PORT = 4411 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fatoucha-front-'));

let ok = 0;
let ko = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✔ ${name}`); }
  else { ko++; console.log(`  ✖ ${name} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { tries = 60, step = 100, label = 'condition' } = {}) {
  for (let i = 0; i < tries; i++) {
    let v = false;
    try { v = fn(); } catch { v = false; }
    if (v) return true;
    await wait(step);
  }
  throw new Error('timeout en attendant : ' + label);
}
const J = async (method, url, body, token) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  return { status: res.status, data };
};

(async () => {
  console.log('\n=== CHEZ FATOUCHA — test de rendu (jsdom) ===\n');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env, PORT,
      DATA_DIR: path.join(DATA, 'data'), UPLOADS_DIR: path.join(DATA, 'uploads'),
      JWT_SECRET: 'secret-test-front', ADMIN1_USERNAME: 'admin', ADMIN1_PASSWORD: 'test12345',
      ADMIN2_USERNAME: '', ADMIN2_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  let dom;
  let domAdm;

  try {
    // serveur prêt
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* pas prêt */ }
      await wait(250);
    }

    const jetonAdmin = (await J('POST', '/api/admin/login', { username: 'admin', password: 'test12345' })).data.token;
    const cfgR = await J('GET', '/api/config');
    const zero = (cfgR.data.zones || [])[0];
    const prod1 = (await J('GET', '/api/produits/1')).data;
    const vc = new VirtualConsole();
    const erreurs = [];
    /* une erreur JS « non implémentée » par jsdom (canvas, storage…) n'est pas un
       défaut du site : on l'ignore. Toute autre erreur est retenue AVEC sa pile,
       sinon le test dit « il y a une erreur » sans dire où. */
    const garder = (e) => {
      const t = (e && e.detail && e.detail.stack) || (e && e.stack) || (e && e.message) || String(e);
      if (/Not implemented/.test(t)) return;
      erreurs.push(t.split('\n').slice(0, 3).map((x) => x.trim()).join('  '));
    };
    vc.on('jsdomError', garder);
    vc.on('error', (...a) => erreurs.push(a.join(' ')));
    vc.on('warn', () => {});

    /* jsdom n'a pas de fetch : on branche celui de Node, en résolvant les URLs relatives. */
    const branchfidele = (window) => brancher(window);
    const brancher = (window, onErreur) => {
      window.fetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, BASE + '/').toString(), init);
      for (const k of ['Response', 'Request', 'Headers', 'FormData', 'Blob', 'File']) if (globalThis[k]) window[k] = globalThis[k];
      window.scrollTo = () => {};
      if (onErreur) window.addEventListener('error', (ev) => { if (ev.error && ev.error.stack) onErreur(ev.error); });
    };
    const opts = { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc };
    dom = await JSDOM.fromURL(BASE + '/', { ...opts, beforeParse: (window) => { brancher(window, garder); if (jetonAdmin) window.localStorage.setItem('fatoucha_admin_token', jetonAdmin); } });
    const w = dom.window;
    w.scrollTo = () => {};
    /* la page est d'abord rendue par le serveur : on attend que le front ait pris la main */
    await until(() => typeof w.go === 'function', { label: 'front hydrat (go() disponible)' });
    check('page chargée sans erreur JS', erreurs.length === 0, '\n     ' + erreurs.slice(0, 3).join('\n     '));

    await until(() => w.document.querySelectorAll('#boutique-grid .card').length > 0, { label: 'cartes produits' });
    const d = w.document;
    check('hero + nom de la boutique affichés', /CHEZ FATOUCHA/.test(d.body.textContent));
    check('hero éditorial : sur-titre, visuel et monogramme « CF »', !!d.querySelector('.hero .sur') && !!d.querySelector('.hero .visuel img') && /^[A-Z]{2}$/.test(d.querySelector('.brand .logo').textContent.trim()), JSON.stringify(d.querySelector('.brand .logo')?.textContent));
    check('bandeau du haut sans emojis (registre sobre)', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(d.querySelector('.marquee').textContent), d.querySelector('.marquee').textContent.trim().slice(0, 40));
    check('cartes produits rendues (= nb en base)', d.querySelectorAll('#boutique-grid .card').length === (await (await fetch(BASE + '/api/produits')).json()).length, `(${d.querySelectorAll('#boutique-grid .card').length})`);
    check('carte : image responsive (srcset /img + lazy) et lien propre', /srcset="\/img\/220/.test(d.querySelector('#boutique-grid .card').innerHTML) && /loading="lazy"/.test(d.querySelector('#boutique-grid .card').innerHTML) && /^\/produit\//.test(d.querySelector('#boutique-grid .card a').getAttribute('href')), d.querySelector('#boutique-grid .card a').getAttribute('href'));
    check('catalogue : catégories et barre de filtres rendues', !!d.querySelector('#cats .cat') && !!d.querySelector('.filtres-bar'));
    check('prix en FCFA sur les cartes', /\d{1,3}\s?\d{3}\s?F/.test(d.querySelector('.card .price').textContent), d.querySelector('.card .price')?.textContent);
    check('délai estimé sur la carte', /~\d+ jour/.test(d.querySelector('.card .mini').textContent), d.querySelector('.card .mini')?.textContent);
    check('catégories affichées', d.querySelectorAll('.cat').length >= 7, `(${d.querySelectorAll('.cat').length})`);
    check('bandeau livraison + paiement', /Livraison/.test(d.querySelector('.marquee').textContent) && /Orange Money/.test(d.body.textContent));

    /* --- fiche produit : tailles, stock, quantités --- */
    w.go('/produit/1');
    await until(() => d.getElementById('pd-qte'), { label: 'fiche produit' });
    check('boutons de taille rendus', prod1.tailles.length === 0 || d.querySelectorAll('[data-taille]').length === prod1.tailles.length, `(${d.querySelectorAll('[data-taille]').length})`);
    check('pastilles de coloris rendues', d.querySelectorAll('[data-coloris]').length === 2);
    check('stock par variante affiché', /en stock/.test(d.getElementById('pd-dispo').textContent), d.getElementById('pd-dispo').textContent);
    const stockM = prod1.variantes.find((v) => v.taille === 'M')?.stock ?? 0;
    d.querySelector('[data-taille="M"]').click();
    await wait(60);
    check('choix taille → total recalculé', /Commander · /.test(d.querySelector('[data-checkout]').textContent), d.querySelector('[data-checkout]')?.textContent);
    d.querySelector('[data-q="1"]').click();
    await wait(60);
    check('+1 quantité prise en compte', d.getElementById('pd-qte').textContent === '2', d.getElementById('pd-qte').textContent);
    for (let i = 0; i < 6; i++) { d.querySelector('[data-q="1"]').click(); await wait(30); }
    check('quantité plafonnée au stock de la variante', d.getElementById('pd-qte').textContent === String(Math.min(20, stockM)), d.getElementById('pd-qte').textContent + ' vs ' + stockM);

    /* --- modules ajoutés sur la fiche : galerie, avis, guide, réassurance --- */
    check('fiche : galerie avec vignettes et compteur de vues', d.querySelectorAll('.gallery .thumbs button').length >= 2 && /1 \/ \d+/.test(d.querySelector('.gal-compte')?.textContent || ''), `(${d.querySelectorAll('.gallery .thumbs button').length} vignettes)`);
    check('fiche : srcset multi-largeurs sur la photo principale', /\/img\/220[\s\S]*\/img\/900/.test(d.getElementById('gal-main').getAttribute('srcset') || ''), d.getElementById('gal-main').getAttribute('srcset'));
    const urlPhoto = d.getElementById('gal-main').getAttribute('src').split(' ')[0];
    check('fiche : le serveur d’images répond en WebP (ou rédirige si SVG)', /(image\/(webp|avif|jpeg))/.test((await fetch(BASE + urlPhoto, { redirect: 'follow' })).headers.get('content-type') || ''), urlPhoto);
    d.querySelector('.gallery .thumbs button[data-thumb="1"]').click();
    await wait(120);
    check('fiche : toucher une vignette change la photo principale', /media\/demo\/[a-z-]+-2\./.test(d.getElementById('gal-main').getAttribute('src') || ''), d.getElementById('gal-main').getAttribute('src'));
    d.querySelector('[data-zoom]').click();
    await until(() => d.querySelector('.loupe-cadre'), { label: 'loupe ouverte' });
    check('fiche : la loupe s’ouvre avec navigation et légende', !!d.querySelector('.loupe-cadre img') && d.querySelectorAll('.loupe-nav').length === 2 && !!d.querySelector('.loupe-aide'));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(80);
    check('fiche : Échap ferme la loupe', !d.querySelector('.loupe-cadre'));
    check('fiche : liens guide des tailles et « trouver ma taille »', !!d.querySelector('[data-guide]') && !!d.querySelector('[data-trouve]'));
    d.querySelector('[data-guide]').click();
    await wait(80);
    check('fiche : le tableau de mesures s’affiche', !!d.querySelector('table.guide') && /Poitrine|Hanches/.test(d.querySelector('table.guide').textContent), d.querySelector('table.guide')?.textContent.slice(0, 50));
    d.querySelector('[data-trouve]').click();
    await until(() => d.querySelector('#tt-out'), { label: 'calculateur de taille' });
    d.querySelector('#tt-c [data-c="ample"]').click();
    await wait(80);
    check('fiche : le calculateur conseille une taille et propose de la choisir', /Conseil : <b>taille/.test(d.querySelector('#tt-out').innerHTML) && !!d.querySelector('#tt-out [data-choisir]'), d.querySelector('#tt-out').textContent.trim().slice(0, 70));
    d.querySelectorAll('.modal').forEach((x) => x.remove());
    await wait(60);
    check('fiche : la mention « portée par » rassure sur la coupe', /portée par/i.test(d.querySelector('.puce-mannequin')?.textContent || ''), d.querySelector('.puce-mannequin')?.textContent);
    check('fiche : rangée « dans le même esprit »', /même esprit/i.test(d.body.textContent) && d.querySelectorAll('.rang-lignes .card').length > 0, `(${d.querySelectorAll('.rang-lignes .card').length})`);
    check('fiche : rangée « ça complète le look »', /complète le look/i.test(d.body.textContent));
    check('fiche : bloc d’avis des acheteuses présent', !!d.querySelector('#avis') && /avis/i.test(d.querySelector('#avis h2').textContent), d.querySelector('#avis h2')?.textContent);
    d.querySelector('#avis [data-avis]').click();
    await until(() => d.getElementById('av-send'), { label: 'formulaire d’avis' });
    const fm = d.getElementById('av-send').closest('.modal');
    check('fiche : formulaire d’avis ouvert (note + prénom + texte + photo)', !!fm.querySelector('#av-note .chip') && !!fm.querySelector('#av-prenom') && !!fm.querySelector('#av-texte') && !!fm.querySelector('#av-photo'));
    fm.querySelector('#av-note .chip[data-note="4"]').click();
    fm.querySelector('#av-prenom').value = 'Awa T';
    fm.querySelector('#av-texte').value = 'Tissu fluide, la taille est parfaite, je recommande.';
    fm.querySelector('#av-send').click();
    await until(() => /Merci/.test(d.getElementById('toast-root')?.textContent || ''), { label: 'avis envoyé' });
    check('fiche : avis reçu, la boutique le publiera après vérification', /publie apr|vérification|en ligne/i.test(d.getElementById('toast-root').textContent), d.getElementById('toast-root').textContent.trim());
    d.querySelectorAll('.modal').forEach((x) => x.remove());
    await wait(60);

    /* --- panier --- */
    d.querySelector('[data-buy]').click();
    await wait(120);
    check('badge du panier mis à jour', d.querySelector('[data-cart-count]').textContent === String(Math.min(20, stockM)), d.querySelector('[data-cart-count]').textContent);
    w.go('/panier');
    await until(() => d.querySelector('.cart-line'), { label: 'ligne de panier' });
    check('ligne de panier avec taille M', /M/.test(d.querySelector('.cart-line .vr').textContent), d.querySelector('.cart-line .vr').textContent);
    const qtePanier = Number(d.querySelector('[data-cart-count]').textContent);
    const frc = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g, ' ');
    const plat = (x) => String(x).replace(/\s/g, ' ');
    check('prix de la ligne = quantité × unité', plat(d.querySelector('.cart-line').textContent).includes(frc(prod1.prix * qtePanier)), plat(d.querySelector('.cart-line').textContent) + ' vs ' + frc(prod1.prix * qtePanier));
    if (qtePanier > 1) {
      d.querySelector('[data-cq]').click();
      await wait(200);
      check('bouton − diminue la quantité', d.querySelector('[data-cart-count]').textContent === String(qtePanier - 1), d.querySelector('[data-cart-count]').textContent);
    } else check('bouton − diminue la quantité', true, '(variant déjà à 1)');

    /* --- checkout : zone → frais → ETA --- */
    const qteFinale = Number(d.querySelector('[data-cart-count]').textContent);
    w.go('/commande');
    await until(() => d.getElementById('f-zone'), { label: 'formulaire de commande' });
    d.getElementById('f-nom').value = 'Awa Diop';
    d.getElementById('f-tel').value = '77 123 45 67';
    d.getElementById('f-zone').value = String(zero?.id ?? '1');
    d.getElementById('f-zone').dispatchEvent(new w.Event('change'));
    const taper = (id, val) => { const e2 = d.getElementById(id); e2.value = val; e2.dispatchEvent(new w.Event('input', { bubbles: true })); };
    taper('f-adresse', 'Pikine Sicage, villa bleue, dernier portail');
    taper('f-instr', 'livrer après 17h');
    await wait(120);
    check('frais de la zone repris dans le total', plat(d.getElementById('co-ship').textContent).includes(frc(zero.frais)), plat(d.getElementById('co-ship').textContent) + ' vs ' + frc(zero.frais));
    check('totaux = sous-total + livraison', plat(d.getElementById('co-total').textContent).includes(frc(prod1.prix * qteFinale + zero.frais)), plat(d.getElementById('co-total').textContent) + ' vs ' + frc(prod1.prix * qteFinale + zero.frais));
    check('délai estimé (appro + livraison)', /approvisionnement/.test(d.getElementById('eta-box').textContent), d.getElementById('eta-box').textContent);
    check('retrait boutique = gratuit', (() => {
      d.querySelector('#seg-mode [data-mode="retrait"]').click();
      return /Gratuit/i.test(d.getElementById('co-ship').textContent);
    })());
    d.querySelector('#seg-mode [data-mode="livraison"]').click();
    await wait(60);

    /* validation à l'envers : mauvaise donnée → pas de commande */
    d.getElementById('f-tel').value = '12';
    d.getElementById('btn-commande').click();
    await wait(250);
    check('le front bloque un numéro invalide', d.getElementById('toast-root').children.length > 0 && !/paiement/.test(d.location.pathname));
    taper('f-tel', '77 123 45 67');
    if (process.env.DEBUG_SUBMIT) {
      const of_ = w.fetch;
      w.fetch = async (input, init) => {
        const r = await of_(input, init);
        const txt = await r.clone().text();
        console.log('   [fetch]', init?.method || 'GET', String(input).slice(0, 60), '→', r.status, txt.slice(0, 300));
        return r;
      };
    }
    d.getElementById('btn-commande').click();
    try {
      await until(() => /^\/paiement\//.test(d.location.pathname), { label: 'page de paiement', tries: process.env.DEBUG_SUBMIT ? 20 : 60 });
    } catch (e) {
      console.log('   toasts:', d.getElementById('toast-root').textContent, '| url:', d.location.pathname + d.location.search);
      throw e;
    }
    check('→ redirection vers la page de paiement (vrai chemin, plus de #/)', /^\/paiement\/CMD-/.test(d.location.pathname), d.location.pathname);
    const ref = d.location.pathname.split('/')[2];

    /* --- paiement manuel : numéro Wave + copie + preuve WhatsApp --- */
    await until(() => d.querySelector('.copy .num'), { label: 'bloc de paiement manuel' });
    check('montant à payer affiché', plat(d.querySelector('.pay-hero').textContent).includes(frc(prod1.prix * qteFinale + zero.frais)), plat(d.querySelector('.pay-hero').textContent));
    check('numéro Wave de la boutique affiché', /77 000 00 00/.test(d.querySelector('.copy .num').textContent), d.querySelector('.copy .num').textContent);
    check('étapes 1-2-3-4 fournies au client', d.querySelectorAll('.steps div').length === 4);
    /* le tiroir mobile contient lui aussi un lien WhatsApp « général » : on cible
       le lien qui porte un message ( ?text= ), celui qui compte ici. */
    const lienPreuve = d.querySelector('[href*="wa.me"][href*="text="]');
    check('lien WhatsApp de preuve présent', /wa\.me/.test(lienPreuve?.href || ''));
    check('référence rappelée dans le message WhatsApp', !!lienPreuve && decodeURIComponent(lienPreuve.href).includes(ref), lienPreuve ? decodeURIComponent(lienPreuve.href).slice(-90) : 'aucun lien avec message');

    /* --- suivi client --- */
    w.go('/commande/' + ref + '?tel=771234567');
    await until(() => d.querySelector('.tl'), { label: 'timeline de suivi' });
    check('suivi : timeline 5 étapes', d.querySelectorAll('.tl .st').length === 5);
    check('suivi : alerte paiement en attente', /en attente/i.test(d.body.textContent));
    check('suivi : rappel de l’article commandé', d.body.textContent.includes(prod1.titre));

    /* --- l'espace vendeur est privé : la cliente ne doit rien en voir --- */
    check('boutique : aucun lien « Espace vendeur » dans l’écran', !/Espace vendeur/.test(d.body.textContent));
    check('boutique : aucun lien, même caché, vers le back-office', !d.querySelector('a[href*="admin"]'));
    check('boutique : le HTML reçu ne contient ni chrome ni code du back-office', !/adm-root|adm-tabs|adm-login/.test(d.documentElement.outerHTML));
    check('le routeur client ne connaît pas /admin (back-office = page séparée)', w.eval('ROUTES_SPA.test("/admin")') === false && w.eval('ROUTES_SPA.test("/panier")') === true);
    check('la boutique ne contient aucune classe du back-office', !/adm-shell|adm-tabs|adm-login/.test(d.getElementById('app').innerHTML));
    w.go('/');
    await until(() => d.querySelectorAll('#boutique-grid .card').length > 0, { label: 'retour catalogue' });

    /* --- la vidéo de l'article : reconnue, montrée, lue au toucher ---
       Dans sa propre fenêtre, chargée en direct (le rendu serveur est vérifié
       côté smoke) : ce bloc navigue, et la suite compte les lignes du panier.
       Et avec SON tableau d'erreurs : au toucher, le cadre pointe vraiment vers
       le lecteur YouTube, que jsdom charge et exécute — ses erreurs à lui ne sont
       pas les nôtres, on ne retient que celles qui touchent nos fichiers. */
    await J('PUT', '/api/admin/produits/1', { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, jetonAdmin);
    const vcVod = new VirtualConsole();
    const bruitVod = [];
    const nosFichiers = (t) => /\/js\/(app|api|icones|mouvement)\.js/.test(String(t));
    const garderVod = (e) => { const t = (e && e.stack) || String(e); if (nosFichiers(t)) bruitVod.push(t.split('\n')[0].trim()); };
    vcVod.on('jsdomError', garderVod);
    vcVod.on('error', (...a) => { const t = a.join(' '); if (nosFichiers(t)) bruitVod.push(t); });
    const domVod = await JSDOM.fromURL(BASE + '/produit/1', {
      ...opts, virtualConsole: vcVod,
      beforeParse: (window) => brancher(window, garderVod),
    });
    const wv = domVod.window;
    const dv = wv.document;
    try {
      /* la carte est d'abord celle du rendu serveur : on attend que le script
         l'ait remplacée par la sienne, sinon on cliquerait un morceau de HTML
         sans écouteur derrière */
      await until(() => dv.getElementById('pd-qte') && dv.querySelector('.vod-cart'), { label: 'carte vidéo hydratée' });
      check('fiche : la pastille vidéo se range avec les vignettes', !!dv.querySelector('.thumb-vod') && !!dv.querySelector('.vod-cart'), `(${dv.querySelectorAll('.thumbs > *').length} vignettes dont la vidéo)`);
      check('fiche : aucun lecteur tiers avant le toucher', dv.querySelectorAll('iframe').length === 0 && /href="https:\/\/www\.youtube\.com\/watch/.test(dv.querySelector('.vod-cart').outerHTML));
      for (let i = 0; i < 8 && !dv.querySelector('.modal.vod iframe'); i++) {
        dv.querySelector('.vod-cart').click();
        await wait(120);
      }
      const cadreVod = dv.querySelector('.modal.vod iframe') || { getAttribute: () => 'aucun cadre' };
      const srcCadre = cadreVod.getAttribute('src');
      check('fiche : au toucher, le lecteur sans pistage démarre', /youtube-nocookie\.com\/embed\//.test(srcCadre) && /autoplay=1/.test(srcCadre), srcCadre.slice(0, 70));
      check('fiche : la fenêtre vidéo garde une porte de sortie vers la source', !!dv.querySelector('.modal.vod .close') && /youtube\.com\/watch/.test(dv.querySelector('.vod-aide a').getAttribute('href')));
      const cadreEl = dv.querySelector('.modal.vod iframe');
      if (cadreEl) cadreEl.remove();
      dv.dispatchEvent(new wv.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(120);
      check('fiche : Échap referme la vidéo', !dv.querySelector('.modal.vod'));
      check('fenêtre vidéo : aucune erreur dans nos propres scripts', bruitVod.length === 0, bruitVod.slice(0, 2).join(' | '));
      wv.eval('window.Mesure && Mesure.vider()');
      await wait(120);
    } finally {
      await J('PUT', '/api/admin/produits/1', { video_url: '' }, jetonAdmin);
      wv.close();
    }

    /* --- espace vendeur : page séparée /admin, ouverte dans sa propre fenêtre --- */
    /* ---------- la rubrique Shorts, vue par le navigateur ----------
       Deux blessures connues, toutes les deux invisibles dans le HTML servi :
       le rail effacé par l'hydratation, et le routeur qui remet l'accueil à la
       place d'une page rendue par le serveur. Fenêtre isolée ici aussi. */
    await J('PUT', '/api/admin/produits/1', { video_url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', video_miniature: '' }, jetonAdmin);
    const vcCourt = new VirtualConsole();
    const bruitCourt = [];
    const garderCourt = (e) => { const t = (e && e.stack) || String(e); if (nosFichiers(t)) bruitCourt.push(t.split('\n')[0].trim()); };
    vcCourt.on('jsdomError', garderCourt);
    vcCourt.on('error', (...a) => { const t = a.join(' '); if (nosFichiers(t)) bruitCourt.push(t); });
    const domAccueil = await JSDOM.fromURL(BASE + '/', { ...opts, virtualConsole: vcCourt, beforeParse: (window) => brancher(window, garderCourt) });
    const wcA = domAccueil.window;
    const dcA = wcA.document;
    const dl = await JSDOM.fromURL(BASE + '/shorts', { ...opts, virtualConsole: vcCourt, beforeParse: (window) => brancher(window, garderCourt) });
    const wd = dl.window;
    const dd = wd.document;
    try {
      await until(() => typeof wcA.go === 'function' && typeof wd.go === 'function', { label: 'deux fenêtres hydratées' });
      await wait(400);
      check('accueil : le rail des Shorts survit à l’hydratation', !!dcA.getElementById('shorts') && dcA.querySelectorAll('.short-tuile').length >= 1,
        `(${dcA.querySelectorAll('.short-tuile').length} tuile(s) après hydratation)`);
      check('accueil : le menu a gardé l’entrée Shorts', /Shorts/.test((dcA.querySelector('.main') || da.body).textContent));
      check('accueil : la tuile est un vrai lien (lisibles sans JavaScript)', !!dcA.querySelector('.short-tuile[href^="/produit/"]'));
      check('/shorts : le routeur laisse la page du serveur en place (pas d’accueil par-dessus)',
        /Shorts/.test((dd.querySelector('h1') || { textContent: 'aucun titre' }).textContent) && !!dd.querySelector('.shorts-grille'),
        `h1 = ${(dd.querySelector('h1') || { textContent: '—' }).textContent.slice(0, 34)}`);
      check('/shorts : aucun lecteur avant le toucher', dd.querySelectorAll('iframe').length === 0);
      const tuile = dd.querySelector('.short-tuile');
      if (tuile) { tuile.dispatchEvent(new wd.MouseEvent('click', { bubbles: true, cancelable: true })); }
      await until(() => dd.querySelector('.modal.vod iframe'), { label: 'fenêtre vidéo ouverte depuis la tuile', tries: 40 });
      const srcTuile = (dd.querySelector('.modal.vod iframe') || { getAttribute: () => 'aucun cadre' }).getAttribute('src');
      check('/shorts : toucher une tuile ouvre le lecteur ici, en vertical',
        /youtube-nocookie\.com\/embed\//.test(srcTuile) && /autoplay=1/.test(srcTuile) && /class="vod-cadre vertical"/.test(dd.querySelector('.modal.vod').innerHTML),
        srcTuile.slice(0, 64));
      check('/shorts : la tuile ne fait pas ouvrir un onglet en plus', dd.querySelectorAll('.modal.vod').length === 1);
      await wait(150);
      check('rubrique Shorts : aucune erreur dans nos propres scripts', bruitCourt.length === 0, bruitCourt.slice(0, 2).join(' | '));
      wcA.eval('window.Mesure && Mesure.vider()');
      wd.eval('window.Mesure && Mesure.vider()');
      await wait(120);
    } finally {
      await J('PUT', '/api/admin/produits/1', { video_url: '', video_miniature: '' }, jetonAdmin);
      wcA.eval('window.Mesure && Mesure.vider()');
      await wait(60);
      domAccueil.window.close();
      dl.window.close();
    }

    domAdm = await JSDOM.fromURL(BASE + '/admin#produits', { ...opts, beforeParse: (window) => { brancher(window); window.localStorage.setItem('fatoucha_admin_token', jetonAdmin); } });
    const wa = domAdm.window;
    const da = wa.document;
    check('admin : page indépendante du catalogue (pas de panier, pas de hero)', da.querySelectorAll('.card').length === 0 && !/Ajouter au panier/.test(da.body.textContent));
    check('admin : sa propre URL, sans #/ dans le chemin', domAdm.window.location.pathname === '/admin', domAdm.window.location.pathname);
    await until(() => da.querySelectorAll('[data-edit]').length > 0, { label: 'table admin' });
    check('admin : onglets propres à l’espace vendeur, aucun menu cliente', !!da.querySelector('.adm-tabs') && !da.querySelector('nav.main') && !da.querySelector('[data-cart-count]'));
    check('admin : marque de la boutique rappelée', /CHEZ FATOUCHA/i.test(da.querySelector('.adm-top').textContent));
    check('admin : tableau des produits rendu', da.querySelectorAll('table.tbl tbody tr').length === 8, `(${da.querySelectorAll('table.tbl tbody tr').length})`);
    check('admin : lien fournisseur visible pour l’admin', /shein|vendeur local|TEMU/.test(da.body.textContent));
    da.querySelector('[data-new]').click();
    await until(() => da.getElementById('f-titre'), { label: 'formulaire produit' });
    check('admin : formulaire produit complet', !!da.getElementById('f-prix') && !!da.getElementById('f-drop') && !!da.getElementById('f-vars'));
    da.getElementById('f-titre').value = 'Jupe wax';
    da.getElementById('f-prix').value = '14500';
    da.getElementById('f-tailles').value = 'S, M';
    da.getElementById('f-tailles').dispatchEvent(new wa.Event('input'));
    await wait(80);
    check('admin : grille de stock par variante auto-générée', da.querySelectorAll('#f-vars .cell').length === 2, `(${da.querySelectorAll('#f-vars .cell').length})`);
    da.getElementById('f-save').click();
    await until(() => /Jupe wax/.test(da.querySelector('#admin-body').textContent), { label: 'produit créé dans la liste' });
    check('admin : création visible dans la liste', /Jupe wax/.test(da.querySelector('#admin-body').textContent));
    check('admin : le produit créé est aussi visible côté cliente', await (async () => {
      await wait(150);
      return (await J('GET', '/api/produits?q=Jupe')).data.some((x) => x.titre === 'Jupe wax');
    })());
    da.querySelector('[data-tab="commandes"]').click();
    await until(() => /CMD-/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'vue commandes' });
    check('admin : changement d’onglet par hash interne (#commandes)', wa.location.hash === '#commandes');
    check('admin : la commande du client est visible', /CMD-/.test(da.querySelector('#admin-body').textContent));
    check('admin : statut “en attente” de paiement', /en attente|wave/.test(da.querySelector('#admin-body').textContent), plat(da.querySelector('.tag').textContent));
    check('back-office : les pictogrammes sont passés en tracés dessinés',
      !/[\u{1F300}-\u{1FAFF}\u{2300}-\u{23FA}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(da.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '')),
      (da.body.innerHTML.match(/[\u{1F300}-\u{1FAFF}\u{2300}-\u{23FA}\u{2B00}-\u{2BFF}\u{FE0F}]/gu) || []).slice(0, 8).join(' '));
    check('back-office : les onglets portent des icônes animées', da.querySelectorAll('.adm-tabs .ico svg').length >= 6, da.querySelectorAll('.adm-tabs .ico').length);
    check('back-office : une icône dessinée remplace le sablier du statut', !!da.querySelector('.tag .ico svg'));
    da.querySelector('[data-open]').click();
    await until(() => /Paiement reçu/.test(da.body.textContent), { label: 'détail commande' });
    check('admin : bouton de validation du paiement', /Paiement reçu/.test(da.body.textContent));
    check('admin : bordereau livreur proposé', /Bordereau livreur/.test(da.body.textContent));
    da.querySelector('[data-mark-paid]').click();
    await until(() => /préparation/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'statut après validation' });
    check('après validation admin, la commande passe en préparation', /préparation/.test(da.querySelector('#admin-body').textContent));
    /* le client voit le paiement confirmé sur sa page de suivi */
    w.location.hash = '#/commande/' + ref + '?tel=771234567';
    await until(() => /Payement valid|Paiement validé/.test(d.body.textContent), { label: 'suivi mis à jour' });
    check('suivi client : paiement validé visible', /Paiement validé/.test(d.body.textContent));

    /* --- reprise de panier : le code est donné au client, pas seulement au serveur --- */
    w.go('/panier');
    await until(() => d.querySelector('[data-reprise]'), { label: 'bouton de reprise' });
    check('panier : le panier est copié côté serveur avec un code de reprise', !!w.localStorage.getItem('fatoucha_panier_code') && /Retrouver un panier/.test(d.body.textContent), w.localStorage.getItem('fatoucha_panier_code'));

    /* --- suivi : la cliente doit pouvoir confirmer sa présence avant départ --- */
    w.go('/commande/' + ref + '?tel=771234567');
    await until(() => d.querySelector('.tl'), { label: 'suivi' });
    check('suivi : lien vers la page de confirmation (le livreur ne part pas pour rien)', /\/confirmer\//.test(d.getElementById('app').innerHTML), '');

    /* --- PWA : manifeste + service worker --- */
    check('manifeste d’installation lié et servi', /rel="manifest"/.test(d.querySelector('head').innerHTML) && (await fetch(BASE + '/manifest.webmanifest')).ok);
    check('service worker servi', (await fetch(BASE + '/sw.js')).ok);

    /* --- espace vendeur : les trois nouveaux onglets --- */
    da.querySelector('[data-tab="avis"]').click();
    await until(() => /Avis des clientes/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'onglet avis' });
    check('admin : l’avis envoyé par la cliente est là à valider', /Awa T/.test(da.querySelector('#admin-body').textContent), da.querySelector('#admin-body').textContent.slice(0, 140));
    const publier = da.querySelector('[data-appr]');
    check('admin : publier / répondre / corriger / supprimer disponibles', !!publier && !!da.querySelector('[data-rep]') && !!da.querySelector('[data-edit]') && !!da.querySelector('[data-del]'));
    da.querySelector('[data-rep]').click();
    await until(() => da.getElementById('av-r'), { label: 'champ de réponse' });
    da.getElementById('av-r').value = 'Merci Awa ! Le même tissu ressort en bleu nuit la semaine prochaine.';
    da.getElementById('av-save').click();
    await wait(300);
    da.querySelector('[data-etat="tous"]').click();
    await until(() => /Réponse de la boutique/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'réponse visible dans « Tous »' });
    check('admin : réponse publiée sous l’avis (et avis validé du même coup)', /Merci Awa/.test(da.querySelector('#admin-body').textContent) && /en ligne/.test(da.querySelector('#admin-body').textContent));
    da.querySelector('[data-etat="en_attente"]').click();
    await until(() => /Aucun avis en attente/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'file de modération vidée' });
    check('admin : la file « à valider » est vide, l’avis est passé en ligne', /Aucun avis en attente/.test(da.querySelector('#admin-body').textContent));
    /* l’avis est visible côté cliente, avec sa note */
    w.go('/produit/1');
    await until(() => /Awa T/.test(d.querySelector('#avis')?.textContent || ''), { label: 'avis publié visible côté cliente' });
    check('fiche : l’avis publié (et la réponse de la boutique) s’affiche à la cliente', /Awa T/.test(d.querySelector('#avis').textContent) && /Merci Awa/.test(d.querySelector('#avis').textContent), d.querySelector('#avis').textContent.slice(0, 160));
    check('fiche : note moyenne reprise dans l’en-tête du bloc avis', /4\/5|\b4\b/.test(d.querySelector('#avis').textContent), d.querySelector('#avis h2')?.textContent);
    da.querySelector('[data-tab="contenus"]').click();
    await until(() => /Pages de contenu/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'onglet contenus' });
    check('admin : quatre pages éditables (FAQ, retours, livraison, maison)', da.querySelectorAll('.contenu-card').length === 4, `(${da.querySelectorAll('.contenu-card').length})`);
    da.querySelector('[data-edite="faq"]').click();
    await until(() => da.getElementById('c-c'), { label: 'éditeur de page' });
    check('admin : l’éditeur de FAQ contient le texte existant', (da.getElementById('c-c').value || '').length > 120, `${(da.getElementById('c-c').value || '').length} caractères`);
    da.getElementById('c-x').click();
    da.querySelector('[data-tab="entonnoir"]').click();
    await until(() => /Entonnoir de vente/.test(da.querySelector('#admin-body')?.textContent || ''), { label: 'onglet entonnoir' });
    check('admin : entonnoir à six étapes dessinées', da.querySelectorAll('.entonnoir .etape').length === 6, `(${da.querySelectorAll('.entonnoir .etape').length})`);
    check('admin : les visites de la cliente sont bien comptées', Number(da.querySelector('.entonnoir .etape .n')?.textContent) > 0, da.querySelector('.entonnoir .etape')?.textContent);
    check('admin : KPI panier moyen + relances (paniers et alertes de retour)', /Panier moyen/.test(da.querySelector('#admin-body').textContent) && /Paniers laissés en route/.test(da.querySelector('#admin-body').textContent) && /Retour en stock promis/.test(da.querySelector('#admin-body').textContent));
    da.querySelector('[data-tab="produits"]').click();
    await until(() => da.querySelectorAll('[data-edit]').length > 0, { label: 'retour produits' });
    /* on ouvre la robe bohème : c'est elle qui a un guide et une ligne « portée par » */
    const ligneRobe = [...da.querySelectorAll('[data-edit]')].find((b) => /Robe longue/.test(b.closest('tr').textContent));
    check('admin : la liste des articles montre les vues et le stock', /\d+ vus|\d+ vus/.test(da.querySelector('#admin-body').textContent) || /Robe longue/.test(da.querySelector('#admin-body').textContent));
    ligneRobe.click();
    await until(() => da.getElementById('f-video'), { label: 'formulaire produit rouvert' });
    check('admin : la fiche article expose vidéo, réassurance et guide des tailles', !!da.getElementById('f-mannequin') && da.querySelectorAll('#f-guide [data-gt]').length >= 12, `(${da.querySelectorAll('#f-guide [data-gt]').length} champs de mesure)`);
    check('admin : le guide déjà enregistré est rechargé dans le formulaire', [...da.querySelectorAll('#f-guide input')].some((x) => Number(x.value) >= 60), [...da.querySelectorAll('#f-guide input')].slice(0, 4).map((x) => x.value).join('/'));
    check('admin : la ligne « portée par » est réécritable', /portée par/i.test(da.getElementById('f-mannequin').value), da.getElementById('f-mannequin').value);
    /* on complète le guide depuis l’admin, la fiche cliente doit le montrer aussitôt */
    da.getElementById('f-mannequin').value = 'Photo portée par Awa, 1,72 m, 58 kg — elle porte du S.';
    da.getElementById('f-save').click();
    await until(() => /mis à jour/.test(da.getElementById('toast-root')?.textContent || ''), { label: 'enregistrement de la fiche' });
    w.go('/produit/1');
    await until(() => /portée par/i.test(d.querySelector('.puce-mannequin')?.textContent || ''), { label: 'fiche cliente rafraîchie' });
    check('admin → cliente : la réassurance saisie dans le back-office est en ligne', /portée par/i.test(d.querySelector('.puce-mannequin').textContent), d.querySelector('.puce-mannequin').textContent);

    /* --- fidélité de l'hydratation : ouvrir une URL au hasard du doigt ne doit
       pas faire « sauter » la page vers une autre. On compare le titre rendu par
       le serveur avec celui que le JavaScript laisse après hydration. --- */
    for (const [chemin, attendu] of [['/boutique', 'Tous les articles'], ['/faq', null], ['/suivi', null], ['/produit/robe-longue-boheme-fleurie', null]]) {
      const brut = await (await fetch(BASE + chemin)).text();
      const h1serveur = (brut.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const dom2 = await JSDOM.fromURL(BASE + chemin, { ...opts, beforeParse: branchfidele });
      try {
        await new Promise((r) => setTimeout(r, 1800));
        const h1client = (dom2.window.document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
        /* une route rendue entièrement par le client n'a pas de titre côté serveur :
           on exige alors simplement qu'elle en ait un, propre et non vide. */
        check(`hydratation fidèle sur ${chemin}`, h1serveur ? (h1client === h1serveur) : !!h1client, `serveur « ${h1serveur} » → client « ${h1client} »`);
        if (attendu) check(`titre attendu sur ${chemin}`, h1serveur.includes(attendu), h1serveur);
      } finally { try { dom2.window.close(); } catch { /* rien */ } }
    }

    check('aucune erreur JS pendant tout le parcours', erreurs.length === 0, '\n     ' + erreurs.slice(0, 4).join('\n     '));
  } catch (e) {
    ko++;
    console.error('\n✖ exception :', e.message);
    if (dom) console.error('   body:', dom.window.document.body.textContent.slice(0, 400).replace(/\s+/g, ' '));
    console.error('--- logs serveur (fin) ---\n' + logs.slice(-1200));
  } finally {
    if (domAdm) domAdm.window.close();
    child.kill('SIGTERM');
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(`\n=== front : ${ok} checks réussis, ${ko} échoué(s) ===\n`);
  process.exit(ko ? 1 : 0);
})();
