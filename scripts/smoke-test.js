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
    check('produit : prix d’achat et lien fournisseur cachés', p0.prix_achat === undefined && p0.lien_source === undefined);

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
    check('le client ne voit ni prix d’achat ni lien', vu.data.lien_source === undefined && vu.data.prix_achat === undefined);
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
    check('thème : typographie — titres serif, micro-labels en capitales espacées', /--serif: "Hoefler Text", Didot/.test(cssPub) && /text-transform: uppercase; letter-spacing: \.12em/.test(cssPub));
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
