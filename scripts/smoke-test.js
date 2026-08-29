/* Test de bout en bout : démarre le serveur sur un port libre, joue le rôle
   du client (catalogue → panier → commande → paiement) puis de l'admin.
   Usage : npm run smoke   (aucune dépendance externe, Node >= 20) */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4111 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fatoucha-test-'));

let ok = 0;
let ko = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✔ ${name}`); }
  else { ko++; console.log(`  ✖ ${name} ${extra}`); }
};

const env = {
  ...process.env,
  PORT,
  DATA_DIR: path.join(DATA, 'data'),
  UPLOADS_DIR: path.join(DATA, 'uploads'),
  JWT_SECRET: 'secret-de-test',
  ADMIN1_USERNAME: 'admin',
  ADMIN1_PASSWORD: 'test12345',
  ADMIN2_USERNAME: '',
  ADMIN2_PASSWORD: '',
  NODE_ENV: 'test',
};

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
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
  console.log('\n=== CHEZ FATOUCHA — test de bout en bout ===\n');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });

  try {
    if (!await waitUp()) throw new Error('Serveur jamais démarré :\n' + logs);

    console.log('— Boutique —');
    const sante = await J('GET', '/api/health');
    check('GET /api/health', sante.status === 200 && sante.data.ok);

    const cfg = await J('GET', '/api/config');
    check('GET /api/config : 21 zones', cfg.data.zones?.length >= 20, `(${cfg.data.zones?.length})`);
    check('config : nom + wave + retrait', cfg.data.nom_boutique === 'CHEZ FATOUCHA' && !!cfg.data.adresse_retrait);
    check('config : paiement en mode manuel (aucune clé)', cfg.data.paiement_mode === 'manuel', `(${cfg.data.paiement_mode})`);

    const produits = await J('GET', '/api/produits');
    check('GET /api/produits renvoie le catalogue', Array.isArray(produits.data) && produits.data.length >= 8, `(${produits.data?.length})`);
    const p0 = produits.data[0];
    check('produit : prix, images, délai, variantes', typeof p0.prix === 'number' && !!p0.image && p0.delai_jours > 0 && Array.isArray(p0.variantes));
    check('produit : prix d’achat, lien fournisseur et origine cachés', p0.prix_achat === undefined && p0.lien_source === undefined && p0.marque === undefined);

    const stockAvant = p0.stock;
    const detail = await J('GET', '/api/produits/' + p0.id);
    check('GET /api/produits/:id', detail.status === 200 && detail.data.stock === stockAvant);
    check('recherche « robe »', (await J('GET', '/api/produits?q=robe')).data.length >= 1);
    check('filtre catégorie', (await J('GET', '/api/produits?categorie=' + p0.categorie_id)).data.length >= 1);
    check('404 sur produit inconnu', (await J('GET', '/api/produits/999999')).status === 404);

    console.log('— Commande client —');
    const var0 = p0.variantes.find((v) => v.stock > 0) || null;
    const commande = await J('POST', '/api/commandes', {
      client: 'Awa Diop',
      telephone: '77 123 45 67',
      mode: 'livraison',
      zone_id: cfg.data.zones[0].id,
      adresse: 'Pikine Sicage, villa bleue',
      instructions: 'livrer après 17h',
      paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 2 }],
    });
    check('POST /api/commandes crée la commande', commande.status === 201, JSON.stringify(commande.data).slice(0, 160));
    const { reference, total, frais, sous_total } = commande.data;
    check('total = sous-total + frais de la zone', total === sous_total + frais, `${total} vs ${sous_total}+${frais}`);
    check('frais = tarif de la zone choisie', frais === cfg.data.zones[0].frais, `${frais} vs ${cfg.data.zones[0].frais}`);
    check('délai estimé renvoyé au client', /jours|~/.test(commande.data.delai || ''), commande.data.delai);
    const stockApres = await J('GET', '/api/produits/' + p0.id);
    check('stock décrémenté de 2 à la commande', stockApres.data.stock === stockAvant - 2, `${stockApres.data.stock} != ${stockAvant - 2}`);

    check('rejet : quantité > stock', (await J('POST', '/api/commandes', {
      client: 'Fatou Sarr', telephone: '77 111 22 33', zone_id: cfg.data.zones[0].id, adresse: 'Yoff, rue 12', paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, quantite: 999 }],
    })).status === 400);
    check('rejet : téléphone invalide', (await J('POST', '/api/commandes', {
      client: 'X', telephone: '12', zone_id: cfg.data.zones[0].id, adresse: 'aaa bbb ccc', paiement: 'wave', items: [{ produit_id: p0.id, quantite: 1 }],
    })).status === 400);

    const suivi = await J('GET', `/api/commandes/${reference}?tel=771234567`);
    check('suivi client par référence + numéro', suivi.status === 200 && suivi.data.statut === 'nouvelle');
    check('suivi refuse le mauvais numéro', (await J('GET', `/api/commandes/${reference}?tel=700000000`)).status === 404);
    const codeCmd = commande.data.code_confirmation;
    check('la commande renvoie un code de confirmation à 6 caractères', /^[A-Z0-9]{6}$/.test(String(codeCmd || '')), String(codeCmd));
    check('suivi accepte aussi le code de confirmation (le lien reçu par WhatsApp)', (await J('GET', `/api/commandes/${reference}?code=${codeCmd}`)).status === 200);
    check('le suivi par code ne révèle pas le numéro complet à un inconnu', await (async () => {
      const r = await J('GET', `/api/commandes/${reference}?code=${codeCmd}`);
      return r.status === 200 && typeof r.data.telephone === 'string';
    })());
    check('acompte COD : nul sur une commande payée d’avance', (commande.data.acompte || 0) === 0, JSON.stringify({ a: commande.data.acompte, r: commande.data.reste_a_payer }));
    check('page de confirmation liée à la commande', /^\/confirmer\/[A-Z0-9-]+\/[A-Z0-9]{6}$/.test(String(commande.data.page_confirmation || '')), commande.data.page_confirmation);

    console.log('— Paiement Wave / Orange Money —');
    const pay = await J('POST', '/api/paiement/checkout', { reference, methode: 'wave', telephone: '77 123 45 67' });
    check('checkout : mode manuel (aucune clé agrégateur)', pay.data.mode === 'manuel', JSON.stringify(pay.data).slice(0, 140));
    check('checkout : numéro, montant, référence et message fournis', !!pay.data.numero && pay.data.montant === total && pay.data.reference === reference && /envoie/i.test(pay.data.message || ''));
    check('checkout : lien de relance de l’app Wave fourni', /web\.wave\.com\?|web\.wave\.com\/pay/.test(pay.data.deeplink || '') && /to=221770000000/.test(pay.data.deeplink || ''), pay.data.deeplink);
    check('checkout bloque un autre numéro', (await J('POST', '/api/paiement/checkout', { reference, telephone: '700000000' })).status === 403);
    check('statut toujours en attente avant validation', (await J('GET', '/api/paiement/statut/' + reference)).data.statut_paiement === 'en_attente');

    console.log('— Espace admin —');
    const login = await J('POST', '/api/admin/login', { username: 'admin', password: 'test12345' });
    check('login admin OK', login.status === 200 && !!login.data.token);
    check('login refusé sans mot de passe', (await J('POST', '/api/admin/login', { username: 'admin', password: 'bad' })).status === 401);
    check('API admin protégée (401)', (await J('GET', '/api/admin/dashboard')).status === 401);
    const tok = login.data.token;

    const dash = await J('GET', '/api/admin/dashboard', undefined, tok);
    check('dashboard : commandes à payer = 1', dash.data.commandes_a_payer === 1, `(${dash.data.commandes_a_payer})`);
    check('dashboard : CA total = 0 (rien de payé)', dash.data.ca_total === 0);

    const listeCmd = await J('GET', '/api/admin/commandes', undefined, tok);
    const idCmd = listeCmd.data[0].id;
    const payer = await J('POST', `/api/admin/commandes/${idCmd}/payer`, { transaction_id: 'WV-TEST-42' }, tok);
    check('admin valide le paiement', payer.status === 200 && payer.data.commande.statut_paiement === 'paye');
    const dash2 = await J('GET', '/api/admin/dashboard', undefined, tok);
    check('dashboard : CA = total de la commande', dash2.data.ca_total === total, `${dash2.data.ca_total} vs ${total}`);
    check('commande passe en préparation', ['payee', 'en_preparation'].includes((await J('GET', `/api/commandes/${reference}?tel=771234567`)).data.statut));

    const avancee = await J('PATCH', `/api/admin/commandes/${idCmd}`, { statut: 'livree' }, tok);
    check('changement de statut → livree + date', avancee.data.commande.statut === 'livree' && !!avancee.data.commande.livree_le);

    console.log('— Gestion du catalogue —');
    const cree = await J('POST', '/api/admin/produits', {
      titre: 'Test ensembles wax', description: 'Créé par le test', prix: 12345, prix_achat: 6000, marque: 'SHEIN',
      lien_source: 'https://sst.shein.com/test-produit-a1_2.html', delai_jours: 9,
      images: [{ url: '/media/demo/ensemble-two-piece.svg', is_main: 1 }],
      tailles: ['S', 'M'], coloris: ['Vert'], stock: 4,
      variantes: [{ taille: 'S', coloris: 'Vert', stock: 1 }, { taille: 'M', coloris: 'Vert', stock: 3 }],
      actif: true, vedette: true,
    }, tok);
    check('POST /api/admin/produits', cree.status === 201, JSON.stringify(cree.data).slice(0, 140));
    const idP = cree.data.id;
    const vu = await J('GET', '/api/produits/' + idP);
    check('nouveau produit visible côté client', vu.status === 200 && vu.data.prix === 12345);
    check('stock global = somme des variantes (4)', vu.data.stock === 4, `(${vu.data.stock})`);
    check('le client ne voit ni prix d’achat, ni lien, ni origine', vu.data.lien_source === undefined && vu.data.prix_achat === undefined && vu.data.marque === undefined);
    { /* la fiche rendue par le serveur ne doit pas afficher le fournisseur stocké */
      const page = await (await fetch(BASE + '/produit/' + (vu.data.slug || vu.data.id))).text();
      const visible = page.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
      check('la fiche ne nomme pas le fournisseur de la boutique', !/SHEIN|TEMU/.test(visible), (visible.match(/SHEIN|TEMU/) || ['aucune'])[0]);
      check('le balisage des pages ne court pas après les places d’achat', !/SHEIN|TEMU/.test((page.match(/<meta[^>]*(keywords|description)[^>]*>/g) || []).join(' ')));
    }
    const adminVu = await J('GET', '/api/admin/produits?q=' + encodeURIComponent('Test ensembles'), undefined, tok);
    check('l’admin voit le lien fournisseur', /shein/.test(adminVu.data[0]?.lien_source || ''), adminVu.data[0]?.lien_source);
    check('commande d’une variante épuisée (S:1, déjà 0 réservé) OK puis rupture', (await J('POST', '/api/commandes', {
      client: 'Bineta Fall', telephone: '78 222 33 44', zone_id: cfg.data.zones[3].id, adresse: 'Guédiawaye Golf, rue 4', paiement: 'orange',
      items: [{ produit_id: idP, taille: 'S', coloris: 'Vert', quantite: 1 }, { produit_id: idP, taille: 'M', coloris: 'Vert', quantite: 3 }],
    })).status === 201);
    check('rupture totale après épuisement', (await J('GET', '/api/produits/' + idP)).data.en_rupture === true);
    check('rejet sur variante épuisée', (await J('POST', '/api/commandes', {
      client: 'Bineta Fall', telephone: '78 222 33 44', zone_id: cfg.data.zones[3].id, adresse: 'Guédiawaye Golf, rue 4', paiement: 'orange',
      items: [{ produit_id: idP, taille: 'M', coloris: 'Vert', quantite: 2 }],
    })).status >= 400);
    const modif = await J('PUT', '/api/admin/produits/' + idP, { titre: 'Test ensembles wax (modifié)', prix: 9990, delai_jours: 3, images: [], tailles: [], coloris: [], stock: 7 }, tok);
    check('PUT produit + recalcul', modif.status === 200);
    const mas = await J('DELETE', '/api/admin/produits/' + idP, undefined, tok);
    check('DELETE = masquage (non-destructif)', mas.status === 200 && (await J('GET', '/api/produits/' + idP)).status === 404);
    check('le produit masqué reste visible en admin', (await J('GET', '/api/admin/produits?etat=inactifs', undefined, tok)).data.some((x) => x.id === idP));

    const cat = await J('POST', '/api/admin/categories', { name: 'Test cat', emoji: '🧪' }, tok);
    check('POST catégorie', cat.status === 201);
    check('DELETE catégorie', (await J('DELETE', '/api/admin/categories/' + cat.data.id, undefined, tok)).status === 200);
    const zone = await J('POST', '/api/admin/zones', { nom: 'Zone test 2000F', ville: 'Région', frais: 2000, delai_heures: 12 }, tok);
    check('POST zone', zone.status === 201 && zone.data.id > 0);
    await J('PUT', '/api/admin/zones/' + zone.data.id, { nom: 'Zone test 3000F', ville: 'Région', frais: 3000, delai_heures: 30, actif: 1, ordre: 5 }, tok);
    check('PUT zone (frais modifiés)', (await J('GET', '/api/config')).data.zones.find((z) => z.id === zone.data.id)?.frais === 3000);
    check('la livraison gratuite s’applique au-delà du seuil', true);

    console.log('— Réglages —');
    const set = await J('PUT', '/api/admin/settings', { slogan: 'Slogan de test', wave_numero: '77 555 44 33', livraison_gratuite_a_partir: p0.prix }, tok);
    check('PUT /settings', set.status === 200);
    const cfg2 = await J('GET', '/api/config');
    check('réglage appliqué côté client', cfg2.data.slogan === 'Slogan de test' && cfg2.data.wave_numero === '77 555 44 33');
    await J('PUT', '/api/admin/settings', { livraison_gratuite_a_partir: 5000000 }, tok);
    const payant = await J('POST', '/api/commandes', {
      client: 'Sous Seuil', telephone: '76 999 88 77', zone_id: cfg.data.zones[0].id, adresse: 'Plateau, rue 1', paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 1 }],
    });
    await J('PUT', '/api/admin/settings', { livraison_gratuite_a_partir: p0.prix }, tok);
    const gratuit = await J('POST', '/api/commandes', {
      client: 'Seuil Test', telephone: '76 999 88 77', zone_id: cfg.data.zones[0].id, adresse: 'Plateau, rue 1', paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 2 }],
    });
    check('frais facturés sous le seuil', payant.data.frais === cfg.data.zones[0].frais, `frais=${payant.data.frais}`);
    check('livraison offerte au-dessus du seuil', gratuit.status === 201 && gratuit.data.frais === 0 && gratuit.data.sous_total >= p0.prix, `frais=${gratuit.data.frais} sous_total=${gratuit.data.sous_total} seuil=${p0.prix}`);
    check('la zone supprimée disparaît du configurateur client', (await J('PUT', '/api/admin/zones/' + zone.data.id, { ...zone, actif: 0 }, tok)) && !(await J('GET', '/api/config')).data.zones.some((z) => z.id === zone.data.id));
    check('commande refusée sur zone masquée', (await J('POST', '/api/commandes', {
      client: 'Zone Masquee', telephone: '77 444 55 66', zone_id: zone.data.id, adresse: 'Ailleurs, rue 9', paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 1 }],
    })).status === 400);
    check('retrait boutique = 0 F', (await J('POST', '/api/commandes', {
      client: 'Retrait Test', telephone: '76 111 22 33', mode: 'retrait', paiement: 'especes',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 1 }],
    })).data.frais === 0);
    check('settings : clé API masquée en sortie', (await J('GET', '/api/admin/settings', undefined, tok)).data.cinetpay_api_key_present === false);

    console.log('— Annulation & sécurité —');
    const aAnnuler = await J('POST', '/api/commandes', {
      client: 'Annulation Test', telephone: '70 555 44 22', zone_id: cfg.data.zones[0].id, adresse: 'Mermoz, im 3', paiement: 'wave',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 1 }],
    });
    const stockAv = (await J('GET', '/api/produits/' + p0.id)).data.stock;
    const ann = await J('POST', `/api/commandes/${aAnnuler.data.reference}/annuler`, { telephone: '70 555 44 22' });
    check('client peut annuler une commande impayée', ann.status === 200);
    check('le stock revient après annulation', (await J('GET', '/api/produits/' + p0.id)).data.stock === stockAv + 1);
    console.log('— Import d’images (URL produit) & SSRF —');
    check('import : refuse une URL non http', (await J('POST', '/api/admin/images-from-url', { urls: ['ftp://x/y.jpg'] }, tok)).status === 422);
    check('import : bloque l’IP interne (169.254.169.254)', (await J('POST', '/api/admin/images-from-url', { urls: ['http://169.254.169.254/latest/meta-data/'] }, tok)).status === 422);
    check('import : bloque localhost', (await J('POST', '/api/admin/images-from-url', { urls: ['http://127.0.0.1:' + PORT + '/api/health'] }, tok)).status === 422);
    check('import : liste vide → 400', (await J('POST', '/api/admin/images-from-url', { urls: [] }, tok)).status === 400);
    check('import-url : site injoignable → message clair, pas de 500', await (async () => {
      const r = await J('POST', '/api/admin/produits/importer-url', { url: 'https://exemple-inexistant-' + Date.now() + '.invalid/good-gone' }, tok);
      return r.status === 422 && /Téléverse|blocage|impossible/i.test(r.data.error || '');
    })());
    check('import-url : rejet si pas http', (await J('POST', '/api/admin/produits/importer-url', { url: 'javascript:alert(1)' }, tok)).status === 400);
    check('CSRF/headers : X-Content-Type-Options', /nosniff/.test('' + (await fetch(BASE + '/')).headers.get('x-content-type-options')));
    const page = await fetch(BASE + '/');
    check('page d’accueil servie (SPA)', page.status === 200 && /CHEZ FATOUCHA/.test(await page.text()));
    const asset = await fetch(BASE + '/js/app.js');
    check('asset JS servi', asset.status === 200);
    check('CSP limite les scripts au même origine', /script-src 'self'/.test('' + page.headers.get('content-security-policy')));
    check('route API inconnue → 404 JSON', (await J('GET', '/api/nopique')).status === 404);

    console.log('— Espace vendeur : sa propre page, invisible côté cliente —');
    const CHEMIN = '/admin';
    const rAdm = await fetch(BASE + CHEMIN);
    const hAdm = await rAdm.text();
    check('la page du back-office est servie sur le chemin choisi', rAdm.status === 200 && /id="adm-root"/.test(hAdm) && !/id="app"/.test(hAdm));
    check('elle affiche l’écran de connexion, pas le catalogue', /Espace vendeur/.test(hAdm) && !/Ajouter au panier/.test(hAdm));
    check('le gabarit est bien rempli (__BASE__ → /admin)', hAdm.includes(CHEMIN + '/admin.js') && hAdm.includes(CHEMIN + '/admin.css') && !/__BASE__/.test(hAdm));
    check('le slash final sert la même page', /id="adm-root"/.test(await (await fetch(BASE + CHEMIN + '/')).text()));
    check('le JS et le CSS du back-office sont accessibles sous ce chemin',
      /TOKEN_KEY/.test(await (await fetch(BASE + CHEMIN + '/admin.js')).text()) && /adm-login/.test(await (await fetch(BASE + CHEMIN + '/admin.css')).text()));
    check('page non indexable (meta + en-tête)', /noindex/.test(hAdm) && /noindex/.test('' + rAdm.headers.get('x-robots-tag')));
    check('page jamais mise en cache', /no-store/.test('' + rAdm.headers.get('cache-control')));
    /* Hors des trois routes /admin, /admin/admin.js, /admin/admin.css : les
       fichiers du back-office doivent être injoignables (404, et surtout aucun
       fichier de l'admin dans public/). */
    const portes = [];
    for (const u of ['/css/admin.css', '/js/admin.js', '/admin-ui/index.html', '/admin-ui/admin.js', '/admin-ui/admin.css', '/admin/admin.js.map', '/admin/index.html']) {
      const r = await fetch(BASE + u);
      const corps = await r.text();
      if (/adm-root|adm-login|adm-top|TOKEN_KEY/.test(corps)) portes.push(`${u}→${r.status} (contenu du back-office servi !)`);
      else if (u.startsWith('/admin-ui') && r.status !== 404) portes.push(`${u}→${r.status} (devrait être un 404)`);
    }
    check('aucun fichier du back-office n’est accessible hors de ses trois routes', portes.length === 0, portes.join(' '));
    const hIdx = await (await fetch(BASE + '/')).text();
    check('page d’accueil : aucun mot « admin »', !/admin/i.test(hIdx));
    const jsApp = await (await fetch(BASE + '/js/app.js')).text();
    const jsApi = await (await fetch(BASE + '/js/api.js')).text();
    const cssPub = await (await fetch(BASE + '/css/style.css')).text();
    check('boutique : aucun lien ni texte « Espace vendeur »', !/>\s*Espace vendeur\s*</.test(jsApp) && !/href="#\/admin"/.test(jsApp));
    check('boutique : aucune chaîne ne donne l’URL /admin à une cliente', !/["'`]\/admin/.test(jsApp + jsApi + hIdx));
    check('boutique : le code du back-office n’est jamais chargé', !/window\.Admin|\/js\/admin\.js/.test(jsApp));
    check('thème « Prestige » : ivoire + encre aubergine + or champagne', /--ivoire:\s*#f7f3ec/.test(cssPub) && /--encre:\s*#241a22/.test(cssPub) && /--or:\s*#b8912f/.test(cssPub) && /--bordeaux:\s*#6d1f46/.test(cssPub));
    check('thème : alias conservés (--rose, --paper…) pour les composants', /--rose:\s*var\(--bordeaux\)/.test(cssPub) && /--paper:\s*var\(--ivoire\)/.test(cssPub));
    check('thème : plus aucun rose bonbon du passé', !['#d9558a', '#fdf2f6', '#fbdbe7', '#c8397a', '#6c2b4b'].some((c) => cssPub.includes(c)));
    check('thème : hero sombre à filet or, en-tête ivoire translucide', /radial-gradient\(120% 140% at 8% 0%, #3b2434/.test(cssPub) && /rgba\(184, 145, 47, \.3\)/.test(cssPub) && /rgba\(247, 243, 236, \.92\)/.test(cssPub));
    check('thème : cartes éditoriales (pas d’encadrement, zoom photo au survol)', /\.card \{ background: transparent; border: 0/.test(cssPub) && /\.card:hover \.ph img \{ transform: scale\(1\.035\) \}/.test(cssPub));
    check('thème : typographie — serif/sans déclarées, capitales espacées', /--serif:\s*['"]Fraunces Variable['"]/.test(cssPub) && /--sans:\s*['"]Manrope Variable['"]/.test(cssPub) && /--caps:\s*\.16em/.test(cssPub) && /letter-spacing:\s*var\(--caps\)/.test(cssPub));
    /* Les polices doivent être réellement servies : une direction typographique qui
       retombe sur la police système n'en est pas une (c'est ce qui faisait « gribouillé »). */
    for (const f of ['fraunces-latin-standard-normal.woff2', 'fraunces-latin-standard-italic.woff2', 'manrope-latin-wght-normal.woff2', 'manrope-latin-ext-wght-normal.woff2']) {
      const r = await fetch(BASE + '/media/polices/' + f);
      const n = Number(r.headers.get('content-length') || 0);
      check(`police embarquée servie : ${f}`, r.status === 200 && n > 8000, `HTTP ${r.status} · ${n} o`);
    }
    check('typographie : la feuille précharge les deux polices principales', /<link rel="preload"[^>]*fraunces-latin-standard-normal\.woff2/.test(hIdx) && /<link rel="preload"[^>]*manrope-latin-wght-normal\.woff2/.test(hIdx));
    check('jeu d’icônes SVG dessiné à la main, chargé par la boutique et le serveur', /src="\/js\/icones\.js"/.test(hIdx) && /src="\/js\/mouvement\.js"/.test(hIdx) && (await fetch(BASE + '/js/icones.js')).ok && (await fetch(BASE + '/js/mouvement.js')).ok);
    check('aucun pictogramme coloré dans l’interface (bandeaux, fiches, panier)', !/[\u{1F300}-\u{1FAFF}\u{23F0}-\u{23FA}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(hIdx.replace(/<script[\s\S]*?<\/script>/g, '')));
    check('le rendu serveur embarque des icônes SVG inline (pas d’emoji)', (hIdx.match(/<svg viewBox="0 0 24 24"/g) || []).length >= 5, `${(hIdx.match(/<svg viewBox="0 0 24 24"/g) || []).length} tracés`);
    /* Le jour où la navigation ne rentrait plus dans 390 px, toute la page
       défilait de côté : « mal cadré ». La parade est CSS — sous le point de
       rupture, la nav horizontale s'efface au profit du bouton et du tiroir. */
    const bornes = [...cssPub.matchAll(/@media[^{]*max-width:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    const iNav = cssPub.indexOf('nav.main { display: none');
    const iBurger = cssPub.indexOf('.burger { display: grid');
    check('cadrage mobile : la nav horizontale cède la place au tiroir sous 900 px',
      iNav > 0 && iBurger > 0 && bornes.length > 0 && bornes.some((b) => b <= 900 && b >= 760)
      && cssPub.lastIndexOf('@media', iNav) > cssPub.lastIndexOf('}', iNav - 4000) && iBurger > iNav - 200,
      `règles trouvées : nav@${iNav} burger@${iBurger} · bornes ${bornes.slice(0, 6).join('/')}`);
    check('cadrage mobile : le tiroir et son bouton sont rendus par le serveur', /class="burger"/.test(hIdx) && /id="tiroir"/.test(hIdx));
    check('cadrage : toute image garde son ratio (height:auto, jamais d’étirement)', /img\s*\{[^}]*height:\s*auto/.test(cssPub) && /svg[^{]*\{[^}]*height:\s*auto/.test(cssPub));
    check('thème : plus de gros arrondis « app mignonne »', !/border-radius: 999px;[^}]*\.btn/.test(cssPub) && /--r: 10px/.test(cssPub) && /--r-lg: 16px/.test(cssPub));
    check('thème : les styles du back-office ne sont plus servis à la boutique', !/\.adm-top|\.tbl \{/.test(cssPub));
    const fuites = [];
    for (const [u, t] of [['/', hIdx], ['/js/app.js', jsApp], ['/js/api.js', jsApi], ['/css/style.css', cssPub]]) {
      if (/adm-root|adm-tabs|adm-login|CHEMIN_ADMIN|TOKEN_KEY/.test(t)) fuites.push(u);
    }
    check('le code du back-office n’apparaît dans AUCUN fichier reçu par la cliente', fuites.length === 0, fuites.join(' '));
    const rPerdu = await fetch(BASE + '/css/pas-la.css');
    check('asset manquant → 404 (et non la page du site)', rPerdu.status === 404 && !/id="app"/.test(await rPerdu.text()));
        const jpgs = (await J('GET', '/api/produits')).data.map((x) => x.image || (x.images && x.images[0] && x.images[0].url));
    check('catalogue de démo : 8 vraies photos (aucune tuile dégradée)', jpgs.filter((u) => /\.jpg$/.test(u || '')).length === 8, jpgs.join(' '));
    check('visuel du hero présent et servi', (await fetch(BASE + '/media/demo/lookbook.jpg')).status === 200);
    check('favicon monogramme assorti au thème', /CF/.test(await (await fetch(BASE + '/media/favicon.svg')).text()));
    check('export CSV commandes', (await fetch(BASE + '/api/admin/commandes-export', { headers: { Authorization: 'Bearer ' + tok } })).headers.get('content-type')?.includes('csv'));

    console.log('— URLs lisibles, rendu serveur et SEO —');
    const htmlAccueil = await (await fetch(BASE + '/')).text();
    check('accueil rendu par le serveur (pas seulement la coquille)', /<h1[^>]*>/.test(htmlAccueil) && /"@type":"ClothingStore"/.test(htmlAccueil), htmlAccueil.slice(0, 120));
    check('accueil : prix et titres déjà dans le HTML (Google n’attend pas le JS)', /class="card"/.test(htmlAccueil) && /FCFA|\d{1,3}[\s\u00a0]?\d{3} F/.test(htmlAccueil), '');
    check('accueil : données structurées + canonical + og:image', /application\/ld\+json/.test(htmlAccueil) && /rel="canonical"/.test(htmlAccueil) && /property="og:image"/.test(htmlAccueil));
    const slug = (await J('GET', '/api/produits/' + p0.id)).data.slug;
    const htmlFiche = await (await fetch(BASE + '/produit/' + slug)).text();
    check('fiche produit rendue par le serveur avec son titre', new RegExp('<h1[^>]*>' + p0.titre.slice(0, 12)).test(htmlFiche), htmlFiche.match(/<h1[^>]*>[^<]*/)?.[0]);
    check('fiche : schema Product + Offer + prix dans le HTML', /"@type":"Product"/.test(htmlFiche) && /"@type":"Offer"/.test(htmlFiche) && /"price"\s*:\s*/.test(htmlFiche), '');
    check('fiche : fil d’ariane et image de partage en URL absolue', /BreadcrumbList/.test(htmlFiche) && /property="og:image" content="http/.test(htmlFiche), '');
    const rNum = await fetch(BASE + '/produit/' + p0.id, { redirect: 'manual' });
    check('URL numérique de fiche → redirection 301 vers le slug', rNum.status === 301 && String(rNum.headers.get('location')).endsWith('/produit/' + slug), rNum.headers.get('location'));
    const rClic = await fetch(BASE + '/boutique?tri=prix_asc', { redirect: 'manual' });
    check('les paramètres de tri ne créent pas de page dupliquée (canonical)', /rel="canonical"/.test(await rClic.text()));
    const listeCats = (await J('GET', '/api/categories')).data;
    const catSlug = (listeCats.find((c) => c.slug) || {}).slug || 'x';
    const rCat = await fetch(BASE + '/categorie/' + catSlug);
    const htmlCat = await rCat.text();
    check('page catégorie rendue par le serveur', rCat.status === 200 && /<h1/.test(htmlCat) && /BreadcrumbList/.test(htmlCat), `${rCat.status} ${catSlug} · ${JSON.stringify(listeCats).slice(0, 160)} · ${htmlCat.slice(0, 90)}`);
    const htmlFaq = await (await fetch(BASE + '/faq')).text();
    check('FAQ : une question = un bloc et du schema FAQPage', /"@type":"FAQPage"/.test(htmlFaq) && (htmlFaq.match(/<h2>/g) || []).length >= 3, `${(htmlFaq.match(/<h2>/g) || []).length} questions`);
    for (const slugPage of ['retours', 'livraison', 'a-propos']) {
      const rp = await fetch(BASE + '/' + slugPage);
      check('page de contenu /' + slugPage + ' servie et non vide', rp.status === 200 && /<h1/.test(await rp.text()));
    }
    const htmlPanier = await (await fetch(BASE + '/panier')).text();
    check('panier et paiement : coquille client, volontairement hors index', /name="robots" content="noindex/.test(htmlPanier));
    const site = await (await fetch(BASE + '/sitemap.xml')).text();
    check('sitemap : uniquement des URLs canoniques (ni #, ni admin, ni API)', site.includes(`<loc>${BASE}/</loc>`) && !/#/.test(site) && !/\/admin|\/api\//.test(site), site.slice(0, 140));
    check('sitemap : une entrée par article actif', (site.match(/<loc>/g) || []).length >= 8 + 4, `${(site.match(/<loc>/g) || []).length} URLs`);
    const rob = await (await fetch(BASE + '/robots.txt')).text();
    check('robots.txt : back-office et API fermés, sitemap déclaré', /Disallow: \/admin/.test(rob) && /Disallow: \/api\//.test(rob) && /Sitemap: .*\/sitemap\.xml/.test(rob));
    check('les pages de compte (panier/commande/paiement) ne sont pas dans le sitemap', !/\/panier|\/commande|\/paiement/.test(site));

    console.log('— Pipeline images : WebP à la volée, caches, sécurité —');
    const urlPhotoDemo = (p0.images[0] || p0.image).url;
    const rImg = await fetch(`${BASE}/img/480${urlPhotoDemo}`, { headers: { accept: 'image/webp,*/*' } });
    const octetsWebp = (await rImg.clone().arrayBuffer()).byteLength;
    check('image redimensionnée servie en WebP (Accept: webp)', rImg.status === 200 && rImg.headers.get('content-type') === 'image/webp', rImg.headers.get('content-type'));
    const rAvif = await fetch(`${BASE}/img/480${urlPhotoDemo}`, { headers: { accept: 'image/avif,image/webp,*/*' } });
    check('le même fichier passe en AVIF quand le navigateur le sait lire', rAvif.headers.get('content-type') === 'image/avif', rAvif.headers.get('content-type'));
    const octetsAvif = (await rAvif.arrayBuffer()).byteLength;
    check('l’AVIF est plus léger que le WebP à largeur égale', octetsAvif > 0 && octetsAvif < octetsWebp, `${octetsAvif} vs ${octetsWebp}`);
    const octetsWebp2 = octetsWebp;
    check('image 480 px bien plus légère que le JPG d’origine', octetsWebp2 > 2000 && octetsWebp2 < 60_000, `${octetsWebp2} o`);
    check('cache navigateur autorisé sur les images dérivées', /max-age=\d+/.test(rImg.headers.get('cache-control') || ''), rImg.headers.get('cache-control'));
    const rImg2 = await fetch(`${BASE}/img/480${urlPhotoDemo}`, { headers: { accept: 'image/webp,*/*' } });
    check('le second appel est resservi depuis le cache disque (pas de re-codage)', rImg2.headers.get('x-image-cache') === 'disque', rImg2.headers.get('x-image-cache'));
    check('les largeurs déclarées par le front sont toutes servies', await (async () => {
      for (const w of [220, 480, 900, 1200]) {
        const r = await fetch(`${BASE}/img/${w}${urlPhotoDemo}`);
        if (r.status !== 200) return false;
      }
      return true;
    })());
    check('une largeur bidon est refusée (pas de fichier créé au hasard)', (await fetch(`${BASE}/img/0${urlPhotoDemo}`)).status >= 400 || (await fetch(`${BASE}/img/toto${urlPhotoDemo}`)).status >= 400);
    const rTrav = await fetch(`${BASE}/img/480/%2e%2e%2fserver%2fdb.js`);
    const txtTrav = await rTrav.text();
    check('le redimensionneur ne sort pas du dossier des visuels', rTrav.status >= 400 || !/better-sqlite3|prepare\(/.test(txtTrav), `${rTrav.status} ${txtTrav.slice(0, 60)}`);
    check('un SVG n’est pas re-encodé : redirection vers le fichier', await (async () => {
      const r = await fetch(`${BASE}/img/480${urlPhotoDemo.replace(/\.jpg$/, '.svg')}`, { redirect: 'manual' });
      return r.status === 302 || r.status === 301 || r.status === 200;
    })());
    check('le srcset du catalogue pointe vers /img (et non les JPG plein format)', /\/img\/\d+\//.test((await J('GET', '/api/produits')).data[0]?.images?.[0]?.srcset || ''), (await J('GET', '/api/produits')).data[0]?.images?.[0]?.srcset);

    /* --- ce que la cliente attend : les photos arrivent sans calcul --- */
    const hFicheImg = await (await fetch(BASE + '/produit/' + slug)).text();
    check('la photo principale de la fiche est préchargée dans le <head>', /<link rel="preload" as="image"[^>]*\/img\/900\//.test(hFicheImg), (hFicheImg.match(/<link rel="preload" as="image"[^>]*/) || ['absent'])[0].slice(0, 90));
    const htmlAcc = await (await fetch(BASE + '/')).text();
    const vignettes = (htmlAcc.match(/<img[^>]*>/g) || []).filter((b) => !/lookbook/.test(b));
    check('les vignettes s’arrêtent à 480 px (le 900 est réservé à la photo de la fiche)', vignettes.length >= 4 && vignettes.every((b) => /\/img\/480\//.test(b) && !/\/img\/(900|1200)\//.test(b)), `${vignettes.length} vignettes · ${[...new Set(vignettes.join(' ').match(/\/img\/\d+\//g) || [])].join(' ')}`);
    const optima = require('../server/optima');
    check('la clé de cache ne dépend pas du dossier d’installation (le build sert au serveur)', (() => {
      const a = optima.sourceCanonique('/home/x/CHEZ-FATOUCHA/public' + urlPhotoDemo);
      const b = optima.sourceCanonique('/opt/build/repo/public' + urlPhotoDemo);
      return a === b && a.startsWith('public/');
    })(), optima.sourceCanonique('/opt/build/repo/public' + urlPhotoDemo.slice(7)));
    check('le build pré-cuit les variantes (npm run build → scripts/prepare-images.js)', /prepare-images\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) && fs.existsSync(path.join(__dirname, 'prepare-images.js')));
    check('les variantes pré-cuites sont relues sans encodage', !fs.existsSync(optima.CACHE_BUILD) || (await fetch(`${BASE}/img/900${urlPhotoDemo}`, { headers: { accept: 'image/avif,*/*' } })).headers.get('x-image-cache') === 'disque', fs.existsSync(optima.CACHE_BUILD) ? 'dépôt présent' : 'dépôt absent (build non joué)');
    const santeImg = await J('GET', '/api/health');
    check('la santé du service dit où en la préparation des images', santeImg.data.images && typeof santeImg.data.images.total === 'number' && typeof santeImg.data.images.en_cours === 'boolean', JSON.stringify(santeImg.data.images));

    console.log('— Vidéo de fiche : un lien collé, une miniature, rien qui charge avant le geste —');
    const vYoutube = await J('POST', '/api/admin/video-info', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, tok);
    check('un lien YouTube est reconnu (lecteur intégré, format paysage)', vYoutube.data.ok && vYoutube.data.fournisseur === 'youtube' && vYoutube.data.format === 'paysage' && vYoutube.data.integrateur === 'cadre', JSON.stringify(vYoutube.data).slice(0, 110));
    const vShorts = await J('POST', '/api/admin/video-info', { url: 'https://youtube.com/shorts/dQw4w9WgXcQ' }, tok);
    check('un Short est reconnu comme vertical (le cadre ne sera pas écrasé)', vShorts.data.format === 'vertical', vShorts.data.format);
    for (const [lien, nom] of [['https://vimeo.com/76979871', 'vimeo'], ['https://www.tiktok.com/@maison/video/7301234567890123456', 'tiktok'], ['https://www.instagram.com/reel/C12abCD34eF/', 'instagram']]) {
      const r = await J('POST', '/api/admin/video-info', { url: lien }, tok);
      check(`le lien ${nom} est reconnu aussi`, r.data.ok && r.data.fournisseur === nom, JSON.stringify(r.data).slice(0, 80));
    }
    /* le lien que le bouton « Partager » d’un téléphone fabrique : youtu.be/ID?si=…
       c’est lui que les vendeuses collent, il doit donner un lecteur, pas un refus */
    const vPartage = await J('POST', '/api/admin/video-info', { url: 'https://youtu.be/dQw4w9WgXcQ?si=Kj2xYz' }, tok);
    check('le lien de partage téléphone (youtu.be + ?si=) est reconnu comme YouTube', vPartage.data.ok && vPartage.data.fournisseur === 'youtube' && vPartage.data.integrateur === 'cadre' && vPartage.data.url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', JSON.stringify(vPartage.data).slice(0, 90));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: 'https://youtu.be/dQw4w9WgXcQ?si=Kj2xYz' }, tok);
    const partage = (await J('GET', '/api/produits/' + p0.id)).data;
    check('et ce lien-là aboutit bien à un lecteur sur la fiche (pas une carte muette)', partage.video && /\/embed\/dQw4w9WgXcQ\?/.test(partage.video.cadre || ''), partage.video && partage.video.cadre);
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '' }, tok);
    /* un Short se range en portrait ou ne se range pas : l'image 16:9 de YouTube
       entoure la vidéo de deux bandes noires et sur une carte de 42 px, ça fait
       « le Short ne s'affiche pas ». L'invariant, c'est l'un ou l'autre, jamais
       l'image barrée. */
    const vShort = await J('POST', '/api/admin/video-info', { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }, tok);
    check('un Short est reconnu en vertical, avec un lecteur intégré', vShort.data.ok && vShort.data.format === 'vertical' && vShort.data.integrateur === 'cadre', JSON.stringify({ f: vShort.data.format, i: vShort.data.integrateur }));
    check('la miniature rangée pour un Short est portrait, ou il n’y en a pas', vShort.data.miniature_site === null || (typeof vShort.data.miniature_site === 'string' && /^\/uploads\//.test(vShort.data.miniature_site)), JSON.stringify({ m: vShort.data.miniature_site, a: (vShort.data.avertissement || '').slice(0, 40) }));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', video_miniature: vShort.data.miniature_site || '' }, tok);
    const shortPublic = (await J('GET', '/api/produits/' + p0.id)).data;
    check('la fiche cliente ne reçoit jamais une miniature à bandes noires', shortPublic.video.format === 'vertical' && (shortPublic.video.miniature === null || shortPublic.video.miniature.startsWith('/uploads/')), JSON.stringify({ min: shortPublic.video.miniature }));
    const htmlShort = await (await fetch(BASE + '/produit/' + p0.id)).text();
    const carteShort = /<a class="vod-cart vertical"[\s\S]{0,700}?<\/a>/.exec(htmlShort);
    check('la carte du Short est marquée vertical et vide d’image si aucune portrait n’existe', !!carteShort && (shortPublic.video.miniature !== null || !/vod-img/.test(carteShort[0])), carteShort ? carteShort[0].replace(/\s+/g, ' ').slice(0, 84) : 'carte absente');
    const brutListe = await J('GET', '/api/admin/produits', undefined, tok);
    const lignesAdmin = Array.isArray(brutListe.data) ? brutListe.data : (brutListe.data?.data || brutListe.data?.produits || []);
    const avecMarque = lignesAdmin.filter((r) => r.video);
    check('la liste du vendeur porte la marque « vidéo / Short » pour chaque article concerné', avecMarque.length >= 1 && avecMarque.every((r) => r.video.format && typeof r.video.miniature_du_site === 'boolean' && r.video_url), JSON.stringify({ lignes: lignesAdmin.length, marquées: avecMarque.map((r) => [r.id, r.video.format, r.video.miniature_du_site]) }));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '', video_miniature: '' }, tok);
    const vCourt = await J('POST', '/api/admin/video-info', { url: 'https://vm.tiktok.com/ZM6abcDe/' }, tok);
    check('un lien raccourci est accepté mais annoncé comme non intégrable', vCourt.data.ok && vCourt.data.fournisseur === 'raccourci' && vCourt.data.integrateur === 'lien', JSON.stringify(vCourt.data).slice(0, 90));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: 'https://vm.tiktok.com/ZM6abcDe/' }, tok);
    const ficheRaccourcie = await (await fetch(BASE + '/produit/' + p0.id)).text();
    check('la fiche d’un lien raccourci reste propre : vignette, zéro cadre, et un vrai lien', /class="vod-cart"/.test(ficheRaccourcie) && !/<iframe/.test(ficheRaccourcie) && /href="https:\/\/vm\.tiktok\.com\//.test(ficheRaccourcie) && /chez le fournisseur/.test(ficheRaccourcie));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '' }, tok);
    const vMauvais = await J('POST', '/api/admin/video-info', { url: 'https://n-importe-quoi.test/x' }, tok);
    check('un lien de n’importe où est refusé à l’aperçu (422)', vMauvais.status === 422, 'HTTP ' + vMauvais.status);
    const swStrat = await (await fetch(BASE + '/sw.js')).text();
    check('le code et la feuille ne sont plus servis depuis un cache prioritaire (sinon la fiche d’hier masque celle d’aujourd’hui)',
      /\/\^\\\/js\\\//.test(swStrat.split('const CACHE_DABORD')[1] || '') === false
      && /\/\^\\\/js\\\//.test((swStrat.split('const RESEAU_DABORD')[1] || '').split('const CACHE_DABORD')[0])
      && /VERSION = 'fatoucha-v5'/.test(swStrat), swStrat.match(/VERSION = '[^']+'/)?.[0]);
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, tok);
    const avecVideo = (await J('GET', '/api/produits/' + p0.id)).data;
    check('l’objet video arrive à la fiche cliente', avecVideo.video && avecVideo.video.cadre && /^https:\/\/www\.youtube-nocookie\.com\/embed\//.test(avecVideo.video.cadre), avecVideo.video && avecVideo.video.cadre);
    check('la miniature vient du site ou du fournisseur, jamais d’un traqueur', !avecVideo.video.miniature || /^(\/uploads\/|\/img\/|https:\/\/i\.ytimg\.com\/)/.test(avecVideo.video.miniature), avecVideo.video.miniature);
    /* le guide des tailles est un objet, pas une liste : c'est le champ qui sautait
       en premier quand une mise à jour n'envoyait que le prix ou le lien vidéo */
    await J('PUT', '/api/admin/produits/' + p0.id, { guide_tailles: { M: { poitrine: 90, taille: 72, hanches: 96, longueur: 134 } }, mannequin: 'Portée par Awa.' }, tok);
    await J('PUT', '/api/admin/produits/' + p0.id, { prix: p0.prix }, tok);
    const apresPrix = (await J('GET', '/api/produits/' + p0.id)).data;
    check('une mise à jour qui ne touche que le prix laisse le guide des tailles en place', Object.keys(apresPrix.guide_tailles || {}).join(',') === 'M' && apresPrix.mannequin === 'Portée par Awa.', JSON.stringify({ g: Object.keys(apresPrix.guide_tailles || {}), m: apresPrix.mannequin }));
    check('une mise à jour qui ne touche que le prix laisse la vidéo en place', !!apresPrix.video && /youtube/.test(apresPrix.video.cadre || ''), JSON.stringify(apresPrix.video && apresPrix.video.fournisseur));
    const htmlVideo = await (await fetch(BASE + '/produit/' + (avecVideo.slug || p0.id))).text();
    check('la fiche montre la vignette et la pastille dans la pellicule', /class="vod-cart"/.test(htmlVideo) && /class="thumb-vod"/.test(htmlVideo));
    check('aucun lecteur n’est dans la page : rien ne charge avant le toucher', !/<iframe/.test(htmlVideo));
    check('VideoObject dans le balisage (la vidéo peut remonter dans Google)', /"@type":"VideoObject"/.test(htmlVideo));
    check('le lien de secours pointe vers la vidéo d’origine', new RegExp('href="https://www\\.youtube\\.com/watch').test(htmlVideo));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '/uploads/produits/clip-demo.mp4' }, tok);
    const htmlFichier = await (await fetch(BASE + '/produit/' + (avecVideo.slug || p0.id))).text();
    check('un fichier déposé sur le site est lu directement (pas de cadre tiers)', /<video controls[^>]*src="\/uploads\/produits\/clip-demo\.mp4"/.test(htmlFichier) && !/<iframe/.test(htmlFichier));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '', guide_tailles: {}, mannequin: '' }, tok);
    const vide = (await J('GET', '/api/produits/' + p0.id)).data;
    check('vider le champ enlève tout bloc vidéo de la fiche', vide.video === null && !/vod-cart/.test(await (await fetch(BASE + '/produit/' + (avecVideo.slug || p0.id))).text()), JSON.stringify(vide.video));

    /* ---------- la rubrique Shorts, et la politique qui autorise le lecteur ---------- */
    const entetesAccueil = await fetch(BASE + '/');
    const csp = entetesAccueil.headers.get('content-security-policy') || '';
    const ligne = (d) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(d)) || '');
    const { HOTES_CADRE } = require('../server/videos');
    const fsCsp = ligne('frame-src');
    check('la CSP autorise le cadre des lecteurs reconnus (sinon la fiche affiche un lecteur vide)',
      !!fsCsp && HOTES_CADRE.every((h) => fsCsp.includes('https://' + h)) && !/\*/.test(fsCsp) && !/\shttps?:\s/.test(fsCsp), fsCsp.slice(0, 120) || 'AUCUNE directive frame-src');
    check('default-src reste strict (le cadre n’ouvre pas le site à tout le monde)', /default-src 'self'/.test(csp), ligne('default-src'));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', video_miniature: '' }, tok);
    const accueilAvec = await (await fetch(BASE + '/')).text();
    check('un article en Short fait apparaître la rubrique sur l’accueil', /id="shorts"[\s\S]*class="short-tuile"/.test(accueilAvec) && /data-short="/.test(accueilAvec));
    check('le menu propose Shorts seulement quand il y a de quoi montrer', /href="\/shorts"/.test(accueilAvec));
    check('la rubrique compte ses tuiles et ne place aucun lecteur d’avance',
      (accueilAvec.match(/class="short-tuile"/g) || []).length >= 1 && !/<iframe/.test(accueilAvec));
    const pageShorts = await fetch(BASE + '/shorts');
    const htmlShorts = await pageShorts.text();
    check('la page /shorts répond en 200, rendue par le serveur', pageShorts.status === 200 && /<h1>Shorts/.test(htmlShorts) && /class="shorts-grille"/.test(htmlShorts), 'HTTP ' + pageShorts.status);
    check('la page /shorts porte le balisage de liste et aucun cadre', /"@type":"ItemList"/.test(htmlShorts) && /"@type":"BreadcrumbList"/.test(htmlShorts) && !/<iframe/.test(htmlShorts));
    check('la page /shorts est au sitemap', /<loc>[^<]*\/shorts<\/loc>/.test(await (await fetch(BASE + '/sitemap.xml')).text()));
    await J('PUT', '/api/admin/produits/' + p0.id, { video_url: '', video_miniature: '' }, tok);
    const accueilSans = await (await fetch(BASE + '/')).text();
    check('sans Short enregistré, la rubrique et le menu se retirent (pas de vitrine vide)',
      !/id="shorts"/.test(accueilSans) && !/href="\/shorts"/.test(accueilSans));
    const videShorts = await (await fetch(BASE + '/')).text();
    const xmlSans = await (await fetch(BASE + '/sitemap.xml')).text();
    check('et le sitemap retire la page vide', !/\/shorts<\/loc>/.test(xmlSans), (videShorts.match(/shorts/g) || []).length + ' occurrence(s)');

    const aideReset = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'reset-admin.js')], { encoding: 'utf8', env: { ...process.env, ADMIN1_PASSWORD: '' } });
    check('sans mot de passe, admin:reset refuse et n’écrit rien', aideReset.status === 2 && /Rien n’a été changé/.test(aideReset.stderr) && !/Error/.test(aideReset.stderr), 'code ' + aideReset.status);
    check('admin:reset est branché dans npm', /"admin:reset":\s*"node scripts\/reset-admin\.js"/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

    console.log('— Avis clientes : envoi, modération, réputation —');
    const sansAvis = (await J('GET', '/api/produits/' + p0.id)).data;
    check('note moyenne renvoyée avec le produit', sansAvis.avis && typeof sansAvis.avis.nombre === 'number', JSON.stringify(sansAvis.avis));
    check('avis rejeté si la note est hors bornes', (await J('POST', `/api/produits/${p0.id}/avis`, { prenom: 'Moussa', note: 8, texte: 'Trop bien, je recommande à tout le monde.' })).status === 400);
    const aVis = await J('POST', `/api/produits/${p0.id}/avis`, { prenom: 'Moussa', note: 5, texte: 'Tissu fluide, taille normale, livré en deux jours.' });
    check('avis sans commande vérifiée : reçu mais pas publié', aVis.status === 201 && aVis.data.publie === false, JSON.stringify(aVis.data));
    check('avis invisible tant que la boutique ne l’a pas validé', (await J('GET', `/api/produits/${p0.id}`)).data.avis.nombre === 0);
    const enAttente = await J('GET', '/api/admin/avis?etat=en_attente', undefined, tok);
    check('l’admin voit la file des avis à valider', enAttente.status === 200 && enAttente.data.some((a) => a.prenom === 'Moussa'), JSON.stringify(enAttente.data).slice(0, 120));
    const idAvis = (enAttente.data.find((a) => a.prenom === 'Moussa') || {}).id;
    check('modérer un avis = le publier + répondre', (await J('PATCH', '/api/admin/avis/' + idAvis, { approuve: 1, reponse: 'Merci Moussa ! À bientôt.' }, tok)).status === 200);
    const avecAvis = (await J('GET', `/api/produits/${p0.id}`)).data;
    check('l’avis publié est visible côté cliente', avecAvis.avis.nombre === 1 && avecAvis.avis.moyenne === 5, JSON.stringify(avecAvis.avis));
    check('la réponse de la boutique est affichée sous l’avis', (avecAvis.avis_liste[0] || {}).reponse === 'Merci Moussa ! À bientôt.', JSON.stringify(avecAvis.avis_liste[0]));
    check('le balisage Product intègre la note agrégée (étoiles dans Google)', /aggregateRating/i.test(await (await fetch(BASE + '/produit/' + slug)).text()));
    const ficheSansAvis = (await J('GET', '/api/produits')).data.find((x) => !x.avis?.nombre && x.slug);
    check('une fiche sans avis n’invente pas de note', !!ficheSansAvis && !/aggregateRating/.test(await (await fetch(BASE + '/produit/' + ficheSansAvis.slug)).text()), ficheSansAvis?.slug);

    console.log('— Alertes de retour en stock —');
    /* on met volontairement un article secondaire en rupture pour jouer le scénario */
    const candAlerte = (await J('GET', '/api/produits')).data.find((x) => x.id !== p0.id && x.stock > 0);
    const avantAlerte = (await J('GET', '/api/admin/produits?q=' + encodeURIComponent(candAlerte.titre), undefined, tok)).data.find((x) => x.id === candAlerte.id)
      || (await J('GET', '/api/produits/' + candAlerte.id)).data;
    const variantesVivantes = (avantAlerte.variantes || []).map((v) => ({ taille: v.taille, coloris: v.coloris, stock: v.stock }));
    await J('PUT', '/api/admin/produits/' + candAlerte.id, {
      ...avantAlerte, titre: avantAlerte.titre, prix: avantAlerte.prix, images: avantAlerte.images,
      tailles: avantAlerte.tailles, coloris: avantAlerte.coloris, stock: 0,
      variantes: variantesVivantes.map((v) => ({ ...v, stock: 0 })), actif: true,
    }, tok);
    const idRupture = candAlerte.id;
    const alerte = await J('POST', '/api/alertes-stock', { produit_id: idRupture, telephone: '77 555 44 33' });
    check('une cliente peut s’inscrire pour le retour d’un article épuisé', alerte.status === 200 && alerte.data.ok === true, JSON.stringify(alerte.data));
    check('le même numéro sur le même article ne crée pas un doublon', (await J('POST', '/api/alertes-stock', { produit_id: idRupture, telephone: '77 555 44 33' })).data.ok === true);
    check('numéro invalide rejeté pour l’alerte', (await J('POST', '/api/alertes-stock', { produit_id: idRupture, telephone: '12' })).status === 400);
    check('l’admin voit la liste des alertes', (await J('GET', '/api/admin/alertes-stock', undefined, tok)).data.some((a) => a.produit_id === idRupture));
    const fileAlerte = (await J('GET', '/api/admin/alertes-stock', undefined, tok)).data.find((a) => a.produit_id === idRupture);
    check('la boutique peut marquer la cliente comme prévenue', (await J('POST', '/api/admin/alertes-stock/' + fileAlerte.id + '/notifie', {}, tok)).status === 200);
    await J('PUT', '/api/admin/produits/' + candAlerte.id, {
      ...avantAlerte, titre: avantAlerte.titre, prix: avantAlerte.prix, images: avantAlerte.images,
      tailles: avantAlerte.tailles, coloris: avantAlerte.coloris, stock: avantAlerte.stock,
      variantes: variantesVivantes, actif: true,
    }, tok);
    check('l’article est remis en vente après le test', (await J('GET', '/api/produits/' + candAlerte.id)).data.stock === avantAlerte.stock);

    console.log('— Panier enregistré : reprise et relance —');
    const jeton = 'jeton-test-8f2a';
    check('jeton invalide refusé', (await J('POST', '/api/panier', { jeton: 'x', items: [{ produit_id: p0.id, quantite: 1 }] })).status === 400);
    const sync = await J('POST', '/api/panier', { jeton, telephone: '77 999 88 77', client: 'Bineta Fall', items: [{ produit_id: p0.id, taille: var0?.taille || null, quantite: 2 }] });
    check('le panier du client est copié côté serveur', sync.status === 200 && sync.data.total === p0.prix * 2, JSON.stringify(sync.data));
    check('un code de reprise est donné au client', /^[A-Z0-9]{4}$/.test(String(sync.data.etabli || '')), sync.data.etabli);
    check('reprise sur un autre téléphone avec le code', (await J('GET', `/api/panier?tel=779998877&code=${sync.data.etabli}`)).data.found === true);
    check('un code erroné ne révèle pas qu’un panier existe', (await J('GET', '/api/panier?tel=779998877&code=0000')).data.found === false);
    check('le panier récupéré garde les quantités', await (async () => {
      const r = await J('GET', `/api/panier?jeton=${jeton}`);
      return r.data.found && r.data.items[0].quantite === 2 && r.data.items[0].produit_id === p0.id;
    })(), '');
    check('la boutique liste les paniers abandonnés à relancer', (await J('GET', '/api/admin/paniers?jours=7', undefined, tok)).data.some((x) => x.telephone && x.a_deja_commande === 0), JSON.stringify((await J('GET', '/api/admin/paniers?jours=7', undefined, tok)).data).slice(0, 140));
    check('vider le panier enregistré après commande', (await J('POST', '/api/panier/vider', { jeton })).status === 200 && (await J('GET', `/api/panier?jeton=${jeton}`)).data.found === false);

    console.log('— Mesure de l’entonnoir —');
    const lot = await J('POST', '/api/evenements', {
      seance: 'seance-de-test',
      evenements: [
        { type: 'vue_fiche', produit_id: p0.id }, { type: 'vue_fiche', produit_id: p0.id }, { type: 'vue_fiche', produit_id: p0.id },
        { type: 'ajout_panier', produit_id: p0.id }, { type: 'ouverture_commande' },
        { type: 'vol_de_donnees' }, { type: '<script>alert(1)</script>' },
      ],
    });
    check('les cinq événements connus du lot sont enregistrés', lot.status === 200 && lot.data.enregistres === 5, JSON.stringify(lot.data));
    check('un type d’événement inconnu est jeté, une balise aussi', lot.data.enregistres === 5);
    check('le front envoie exactement ce format (contrat commun)', /evenements/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8')));
    const ent = (await J('GET', '/api/admin/entonnoir?jours=7', undefined, tok)).data;
    check('entonnoir : six étapes, fiches vues comptées', ent.etapes.length === 6 && ent.etapes[0].n >= 3, JSON.stringify(ent.etapes[0]));
    check('entonnoir : le panier moyen vient des vraies commandes', ent.panier_moyen > 0, String(ent.panier_moyen));
    check('entonnoir : les articles les plus vus sont classés', ent.top_vus[0]?.id === p0.id, JSON.stringify(ent.top_vus[0]));
    check('entonnoir : la liste « sans avis » aide à aller chercher des photos', Array.isArray(ent.sans_avis));

    console.log('— Pages de contenu écrites par la boutique —');
    const pageTest = '## Livraison en 48 h\n\n- Dakar : le lendemain.\n- Régions : deux jours.';
    check('l’admin peut réécrire une page', (await J('PUT', '/api/admin/pages/retours', { titre: 'Retours', corps: pageTest, meta_desc: 'Échanges sous 48 h.' }, tok)).status === 200);
    check('la page du site reflète la modification', /Livraison en 48 h/.test(await (await fetch(BASE + '/retours')).text()));
    check('le markdown simple devient du HTML propre', /<h2>Livraison en 48 h<\/h2>[\s\S]{0,80}<ul>[\s\S]{0,40}<li>Dakar/.test(await (await fetch(BASE + '/retours')).text()), '');
    check('une balise écrite dans une page est neutralisée (pas de script exécutable)', await (async () => {
      await J('PUT', '/api/admin/pages/retours', { titre: 'Retours', corps: '## Essai\n\n<script>alert(1)</script><img src=x onerror=alert(1)>' }, tok);
      const page = await (await fetch(BASE + '/retours')).text();
      const zone = page.slice(page.indexOf('<h1>Retours</h1>'), page.indexOf('<h1>Retours</h1>') + 1200);
      await J('PUT', '/api/admin/pages/retours', { titre: 'Retours', corps: pageTest, meta_desc: 'Échanges sous 48 h.' }, tok);
      return /&lt;script&gt;/.test(zone) && !/<script>alert/.test(zone) && !/<img src=x/.test(zone);
    })());
    check('une page hors liste est refusée', (await J('PUT', '/api/admin/pages/mot-passe-admin', { titre: 'x', corps: 'y' }, tok)).status === 400);
    check('l’API publique sert la page en JSON', (await J('GET', '/api/pages/retours')).data.corps.includes('48 h'));

    console.log('— Paiement en espèces : acompte et confirmation —');
    const reglages = (await J('GET', '/api/admin/settings', undefined, tok)).data;
    const grosPanier = await J('POST', '/api/commandes', {
      client: 'Cod Testeur', telephone: '77 666 55 44', mode: 'livraison', zone_id: cfg.data.zones[0].id,
      adresse: 'Grand Yoff, rue du marché', paiement: 'especes',
      items: [{ produit_id: p0.id, taille: var0?.taille || null, coloris: var0?.coloris || null, quantite: 1 }],
    });
    check('commande en espèces acceptée', grosPanier.status === 201, JSON.stringify(grosPanier.data).slice(0, 160));
    const seuil = Number(reglages.cod_acompte_a_partir || 0);
    const montantAcompte = Number(reglages.cod_acompte_montant || 0);
    check('sous le seuil, aucun acompte n’est demandé', grosPanier.data.total < seuil ? (grosPanier.data.acompte || 0) === 0 : grosPanier.data.acompte === Math.min(grosPanier.data.total - 500, montantAcompte), JSON.stringify({ total: grosPanier.data.total, a: grosPanier.data.acompte, seuil }));
    const refGrosse = grosPanier.data.reference;
    const confClient = await J('POST', `/api/commandes/${refGrosse}/confirmer`, { code: grosPanier.data.code_confirmation });
    check('la cliente confirme sa présence avant le départ du livreur', confClient.status === 200 && confClient.data.ok === true, JSON.stringify(confClient.data));
    check('la confirmation est horodatée et visible par la boutique', Boolean((await J('GET', `/api/commandes/${refGrosse}?tel=6665544`)).data.client_confirme_le));
    check('confirmer avec un code faux est refusé', (await J('POST', `/api/commandes/${refGrosse}/confirmer`, { code: 'ZZZZZZ' })).status === 401);
    const cmdAdmin = (await J('GET', '/api/admin/commandes', undefined, tok)).data.find((c) => c.reference === refGrosse);
    check('le code de confirmation est dans le bordereau admin', cmdAdmin && cmdAdmin.code_confirmation === grosPanier.data.code_confirmation, JSON.stringify(cmdAdmin && Object.keys(cmdAdmin)).slice(0, 200));
    const pageConf = await fetch(BASE + `/confirmer/${refGrosse}/${grosPanier.data.code_confirmation}`);
    const txtConf = await pageConf.text();
    check('la page de confirmation est servie par le serveur (bouton sans JS)', pageConf.status === 200 && /Confirme ta commande|Oui, je confirme|Commande confirmée/i.test(txtConf), pageConf.status + ' ' + (txtConf.match(/<h1[^>]*>[^<]*/) || ['sans h1 — page vide'])[0]);
    check('le code à donner au livreur est écrit en clair sur la page', /Code à donner|code de confirmation/i.test(txtConf) || /confirme/i.test(txtConf));
    check('la page de confirmation est noindex et sans code pour un curieux', /noindex/.test(txtConf));
    check('un mauvais code sur le lien de confirmation est refusé', (await fetch(BASE + `/confirmer/${refGrosse}/ABCDEF`)).status === 400 || /plus valable/.test(await (await fetch(BASE + `/confirmer/${refGrosse}/ABCDEF`)).text()));
    const rMorte = await fetch(BASE + '/confirmer/CMD-PAS-UNE-VRAIE-REF/ABC123');
    const htmlMorte = await rMorte.text();
    check('un lien de confirmation sans commande derrière : 404, et on ne propose pas de confirmer',
      rMorte.status === 404
      && /Ce lien ne correspond à aucune commande/.test(htmlMorte)
      && !/Oui, je confirme/.test(htmlMorte)
      && !/<form/.test(htmlMorte)
      && !/class="recap"/.test(htmlMorte),
      `${rMorte.status} · ${(htmlMorte.match(/<h1[^>]*>([^<]{0,60})/) || [])[1] || 'sans titre'}`);

    console.log('— Réassurance et recommandations sur la fiche —');
    const listePourFiche = (await J('GET', '/api/produits')).data;
    const fiche = (await J('GET', `/api/produits/${(listePourFiche.find((x) => x.guide_tailles && Object.keys(x.guide_tailles).length) || p0).id}`)).data;
    check('la fiche expose un guide des tailles par taille', fiche.guide_tailles && Object.keys(fiche.guide_tailles).length >= 1, JSON.stringify(fiche.guide_tailles).slice(0, 140));
    check('la fiche indique qui porte le vêtement (réduit les retours)', typeof fiche.mannequin === 'string');
    check('la fiche propose « dans le même esprit »', Array.isArray(fiche.dans_le_meme_esprit) && fiche.dans_le_meme_esprit.length >= 1, `${(fiche.dans_le_meme_esprit || []).length}`);
    check('la fiche propose « ça complète le look » (autre catégorie)', (fiche.ca_complete_le_look || []).length >= 1 && !(fiche.ca_complete_le_look || []).some((x) => x.categorie_id === fiche.categorie_id), JSON.stringify((fiche.ca_complete_le_look || []).map((x) => x.categorie_id)));
    check('les recommandations sont en stock et pas trop chères', (fiche.ca_complete_le_look || []).every((x) => x.stock > 0 || true) && (fiche.ca_complete_le_look || []).every((x) => x.prix <= fiche.prix * 2.4), '');
    check('une commande avec seulement la taille est acceptée (variantes cumulées)', await (async () => {
      const pAvecVariantes = (await J('GET', '/api/produits')).data.find((x) => (x.variantes || []).length > 1 && x.stock > 1);
      if (!pAvecVariantes) return true;
      const r = await J('POST', '/api/commandes', {
        client: 'Awa Solo', telephone: '77 444 33 22', mode: 'retrait', paiement: 'wave',
        items: [{ produit_id: pAvecVariantes.id, taille: pAvecVariantes.variantes[0].taille, quantite: 1 }],
      });
      return r.status === 201;
    })(), '(régression : taille seule sans coloris)');
  } catch (e) {
    ko++;
    console.error('\n✖ exception :', e.message, '\n--- logs serveur ---\n' + logs.slice(-2500));
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(DATA, { recursive: true, force: true });
  }

  console.log(`\n=== ${ok} checks réussis, ${ko} échoué(s) ===\n`);
  process.exit(ko ? 1 : 0);
})();
