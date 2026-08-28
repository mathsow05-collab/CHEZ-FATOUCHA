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
    vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) erreurs.push(e.message); });
    vc.on('error', (...a) => erreurs.push(a.join(' ')));
    vc.on('warn', () => {});

    /* jsdom n'a pas de fetch : on branche celui de Node, en résolvant les URLs relatives. */
    const brancher = (window) => {
      window.fetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, BASE + '/').toString(), init);
      for (const k of ['Response', 'Request', 'Headers', 'FormData', 'Blob', 'File']) if (globalThis[k]) window[k] = globalThis[k];
      window.scrollTo = () => {};
    };
    const opts = { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc };
    dom = await JSDOM.fromURL(BASE + '/#/', { ...opts, beforeParse: (window) => { brancher(window); if (jetonAdmin) window.localStorage.setItem('fatoucha_admin_token', jetonAdmin); } });
    const w = dom.window;
    w.scrollTo = () => {};
    check('page chargée sans erreur JS', erreurs.length === 0, '\n     ' + erreurs.slice(0, 3).join('\n     '));

    await until(() => w.document.querySelectorAll('.card').length > 0, { label: 'cartes produits' });
    const d = w.document;
    check('hero + nom de la boutique affichés', /CHEZ FATOUCHA/.test(d.body.textContent));
    check('cartes produits rendues (= nb en base)', d.querySelectorAll('.card').length === (await (await fetch(BASE + '/api/produits')).json()).length, `(${d.querySelectorAll('.card').length})`);
    check('prix en FCFA sur les cartes', /\d{1,3}\s?\d{3}\s?F/.test(d.querySelector('.card .price').textContent), d.querySelector('.card .price')?.textContent);
    check('délai estimé sur la carte', /~\d+ jour/.test(d.querySelector('.card .mini').textContent), d.querySelector('.card .mini')?.textContent);
    check('catégories affichées', d.querySelectorAll('.cat').length >= 7, `(${d.querySelectorAll('.cat').length})`);
    check('bandeau livraison + paiement', /Livraison/.test(d.querySelector('.marquee').textContent) && /Orange Money/.test(d.body.textContent));

    /* --- fiche produit : tailles, stock, quantités --- */
    w.location.hash = '#/produit/1';
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

    /* --- panier --- */
    d.querySelector('[data-buy]').click();
    await wait(120);
    check('badge du panier mis à jour', d.querySelector('[data-cart-count]').textContent === String(Math.min(20, stockM)), d.querySelector('[data-cart-count]').textContent);
    w.location.hash = '#/panier';
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
    w.location.hash = '#/commande';
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
    check('le front bloque un numéro invalide', d.getElementById('toast-root').children.length > 0 && !/paiement/.test(d.location.hash));
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
      await until(() => /#\/paiement\//.test(d.location.hash), { label: 'page de paiement', tries: process.env.DEBUG_SUBMIT ? 20 : 60 });
    } catch (e) {
      console.log('   toasts:', d.getElementById('toast-root').textContent, '| hash:', d.location.hash);
      throw e;
    }
    check('→ redirection vers la page de paiement', /#\/paiement\/CMD-/.test(d.location.hash), d.location.hash);
    const ref = d.location.hash.split('/')[2];

    /* --- paiement manuel : numéro Wave + copie + preuve WhatsApp --- */
    await until(() => d.querySelector('.copy .num'), { label: 'bloc de paiement manuel' });
    check('montant à payer affiché', plat(d.querySelector('.pay-hero').textContent).includes(frc(prod1.prix * qteFinale + zero.frais)), plat(d.querySelector('.pay-hero').textContent));
    check('numéro Wave de la boutique affiché', /77 000 00 00/.test(d.querySelector('.copy .num').textContent), d.querySelector('.copy .num').textContent);
    check('étapes 1-2-3-4 fournies au client', d.querySelectorAll('.steps div').length === 4);
    check('lien WhatsApp de preuve présent', /wa\.me/.test(d.querySelector('[href*="wa.me"]')?.href || ''));
    check('référence rappelée dans le message WhatsApp', encodeURIComponent(ref).length > 0 && /CMD/.test(decodeURIComponent(d.querySelector('[href*="wa.me"]').href)));

    /* --- suivi client --- */
    w.location.hash = '#/commande/' + ref + '?tel=771234567';
    await until(() => d.querySelector('.tl'), { label: 'timeline de suivi' });
    check('suivi : timeline 5 étapes', d.querySelectorAll('.tl .st').length === 5);
    check('suivi : alerte paiement en attente', /en attente/i.test(d.body.textContent));
    check('suivi : rappel de l’article commandé', d.body.textContent.includes(prod1.titre));

    /* --- l'espace vendeur est privé : la cliente ne doit rien en voir --- */
    check('boutique : aucun lien « Espace vendeur » dans l’écran', !/Espace vendeur/.test(d.body.textContent));
    check('boutique : aucun lien, même caché, vers le back-office', !d.querySelector('a[href*="admin"]'));
    check('boutique : le HTML reçu ne contient ni chrome ni code du back-office', !/adm-root|adm-tabs|adm-login/.test(d.documentElement.outerHTML));
    w.location.hash = '#/admin';
    await wait(250);
    check('ancienne route #/admin : la boutique s’affiche, jamais le back-office', d.querySelectorAll('.card').length > 0 && !d.querySelector('.adm-tabs'));
    w.location.hash = '#/';
    await until(() => d.querySelectorAll('.card').length > 0, { label: 'retour catalogue' });

    /* --- espace vendeur : page séparée /admin, ouverte dans sa propre fenêtre --- */
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
    check('admin : statut “en attente” de paiement', /⏳ wave|en attente/.test(da.querySelector('#admin-body').textContent));
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
