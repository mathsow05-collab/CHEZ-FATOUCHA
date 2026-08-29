/* ============================================================
   CHEZ FATOUCHA — front client (sans framework)
   URLs réelles : /  /boutique  /produit/<slug>  /categorie/<slug>  /panier
   /commande  /paiement/<REF>  /suivi  /faq  /retours  /favoris
   Les anciennes URLs en #/produit/5 continuent de marcher (elles sont
   remplacées par l'URL lisible dès que l'article est chargé).
   Le back-office est volontairement absent de ce fichier (et de tout ce que le
   navigateur de la cliente reçoit) : page privée, hors SPA, à son propre lien.
   ============================================================ */
const root = document.getElementById('app');
const state = {
  produits: [], vue: {}, filtreCat: null, filtreCatNom: null, q: '', tri: 'recent',
  taille: '', prixMin: '', prixMax: '', dispo: false, page: 1, totalVu: 0,
};

/* ---------------- utils DOM ---------------- */
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const money = fcfa;

/* ---------------- routage (chemins réels, hash accepte en legacy) ---------------- */
const ROUTES_SPA = /^\/(boutique|produit\/[a-z0-9_-]+|categorie\/[a-z0-9_-]+|panier|commande|commande\/[\w-]+|paiement\/[\w-]+|suivi|faq|retours|livraison|a-propos|favoris)([?#/]|$)/i;
const routeCourante = () => {
  const h = location.hash || '';
  if (/^#\/(boutique|produit|categorie|panier|commande|paiement|suivi|faq|retours|favoris)/.test(h)) return h.replace(/^#/, '');
  return (location.pathname || '/') + (location.search || '');
};
/* La racine « / » est un chemin de l'application à part entière (sinon, cliquer
   le logo rechargerait toute la page alors que le routeur sait la dessiner). */
const cheminDeSPA = (c) => c === '/' || ROUTES_SPA.test(c);
/* scrollIntoView n'existe pas partout (navigateurs anciens, environnements de
   test) : on ne laisse pas un détail de défilement casser un clic. */
const faireDefiler = (elm, opts) => {
  if (!elm || typeof elm.scrollIntoView !== 'function') return;
  try { elm.scrollIntoView(opts); } catch { /* silencieux */ }
};

const hashPath = () => routeCourante();
const cheminDe = (h) => String(h || '').replace(/^#/, '') || '/';
function go(h) {
  const cible = cheminDe(h);
  if (!cheminDeSPA(cible) || !window.history || !history.pushState) { location.href = cible; return; }
  if (location.hash) history.replaceState(null, '', cible);
  if (cible !== routeCourante()) history.pushState(null, '', cible);
  render();
  window.scrollTo(0, 0);
}
const requete = () => Object.fromEntries(new URLSearchParams((location.search || (location.hash.split('?')[1] || ''))).entries());
/* Monogramme de la boutique (deux initiales) — plus « maison de mode » qu'un emoji. */
const monogramme = () => (Shop.cfg?.nom_boutique || 'CHEZ FATOUCHA').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join('').toUpperCase() || 'CF';
const img = (p) => p.image || (p.images && p.images[0]?.url) || '/media/demo/robe-boheme.svg';

function topbar(active = '') {
  return `
  <header class="top">
    <div class="wrap bar">
      <a class="brand" href="/" data-spa>
        <span class="logo" aria-hidden="true">${esc(monogramme())}</span>
        <span><b>${esc(Shop.cfg?.nom_boutique || 'CHEZ FATOUCHA')}</b><small>Dakar · Livraison & retrait</small></span>
      </a>
      <nav class="main" aria-label="Navigation principale">
        <a href="/boutique"${active === 'boutique' ? ' aria-current="page"' : ''} class="${active === 'boutique' ? 'on' : ''}" data-spa>Boutique</a>
        ${courtsConnus ? `<a href="/shorts"${active === 'shorts' ? ' aria-current="page"' : ''} class="${active === 'shorts' ? 'on' : ''}">Shorts</a>` : ''}
        <a href="/favoris"${active === 'favoris' ? ' aria-current="page"' : ''} class="${active === 'favoris' ? 'on' : ''}" data-spa>Favoris</a>
        <a href="/suivi"${active === 'suivi' ? ' aria-current="page"' : ''} class="${active === 'suivi' ? 'on' : ''}" data-spa>Suivre ma commande</a>
        <a href="/faq"${active === 'faq' ? ' aria-current="page"' : ''} class="${active === 'faq' ? 'on' : ''}" data-spa>Aide</a>
      </nav>
      <div class="actions">
        <button class="icon-btn" data-open-search title="Rechercher un article" aria-label="Rechercher un article">${icone('recherche', { taille: 18 })}<span class="libelle">Chercher</span></button>
        <a class="icon-btn" href="/panier" title="Panier" aria-label="Panier" data-spa>${icone('panier', { taille: 18 })}<span class="count" data-cart-count>0</span></a>
        <button class="burger" data-tiroir aria-expanded="false" aria-controls="tiroir" aria-label="Ouvrir le menu">${icone('menu', { taille: 20 })}</button>
      </div>
    </div>
  </header>
  <nav class="tiroir" id="tiroir" aria-label="Menu">
    <div class="tete"><b>${esc(Shop.cfg?.nom_boutique || 'CHEZ FATOUCHA')}</b>
      <button class="close" data-tiroir-x aria-label="Fermer le menu">${icone('croix')}</button></div>
    <a href="/boutique" data-spa>Boutique${icone('fleche', { taille: 16 })}</a>
    ${courtsConnus ? `<a href="/shorts">Shorts (${courtsConnus})${icone('lecture', { taille: 16 })}</a>` : ''}
    <a href="/favoris" data-spa>Favoris${icone('coeur', { taille: 16 })}</a>
    <a href="/suivi" data-spa>Suivre ma commande${icone('colis', { taille: 16 })}</a>
    <a href="/faq" data-spa>Questions fréquentes${icone('discuter', { taille: 16 })}</a>
    <a href="/panier" data-spa>Panier${icone('panier', { taille: 16 })}</a>
    <div class="base"><a class="btn gold block" href="https://wa.me/${esc(String(Shop.cfg?.whatsapp || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">${icone('whatsapp', { taille: 17 })} Écrire à la boutique</a></div>
  </nav>
  <div class="tiroir-fond" data-tiroir-fond aria-hidden="true"></div>
  <div class="marquee"><div class="wrap">
    <span>Livraison <b>Dakar dès 1 000 F</b> · régions dès <b>3 000 F</b></span>
    <span>Retrait boutique <b>offert</b></span>
    <span>Paiement <b>Wave</b> & <b>Orange Money</b></span>
    <span>Livraison offerte dès <b>${money(Shop.cfg?.livraison_gratuite_a_partir || 0)}</b></span>
  </div></div>`;
}

function footer() {
  const c = Shop.cfg || {};
  return `<footer class="ft"><div class="wrap cols">
    <div>
      <h4>${esc(c.nom_boutique || 'Chez Fatoucha')}</h4>
      <div>${esc(c.boutique_description || '')}</div>
      <div style="margin-top:10px">${icone('localisation', { taille: 14 })} ${esc(c.adresse_retrait || '')}<br>${icone('sablier', { taille: 14 })} ${esc(c.horaires_retrait || '')}</div>
    </div>
    <div>
      <h4>Aide</h4>
      <div class="stack" style="gap:6px">
        <a href="/suivi" data-spa>Suivre une commande</a>
        <a href="/retours" data-spa>Échanges & retours</a>
        <a href="/faq" data-spa>Questions fréquentes</a>
        <a href="/livraison" data-spa>Livraison & délais</a>
        <a href="https://wa.me/${esc((c.whatsapp || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp ${esc(c.telephone || '')}</a>
        <a href="/boutique" data-spa>Tous les articles</a>
      </div>
    </div>
    <div>
      <h4>Paiement</h4>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <span class="pill wave">Wave</span><span class="pill orange">Orange Money</span><span class="pill">Espèces à la livraison</span>
      </div>
      <div class="small pied-note">Prix en FCFA · livraison calculée selon ta zone (21 zones). Paiement Wave, Orange Money ou espèces à la livraison.</div>
    </div>
  </div></footer>`;
}

const lienProduit = (p) => (p && p.url) || (p ? '/produit/' + (p.slug || p.id) : '/boutique');

function card(p, options = {}) {
  const { compact = false } = options;
  const promo = p.prix_barre ? Math.round((1 - p.prix / p.prix_barre) * 100) : 0;
  const flags = [
    promo > 0 ? `<span class="flag promo">-${promo}%</span>` : '',
    p.en_rupture ? '<span class="flag out">Rupture</span>' : p.stock <= 3 && p.stock > 0 ? `<span class="flag rush">Plus que ${p.stock} !</span>` : '',
    p.vedette && !p.en_rupture ? '<span class="flag new">Vedette</span>' : '',
  ].filter(Boolean).join('');
  const note = p.avis && p.avis.nombre ? `<span class="note-mini">${etoiles(p.avis.moyenne)}<b>${p.avis.moyenne}</b><span class="muted">(${p.avis.nombre})</span></span>` : '';
  const lien = lienProduit(p);
  const photo = img(p);
  return `<article class="card${compact ? ' compact' : ''}${p.vedette && !compact ? ' ornee' : ''}" data-go="${esc(lien)}"${compact ? '' : ' data-reveal'}>
    <div class="ph glare squelette">
      <a class="lien-ph" href="${esc(lien)}" data-spa tabindex="-1" aria-hidden="true">${baliseImg(photo, p.titre, { largeurs: compact ? [220, 480] : [220, 480], sizes: compact ? '220px' : '(max-width:640px) 46vw, 260px' })}</a>
      <div class="flags">${flags}</div>
      <button class="cœur ${Favoris.contient(p.id) ? 'on' : ''}" data-fav="${p.id}" aria-label="${Favoris.contient(p.id) ? 'Retirer des favoris' : 'Garder dans mes favoris'}" title="Mes favoris">${icone("coeur", { taille: 17 })}</button>
    </div>
    <div class="body">
      <div class="t"><a href="${esc(lien)}" data-spa>${esc(p.titre)}</a></div>
      <div class="price">${money(p.prix)}${p.prix_barre ? `<s>${money(p.prix_barre)}</s>` : ''}</div>
      ${note}
      <div class="foot">
        <span class="mini">~${p.delai_jours} ${jplural(p.delai_jours)} · Dakar</span>
        <button class="add-mini" data-add="${p.id}" title="Ajouter au panier" aria-label="Ajouter ${esc(p.titre)} au panier" ${p.en_rupture ? 'disabled' : ''}>${icone("plus", { taille: 16 })}</button>
      </div>
    </div>
  </article>`;
}

/* Rangée horizontale (recommandations, sélection, favoris) : le carrousel
   tient sur un pouce, sans casser la mise en page du reste de la page. */
/* La tuile d'un Short : le rendu serveur la fait, l'hydratation doit la refaire
   à l'identique — sinon la rubrique apparaît puis disparaît sous les yeux. */
/* Combien de Shorts le catalogue chargé contient : la barre de navigation ne
   propose l'entrée que s'il y a de quoi la remplir. */
let courtsConnus = 0;
function marqueCourts(n) { courtsConnus = n; }

function tuileCourte(p) {
  const v = p.video || {};
  const visuel = v.miniature || img(p);
  return `<a class="short-tuile" href="${esc(lienProduit(p))}" data-short="${p.id}" aria-label="Regarder le Short de ${esc(p.titre)} — ${esc(v.etiquette || 'vidéo')}">
    <span class="short-visuel">${baliseImg(visuel, p.titre, { largeurs: [220, 480], sizes: '(max-width:640px) 44vw, 210px' })}</span>
    <span class="short-sceau" aria-hidden="true">${icone('lecture', { taille: 17 })}</span>
    <span class="short-legende"><b>${esc(p.titre)}</b><i>${money(p.prix)} · ${esc(v.etiquette || 'vidéo')}${p.categorie ? ' · ' + esc(p.categorie) : ''}</i></span>
  </a>`;
}

function rangCourts(produits) {
  const courtes = produits.filter((x) => x.video && x.video.format === 'vertical').slice(0, 10);
  if (!courtes.length) return '';
  return `<section class="blk rang shorts" id="shorts"><div class="wrap">
    <div class="blk-head"><div><span class="sur">Vu en vidéo</span><h2>Shorts de la boutique</h2>
      <p>Trois secondes de tissu qui bouge disent plus que trois photos fixes. Touche un Short pour le lire ici même.</p></div>
      <a class="link" href="/shorts">Tous les Shorts ${icone('fleche', { taille: 14 })}</a></div>
    <div class="short-rail">${courtes.map((x) => tuileCourte(x)).join('')}</div>
  </div></section>`;
}

function rangee(titre, sousTitre, produits, options = {}) {
  const { bouton = '', ancre = '', variante = '' } = options;
  if (!produits || !produits.length) return '';
  return `<section class="blk rang${variante ? ' ' + variante : ''}"${ancre ? ` id="${esc(ancre)}"` : ''}><div class="wrap">
    <div class="blk-head">
      <div><h2>${esc(titre)}</h2><p>${esc(sousTitre || '')}</p></div>
      ${bouton ? `<button class="link" data-vider-rang="${esc(bouton)}">Vider</button>` : `<a class="link" href="/boutique" data-spa>Tout voir ${icone('fleche', { taille: 15 })}</a>`}
    </div>
    <div class="rang-flèches">
      <button data-rail="gauche" aria-label="Faire défiler à gauche">${icone('fleche_gauche', { taille: 17 })}</button>
      <button data-rail="droite" aria-label="Faire défiler à droite">${icone('fleche', { taille: 17 })}</button>
    </div>
    <div class="rang-lignes">${produits.map((p) => card(p, { compact: true })).join('')}</div>
  </div></section>`;
}

/* ---------------- filtres du catalogue ---------------- */
/* Les filtres vivent dans l'URL : un lien « robes sous 15 000 F » se partage
   sur WhatsApp et retombe sur la même liste, et le rendu serveur les connaît. */
function lireFiltres() {
  const r = requete();
  if (r.q !== undefined) state.q = String(r.q).slice(0, 80);
  if (r.categorie !== undefined) state.filtreCat = r.categorie || null;
  if (r.tri) state.tri = String(r.tri);
  if (r.taille !== undefined) state.taille = String(r.taille).slice(0, 20);
  if (r.prix_min !== undefined) state.prixMin = String(r.prix_min).replace(/\D/g, '');
  if (r.prix_max !== undefined) state.prixMax = String(r.prix_max).replace(/\D/g, '');
  if (r.dispo !== undefined) state.dispo = r.dispo === '1';
  state.page = Math.max(1, Number(r.page) || 1);
}
function urlFiltres() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.filtreCat) p.set('categorie', state.filtreCat);
  if (state.tri && state.tri !== 'recent') p.set('tri', state.tri);
  if (state.taille) p.set('taille', state.taille);
  if (state.prixMin) p.set('prix_min', state.prixMin);
  if (state.prixMax) p.set('prix_max', state.prixMax);
  if (state.dispo) p.set('dispo', '1');
  if (state.page > 1) p.set('page', String(state.page));
  const s = p.toString();
  return '/boutique' + (s ? '?' + s : '');
}
function appliquerFiltres(patch) {
  Object.assign(state, patch);
  if (patch && 'page' in patch === false) state.page = 1;
  if (window.history && history.pushState) history.pushState(null, '', urlFiltres());
  render();
}

async function chargerBoutique() {
  /* « Voir plus » charge une liste cumulée (une seule requête, pas de trou). */
  const parPage = 24;
  const p = { limit: Math.min(60, parPage * state.page), page: 1 };
  if (state.filtreCat) p.categorie = state.filtreCat;
  if (state.q) p.q = state.q;
  if (state.tri) p.tri = state.tri;
  if (state.taille) p.taille = state.taille;
  if (state.prixMin) p.prix_min = state.prixMin;
  if (state.prixMax) p.prix_max = state.prixMax;
  if (state.dispo) p.dispo = '1';
  const filtreActif = ['q', 'categorie', 'taille', 'prix_min', 'prix_max', 'dispo'].some((k) => k in p);
  const [cats, produits, vedettes] = await Promise.all([
    API.get('/api/categories'),
    API.get('/api/produits?' + new URLSearchParams(p)),
    filtreActif || state.page > 1 ? Promise.resolve([]) : API.get('/api/produits/vedette').catch(() => []),
  ]);
  return { cats, produits, vedettes: filtreActif || state.page > 1 ? [] : vedettes, parPage };
}

/* ---------------- VUE : boutique ---------------- */
/* Une seule vue, deux visages : la page d'accueil (avec son héro éditorial et ses
   rails) et le catalogue (/boutique), qui doit rester ce que le serveur a déjà
   affiché — sinon la page « saute » d'un contenu à l'autre à l'hydratation. */
async function vueBoutique({ accueil = true } = {}) {
  const { cats, produits, vedettes, parPage } = await chargerBoutique();
  state.produits = produits;
  const dispo = produits.filter((p) => !p.en_rupture).length;
  const total = (await API.get('/api/stats').catch(() => ({}))).total || produits.length;
  const peutPlus = produits.length >= parPage && produits.length < total && produits.length < 60;
  const tailles = [...new Set(produits.flatMap((p) => p.tailles || []))].slice(0, 12);
  const filtresActifs = !!(state.q || state.filtreCat || state.taille || state.prixMin || state.prixMax || state.dispo || state.tri !== 'recent');
  const vus = Vu.lus().filter((x) => !produits.some((p) => p.id === x.id)).slice(0, 6);
  const favs = Favoris.liste().slice(0, 6);
  const tete = accueil ? `
  <section class="hero"><div class="wrap"><div class="inner spot">
    <div class="txt">
    <span class="sur shiny">Sélection &amp; pièces choisies · Dakar</span>
    <h1>La mode qui t’aime, <em>livrée à ta porte</em>.</h1>
    <p>Robes, ensembles, sacs, chaussures, parfums… choisis ta taille et ta quantité, paie par Wave ou Orange Money. On livre à Dakar et dans toutes les régions — ou tu viens retirer à la boutique.</p>
    <div class="cta">
      <a class="btn gold big" href="#boutique-grid" data-ancre data-aimant="8">Voir les ${total} articles</a>
      <a class="btn ghost big" href="/suivi" data-spa>Suivre ma commande</a>
    </div>
    <div class="stats">
      <div><b>${dispo}</b> articles disponibles</div>
      <div><b>24 h</b> livraison Dakar</div>
      <div><b>1 000 F</b> frais dès le quartier d’à côté</div>
      <div><b>Wave / OM</b> paiement direct</div>
    </div>
    </div>
    <figure class="visuel ornee">
      <img src="${urlImg('/media/demo/lookbook.jpg', 900)}" srcset="${srcsetImg('/media/demo/lookbook.jpg', [480, 900, 1200])}" sizes="(max-width:900px) 92vw, 460px" width="900" height="1200" fetchpriority="high" decoding="async" alt="Silhouette de la sélection Chez Fatoucha"
           onerror="this.closest('.visuel').style.display='none'" />
      <figcaption class="shiny">La sélection Fatoucha</figcaption>
    </figure>
  </div></div></section>` : `
  <section class="page-tete"><div class="wrap">
    <span class="sur">Catalogue</span>
    <h1>${state.q ? `Résultats pour « ${esc(state.q)} »` : state.filtreCat ? (cats.find((c) => String(c.id) === String(state.filtreCat))?.name || 'Catégorie') : 'Tous les articles'}</h1>
    <p>${produits.length} article(s)${dispo !== produits.length ? ` · ${dispo} en stock` : ''} · prix en FCFA, livraison calculée au panier</p>
  </div></section>`;

  marqueCourts(produits.filter((x) => x.video && x.video.format === 'vertical').length);
  return `
  ${topbar(accueil ? 'boutique' : 'boutique')}
  ${tete}
  <section class="blk"><div class="wrap">
    <div class="cats" id="cats">
      <button class="cat ${!state.filtreCat ? 'on' : ''}" data-cat="" aria-pressed="${!state.filtreCat}">Tout</button>
      ${cats.map((c) => `<button class="cat ${String(state.filtreCat) === String(c.id) ? 'on' : ''}" data-cat="${c.id}" aria-pressed="${String(state.filtreCat) === String(c.id)}">${puceCategorie(c.emoji)}${esc(c.name)} <span class="n">${c.n}</span></button>`).join('')}
    </div>
  </div></section>

  ${produits.length || filtresActifs ? `<section class="blk"><div class="wrap">
    <div class="filtres-bar">
      ${tailles.length ? `<div class="fl-tailles"><span class="lbl">Taille</span><div class="chips">
        ${tailles.map((t) => `<button class="chip ${state.taille === t ? 'on' : ''}" data-filtre-taille="${esc(t)}">${esc(t)}</button>`).join('')}
      </div></div>` : ''}
      <div class="fl-prix">
        <span class="lbl">Prix (FCFA)</span>
        <div class="row" style="gap:6px">
          <input class="inp" id="fl-min" type="number" min="0" step="500" placeholder="de" value="${esc(state.prixMin)}" aria-label="Prix minimum" />
          <input class="inp" id="fl-max" type="number" min="0" step="500" placeholder="jusqu’à" value="${esc(state.prixMax)}" aria-label="Prix maximum" />
          <button class="btn sm" data-filtre-prix>OK</button>
        </div>
      </div>
      <label class="sw"><input type="checkbox" id="fl-dispo" ${state.dispo ? 'checked' : ''} /> En stock seulement</label>
      ${filtresActifs ? '<button class="link" data-clear>Enlever les filtres</button>' : ''}
    </div>
  </div></section>` : ''}

  ${accueil && !filtresActifs ? rangCourts(produits) : ''}
  ${accueil && vedettes.length && !filtresActifs ? rangee('Sélection de Fatou', 'Les pièces qu’elle met en avant cette semaine.', vedettes, { variante: 'selection' }) : ''}
  ${accueil && favs.length ? rangee('Tes favoris', 'Gardés sur cet appareil — touche le cœur sur une fiche pour les retirer.', favs.map((f) => ({ ...f, avis: null })), { variante: 'favoris', bouton: 'favoris' }) : ''}

  <section class="blk" id="boutique-grid"><div class="wrap">
    <div class="blk-head">
      <div>
        <h2>${accueil ? (state.q ? `Résultats pour « ${esc(state.q)} »` : state.filtreCat ? cats.find((c) => String(c.id) === String(state.filtreCat))?.name || 'Catégorie' : 'Nouveautés & bons plans') : 'Toutes les pièces'}</h2>
        ${accueil ? `<p>${produits.length} article(s)${state.page > 1 ? ` · page ${state.page}` : ''} · prix en FCFA, livraison calculée au panier</p>` : `<p>${produits.length} pièce(s) en ligne${state.page > 1 ? ` · page ${state.page}` : ''}</p>`}
      </div>
      <div class="row">
        <select class="inp" id="tri" style="height:38px;padding:0 10px;width:auto" aria-label="Trier les articles">
          ${[['recent', 'Nouveautés'], ['prix_asc', 'Prix croissant'], ['prix_desc', 'Prix décroissant'], ['alpha', 'A → Z'], ['promo', 'Bons plans']]
            .map(([v, l]) => `<option value="${v}" ${state.tri === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    ${produits.length ? `<div class="grid">${produits.map((p) => card(p)).join('')}</div>`
      : `<div class="empty"><div class="big">${icone("recherche", { taille: 34 })}</div>Aucun article ne correspond.<br><button class="link" data-clear>Enlever les filtres</button></div>`}
    ${peutPlus ? `<div class="rang-pied"><button class="btn ghost" data-plus>Voir ${Math.min(24, total - produits.length)} articles de plus →</button></div>` : ''}
  </div></section>

  ${accueil && vus.length ? rangee('Vu récemment', 'Reprendre là où tu t’es arrêtée.', vus, { variante: 'vus', bouton: 'vus' }) : ''}
  ${footer()}`;
}

/* ---------------- VUE : favoris ---------------- */
async function vueFavoris() {
  const favs = Favoris.liste();
  const produits = await Promise.all(favs.map((f) => API.get('/api/produits/' + (f.slug || f.id)).catch(() => null)));
  const vivants = produits.filter(Boolean);
  return `
  ${topbar('favoris')}
  <div class="wrap" style="padding:24px 16px 60px">
    <h1>Mes favoris</h1>
    <p class="small muted">${favs.length} article(s) gardés sur cet appareil. Rien n’est envoyé à la boutique tant que tu ne commandes pas.</p>
    ${vivants.length ? `<div class="grid">${vivants.map((p) => card(p)).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn ghost sm" data-vider-rang="favoris">Vider mes favoris</button></div>`
      : `<div class="empty bloc"><div class="big">${icone("coeur", { taille: 34 })}</div><h3>Aucun favori pour l’instant</h3>
         <p>Sur une fiche, touche le cœur : l’article restera ici, le temps de réfléchir.</p>
         <a class="btn gold big" href="/boutique" data-spa>Voir la boutique</a></div>`}
  </div>${footer()}`;
}

/* ---------------- VUE : page de contenu (FAQ, retours, livraison, à-propos) ---------------- */
async function vueContenu(slug) {
  let page;
  try { page = await API.get('/api/pages/' + encodeURIComponent(slug)); }
  catch { return `<div class="wrap" style="padding:40px 16px"><h1>Page introuvable</h1><a class="btn" href="/boutique" data-spa>← Retour à la boutique</a></div>`; }
  document.title = page.titre + ' — ' + (Shop.cfg?.nom_boutique || 'CHEZ FATOUCHA');
  return `
  ${topbar(slug === 'faq' ? 'faq' : '')}
  <section class="blk"><div class="wrap page">
    <h1>${esc(page.titre)}</h1>
    ${slug === 'faq' ? `<div class="acc">${markdown(page.corps)}</div>` : markdown(page.corps)}
    <div class="row" style="margin-top:22px;flex-wrap:wrap">
      <a class="btn ghost" href="/boutique" data-spa>Voir la boutique</a>
      <a class="btn gold" href="https://wa.me/${esc((Shop.cfg?.whatsapp || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">${icone("whatsapp", { taille: 16 })} Demander à la boutique</a>
    </div>
  </div></section>
  ${footer()}`;
}

/* ---------------- VUE : fiche produit ---------------- */
async function vueProduit(cle) {
  let p;
  try { p = await API.get('/api/produits/' + encodeURIComponent(cle)); }
  catch {
    return `<div class="wrap" style="padding:60px 16px"><h1>Article indisponible</h1>
      <p>Cet article n’est plus au catalogue — il est peut-être juste épuisé pour le moment.</p>
      <a class="btn gold" href="/boutique" data-spa>← Retour à la boutique</a></div>`;
  }
  /* un lien #/produit/5 ou /produit/5 devient l'URL lisible, sans rechargement */
  if (p.slug && location.pathname.indexOf('/' + p.slug) === -1 && window.history && history.replaceState && !location.hash) {
    history.replaceState(null, '', '/produit/' + p.slug);
  }
  state.vue = { p, taille: p.tailles[0] || null, coloris: p.coloris[0] || null, qte: 1, idx: 0, zoom: false };
  Vu.noter(p);
  Mesure.envoyer('vue_fiche', p.id, p.slug || String(p.id));
  const images = p.images.length ? p.images : [{ url: '/media/demo/robe-boheme.svg', legende: null }];
  const promo = p.prix_barre ? Math.round((1 - p.prix / p.prix_barre) * 100) : 0;
  const nb = p.avis?.nombre || 0;
  const note = p.avis?.moyenne || 0;
  const guide = p.guide_tailles && Object.keys(p.guide_tailles).length ? p.guide_tailles : null;
  /* la fiche reçoit `video` déjà reconnue par le serveur (fournisseur, cadre
     d'intégration, miniature) : le lien brut collé dans l'espace vendeur ne
     sert plus jamais à construire une adresse ici. */
  const video = p.video || null;
  return `
  ${topbar('boutique')}
  <div class="wrap fil-ariane">
    <a href="/boutique" data-spa>Boutique</a>${p.categorie ? ` › <a href="/boutique?categorie=${p.categorie_id}" data-spa>${esc(p.categorie)}</a>` : ''} › <span>${esc(p.titre)}</span>
  </div>
  <div class="wrap" style="padding-top:4px">
    <div class="pd">
      <div class="gallery">
        <button class="main" data-zoom aria-label="Zoomer sur la photo (ou pincer sur mobile)">
          <img id="gal-main" src="${esc(images[0].grande || urlImg(images[0].url, 900))}"${images[0].srcset ? ` srcset="${esc(images[0].srcset)}"` : ''} sizes="(max-width:900px) 94vw, 520px" width="900" height="1200" fetchpriority="high" decoding="async" alt="${esc(images[0].legende || p.titre)}"
               onerror="this.src='/media/demo/robe-boheme.svg'" />
          <span class="loupe" aria-hidden="true">${icone('zoom', { taille: 16 })}</span>
        </button>
        ${images.length > 1 || (p.video && p.video.cadre) ? `<div class="thumbs">${images.map((im, i) => `<button data-thumb="${i}" class="${i === 0 ? 'on' : ''}" aria-label="Photo ${i + 1}${im.legende ? ' : ' + esc(im.legende) : ''}"><img src="${esc(im.miniature || urlImg(im.url, 220))}" alt="" loading="lazy" onerror="this.parentElement.remove()" /></button>`).join('')}${p.video && p.video.cadre ? `<a class="thumb-vod" href="${esc(p.video.page)}" target="_blank" rel="noopener" data-vod aria-label="Vidéo de l’article (${esc(p.video.etiquette)})"><img src="${esc(p.video.miniature || images[0].url)}" alt="" loading="lazy" /><span class="vod-badge">${icone('lecture', { taille: 16 })}</span></a>` : ''}</div>
          <div class="gal-compte"><span id="gal-i">1</span> / ${images.length}${p.video && p.video.cadre ? ' · +1 vidéo' : ''}${images[0].legende ? ` · ${esc(images[0].legende)}` : ''}</div>` : ''}
        ${carteVideo(p, images)}
        <div class="gal-actions">
          <button class="link" data-partage>${icone("partager", { taille: 15 })} Partager</button>
          <button class="link ${Favoris.contient(p.id) ? 'on' : ''}" data-fav="${p.id}">${icone("coeur", { taille: 15 })} ${Favoris.contient(p.id) ? 'Dans tes favoris' : 'Garder'}</button>
          <a class="link" href="https://wa.me/${esc((Shop.cfg?.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent(`Salam ! Je suis intéressée par « ${p.titre} » (${money(p.prix)}) — ${location.origin}/produit/${p.slug || p.id}`)}" target="_blank" rel="noopener" data-mesure="clic_whatsapp">${icone('whatsapp', { taille: 16 })} Demander une photo réelle</a>
        </div>
      </div>

      <div class="stack">
        <div>
          <div class="row" style="gap:6px;margin-bottom:6px">
            ${p.en_rupture ? '' : `<span class="pill">${monogramme()} sélection</span>`}
            ${promo ? `<span class="pill red">-${promo}%</span>` : ''}
            ${p.en_rupture ? '<span class="pill red">Rupture de stock</span>' : `<span class="pill teal">${p.stock <= 3 ? `Plus que ${p.stock} en stock` : 'Disponible'}</span>`}
          </div>
          <h1>${esc(p.titre)}</h1>
          <div class="pricebox">
            <span class="price" id="pd-price">${money(p.prix)}</span>
            ${p.prix_barre ? `<s class="muted">${money(p.prix_barre)}</s>` : ''}
          </div>
          <div class="pd-note" id="pd-note">
            ${nb ? `<a class="lien-avis" href="#avis" data-ancre>${etoiles(note)}<b>${note}/5</b><span class="muted">· ${nb} avis</span></a>` : '<span class="lien-avis muted">Aucun avis pour l’instant — sois la première à noter.</span>'}
          </div>
        </div>

        ${p.mannequin ? `<div class="puce-mannequin">${icone("regle", { taille: 15 })} ${esc(p.mannequin)}</div>` : ''}

        ${p.tailles.length ? `<div class="opt"><span class="lbl">Taille</span><div class="chips" id="pd-tailles">
          ${p.tailles.map((t) => `<button class="chip ${state.vue.taille === t ? 'on' : ''}" data-taille="${esc(t)}" ${stockPour(p, t, state.vue.coloris) === 0 ? 'disabled' : ''}>${esc(t)}</button>`).join('')}
        </div>
        <div class="opt-aide">${guide ? `<button class="link" data-guide>${icone("regle", { taille: 15 })} Guide des tailles (cm)</button>` : ''}${guide ? `<button class="link" data-trouve>✦ Trouver ma taille</button>` : ''}</div>
        </div>` : ''}
        ${p.coloris.length ? `<div class="opt"><span class="lbl">Coloris</span><div class="chips" id="pd-coloris">
          ${p.coloris.map((c) => `<button class="chip swatch ${state.vue.coloris === c ? 'on' : ''}" data-coloris="${esc(c)}"><span class="dot" style="background:${esc(teinte(c))}"></span>${esc(c)}</button>`).join('')}
        </div></div>` : ''}

        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="qty">
            <button data-q="-1" aria-label="Un de moins">−</button><span id="pd-qte">1</span><button data-q="1" aria-label="Un de plus">+</button>
          </div>
          <div class="small muted" id="pd-dispo"></div>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn gold big grow" data-buy ${p.en_rupture ? 'disabled' : ''}>Ajouter au panier</button>
          <button class="btn big" data-buynow ${p.en_rupture ? 'disabled' : ''}>Commander</button>
        </div>
        ${p.en_rupture ? `<div class="bloc alerte-box">
          <b>Cet article est épuisé.</b>
          <p class="small muted" style="margin:4px 0 8px">Laisse ton numéro : on t’écrit sur WhatsApp dès que la pièce revient (en général 5 à 10 jours).</p>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <input class="inp" id="al-tel" inputmode="tel" placeholder="77 123 45 67" aria-label="Ton numéro" />
            <button class="btn gold" data-alerte>Préviens-moi</button>
          </div>
          <div id="al-out"></div>
        </div>` : ''}
        <p class="small muted" style="margin:0">Prix en FCFA · la livraison s’ajoute selon ta zone (gratuite si tu viens retirer).</p>

        ${p.description ? `<div class="bloc"><h3>Description</h3><div class="desc">${esc(p.description)}</div></div>` : ''}
        ${guide ? `<details class="bloc guide-box" id="pd-guide"><summary>Guide des tailles — mesures en centimètres</summary>
          <table class="guide"><thead><tr><th scope="col">Taille</th>${Object.values(guide).some((m) => m.poitrine) ? '<th scope="col">Poitrine</th>' : ''}${Object.values(guide).some((m) => m.taille) ? '<th scope="col">Tour de taille</th>' : ''}${Object.values(guide).some((m) => m.hanches) ? '<th scope="col">Hanches</th>' : ''}${Object.values(guide).some((m) => m.longueur) ? '<th scope="col">Longueur</th>' : ''}${Object.values(guide).some((m) => m.manche) ? '<th scope="col">Manche</th>' : ''}</tr></thead>
          <tbody>${Object.entries(guide).map(([t, m]) => `<tr><th scope="row">${esc(t)}</th>${['poitrine', 'taille', 'hanches', 'longueur', 'manche'].map((k) => (m[k] ? `<td>${m[k]} cm</td>` : (Object.values(guide).some((x) => x[k]) ? '<td>—</td>' : ''))).join('')}</tr>`).join('')}</tbody></table>
          <p class="small muted">Mesures du vêtement à plat, tour = ×2. Entre deux tailles : prends la plus grande, on échange sous 48 h.</p></details>` : ''}

        <div class="info-lines">
          <div class="li"><i>${icone('camion')}</i><div><b>Livraison</b> — article commandé au fournisseur sous ~${p.delai_jours} ${jplural(p.delai_jours)}, puis on te l’apporte : Dakar 24-36 h, régions 2-4 j.</div></div>
          <div class="li"><i>${icone('boutique')}</i><div><b>Retrait gratuit</b> — ${esc(Shop.cfg?.adresse_retrait || '')} · ${esc(Shop.cfg?.horaires_retrait || '')}</div></div>
          <div class="li"><i>${icone('carte')}</i><div><b>Paiement</b> — Wave ou Orange Money (direct depuis le site), ou espèces à la livraison.</div></div>
          <div class="li"><i>${icone('echange')}</i><div><b>Échange</b> — taille non conforme ? <a class="link" href="/retours" data-spa>Notre politique</a> : 48 h pour nous écrire.</div></div>
        </div>
      </div>
    </div>
  </div>

  ${(p.dans_le_meme_esprit || []).length ? rangee('Dans le même esprit', 'Autres pièces de la catégorie, dans le même budget.', p.dans_le_meme_esprit) : ''}
  ${(p.ca_complete_le_look || []).length ? rangee('Ça complète le look', 'Le sac, les chaussures ou le parfum qui vont avec cette pièce.', p.ca_complete_le_look, { variante: 'look' }) : ''}

  <section class="blk" id="avis"><div class="wrap">
    <div class="blk-head">
      <div><h2>${nb ? `${nb} avis d’acheteuses` : 'Avis des acheteuses'}</h2>
        <p>${nb ? `Note moyenne ${note}/5 · seuls les articles reçus peuvent être notés.` : 'Personne n’a encore noté cet article.'}</p></div>
      <button class="btn sm" data-avis>${icone("crayon", { taille: 15 })} Laisser un avis</button>
    </div>
    ${nb ? `<div class="avis-resume"><div class="grosse-note"><b>${note}</b><span>/5</span></div>
      <div class="histo">${[5, 4, 3, 2, 1].map((n) => { const c = (p.avis_liste || []).filter((a) => a.note === n).length; return `<div><span>${n}★</span><i><b style="width:${nb ? Math.round((c / nb) * 100) : 0}%"></b></i><em>${c}</em></div>`; }).join('')}</div></div>` : ''}
    ${(p.avis_liste || []).length ? `<div class="avis-liste">${p.avis_liste.map(avisItem).join('')}</div>` : '<div class="small muted">Les avis publiés apparaîtront ici.</div>'}
    ${avisAvecPhotos(p).length ? `<div class="photos-avis">${avisAvecPhotos(p).map((a) => `<figure class="photo-avis">${baliseImg(a.photo, `Photo envoyée par ${a.prenom}`, { largeurs: [220, 480], sizes: '150px' })}<figcaption>${esc(a.prenom)}</figcaption></figure>`).join('')}</div>` : ''}
  </div></section>
  ${footer()}
  <div class="mobar"><div class="in">
    <button class="btn ghost big" data-buy ${p.en_rupture ? 'disabled' : ''}>Ajouter</button>
    <button class="btn gold big" data-checkout ${p.en_rupture ? 'disabled' : ''}>Commander · ${money(p.prix)}</button>
  </div></div>`;
}

function avisItem(a) {
  return `<article class="avis-item">
    <header><b>${esc(a.prenom)}</b>${a.achat_verifie ? '<span class="verif">achat vérifié</span>' : ''}<time>${dateFr(a.created_at).slice(0, 10)}</time></header>
    ${etoiles(a.note)}${a.taille ? `<div class="small muted">Taille commandée : ${esc(a.taille)}</div>` : ''}
    ${a.texte ? `<p>${esc(a.texte)}</p>` : ''}
    ${a.photo ? baliseImg(a.photo, `Photo envoyée par ${a.prenom}`, { largeurs: [220, 480], sizes: '220px' }) : ''}
    ${a.reponse ? `<div class="reponse"><b>La boutique</b> — ${esc(a.reponse)}</div>` : ''}
  </article>`;
}
const avisAvecPhotos = (p) => (p.avis_liste || []).filter((a) => a.photo).slice(0, 6);

function teinte(nom) {
  const n = String(nom).toLowerCase();
  const map = [['noir', '#111'], ['blanc', '#f7f7f7'], ['rouge', '#c62828'], ['bordeaux', '#6d1b2b'], ['bleu', '#1e5bb8'], ['nuit', '#1a2340'], ['beige', '#d9c4a3'], ['doré', '#d4a017'], ['dor', '#d4a017'], ['argent', '#b8bcc0'], ['vert', '#2e7d32'], ['kaki', '#6b6b2f'], ['rose', '#e91e63'], ['mauve', '#8e6bb1'], ['jaune', '#fbc02d'], ['orange', '#ef6c00'], ['violet', '#5e35b1'], ['gris', '#78909c'], ['marron', '#6d4c41'], ['ciel', '#8ecae6']];
  for (const [k, v] of map) if (n.includes(k)) return v;
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 55%)`;
}

/* ---------------- VUE : panier ---------------- */
async function vuePanier() {
  const items = Cart.read();
  /* Le code de reprise sert à retrouver son panier sur le téléphone du mari,
     chez la sœur à Thiès, ou après un téléphone cassé. On le laisse visible. */
  const codeReprise = localStorage.getItem('fatoucha_panier_code') || '';
  if (!items.length) {
    return `${topbar('boutique')}
      <div class="wrap" style="padding:40px 16px 60px">
        <div class="empty bloc"><div class="big">${icone("panier", { taille: 34 })}</div><h3>Ton panier est vide</h3>
        <p>Ajoute un article et choisis ta taille — on calcule la livraison tout de suite après.</p>
        <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px">
          <a class="btn gold big" href="/boutique" data-spa>Voir la boutique</a>
          <button class="btn ghost big" data-reprise>Retrouver un panier enregistré</button>
        </div>
        ${codeReprise ? `<p class="small muted" style="margin-top:10px">Ton panier est aussi gardé sur le serveur : code de reprise <span class="mono">${esc(codeReprise)}</span> (à donner avec ton numéro).</p>` : ''}
        </div>
      </div>${footer()}`;
  }
  const sous = Cart.subtotal();
  /* Le bon moment pour proposer le sac ou le parfum qui vont avec : le panier
     est déjà décidé et le budget est visible à l'écran. */
  let complement = [];
  try {
    const r = await API.get('/api/produits/' + items[0].produit_id + '/aussi');
    complement = (r.ca_complete_le_look || []).concat(r.dans_le_meme_esprit || [])
      .filter((x) => !items.some((i) => i.produit_id === x.id)).slice(0, 4);
  } catch { /* pas bloquant */ }
  return `${topbar('boutique')}
  <div class="wrap" style="padding:20px 16px 60px">
    <div class="row spread" style="flex-wrap:wrap;gap:8px">
      <h1 style="font-size:24px;margin:0">Mon panier <span class="muted small">(${items.length} ligne${items.length > 1 ? 's' : ''})</span></h1>
      <div class="row" style="gap:14px;align-items:baseline;flex-wrap:wrap">
        <button class="link" data-reprise>Retrouver un panier enregistré</button>
        ${codeReprise ? `<span class="small muted">Code de reprise : <span class="mono">${esc(codeReprise)}</span></span>` : ''}
      </div>
    </div>
    <div class="pd">
      <div class="bloc">
        ${items.map((i) => `
        <div class="cart-line">
          <div class="im"><img src="${esc(i.image || '/media/demo/robe-boheme.svg')}" alt="" onerror="this.src='/media/demo/robe-boheme.svg'" /></div>
          <div>
            <div class="nm">${esc(i.titre)}</div>
            <div class="vr">${i.taille ? 'Taille ' + esc(i.taille) + ' · ' : ''}${i.coloris ? esc(i.coloris) + ' · ' : ''}${money(i.prix)} / pièce · ~${i.delai_jours} j d’appro.</div>
            <div class="row" style="margin-top:8px">
              <div class="qty"><button data-cq="${esc(i.key)}" data-d="-1">−</button><span>${i.qte}</span><button data-cq="${esc(i.key)}" data-d="1">+</button></div>
              <button class="link" data-rm="${esc(i.key)}">Retirer</button>
            </div>
          </div>
          <div style="text-align:right"><b>${money(i.qte * i.prix)}</b></div>
        </div>`).join('')}
      </div>
      <div class="bloc" style="align-self:start;position:sticky;top:78px">
        <h3>Récapitulatif</h3>
        <div class="summary">
          <div class="l"><span>Sous-total</span><span>${money(sous)}</span></div>
          <div class="l"><span>Livraison</span><span id="sum-ship">à calculer</span></div>
          <div class="l tot"><span>Total</span><span>${money(sous)}</span></div>
        </div>
        <p class="small muted">La livraison dépend de ta zone (1 000 F à Dakar, 3 000 F – 5 000 F en régions) ou <b>gratuite</b> si tu retires en boutique.</p>
        <a class="btn gold big block" href="/commande" data-spa>Passer commande →</a>
        <a class="btn ghost block" href="/boutique" data-spa style="margin-top:8px">Continuer mes achats</a>
        ${sous < Number(Shop.cfg?.livraison_gratuite_a_partir || 0) ? `<div class="banner franchise">Plus que <b>${money(Number(Shop.cfg?.livraison_gratuite_a_partir || 0) - sous)}</b> et la livraison est offerte à Dakar.</div>` : ''}
      </div>
    </div>
  </div>
  ${complement.length ? rangee('Ça complète ton panier', 'Souvent ajouté avec ta sélection.', complement) : ''}
  ${footer()}`;
}

/* ---------------- VUE : commande / checkout ---------------- */
async function vueCommande() {
  const items = Cart.read();
  if (!items.length) { go('/panier'); return ''; }
  const cfg = await Shop.load();
  const last = JSON.parse(localStorage.getItem('fatoucha_client') || 'null');
  state.checkout = {
    client: last?.client || '', telephone: last?.telephone || '',
    mode: 'livraison', zone_id: last?.zone_id || null, adresse: last?.adresse || '',
    instructions: '', paiement: 'wave',
  };
  return `
  ${topbar('boutique')}
  <div class="wrap" style="padding:20px 16px 60px">
    <h1 style="font-size:24px">Finaliser la commande</h1>
    <div class="pd">
      <div class="stack">
        <div class="bloc stack">
          <h3>1 · Tes coordonnées</h3>
          <div class="mini-form">
            <div class="field"><label for="f-nom">Nom complet</label><input id="f-nom" class="inp" placeholder="Ex. Awa Diop" value="${esc(state.checkout.client)}" autocomplete="name" /></div>
            <div class="field"><label for="f-tel">Téléphone (Wave / Orange)</label><input id="f-tel" class="inp" placeholder="77 123 45 67" value="${esc(state.checkout.telephone)}" inputmode="tel" autocomplete="tel" /></div>
          </div>
        </div>

        <div class="bloc stack">
          <h3>2 · Comment tu récupères ?</h3>
          <div class="seg" id="seg-mode">
            <button data-mode="livraison" class="on">${icone("camion", { taille: 17 })} Livraison</button>
            <button data-mode="retrait">${icone("boutique", { taille: 17 })} Retrait boutique</button>
          </div>
          <div id="zone-box">
            <div class="opt"><span class="lbl">Zone de livraison</span>
              <div class="pick">
                <select id="f-zone" class="inp">
                  <option value="">— Choisis ta zone —</option>
                  ${['Dakar', 'Banlieue', 'Région'].map((ville) => {
                    const z = cfg.zones.filter((x) => x.ville === ville);
                    if (!z.length) return '';
                    return `<optgroup label="${ville}${ville === 'Dakar' ? ' (1 000 F – 2 000 F)' : ville === 'Banlieue' ? ' (2 000 F – 2 500 F)' : ' (3 000 F – 5 000 F)'}">
                      ${z.map((x) => `<option value="${x.id}">${esc(x.nom)} — ${money(x.frais)} · ${heures(x.delai_heures)}</option>`).join('')}
                    </optgroup>`;
                  }).join('')}
                </select>
              </div>
            </div>
            <div class="field" style="margin-top:12px"><label for="f-adresse">Adresse / repère</label>
              <textarea id="f-adresse" class="inp" placeholder="Ex. Pikine Sicage, en face de la pharmacie, villa bleue, dernier portail"></textarea></div>
          </div>
          <div id="retrait-box" class="hidden banner ok">${icone("boutique", { taille: 16 })} <div><b>Retrait gratuit</b> — ${esc(cfg.adresse_retrait || '')}<br><span class="small">${esc(cfg.horaires_retrait || '')}. On t’appelle dès que l’article est prêt.</span></div></div>
          <div class="field"><label for="f-instr">Précisions (optionnel)</label>
            <input id="f-instr" class="inp" placeholder="Ex. livrer après 17h, demander Aminata, code porte 12A…" /></div>
          <div id="eta-box" class="banner"></div>
        </div>

        <div class="bloc stack">
          <h3>3 · Paiement</h3>
          <div class="pick" id="pm-list">
            ${cfg.paiement_methodes.map((m) => `
              <label class="pm-card ${m.id === 'wave' ? 'on' : ''}" data-pm="${m.id}">
                <input type="radio" name="pm" value="${m.id}" ${m.id === 'wave' ? 'checked' : ''} class="hidden" />
                <span class="badge" style="background:${m.couleur}">${m.id === 'wave' ? 'W' : m.id === 'orange' ? 'OM' : 'ESP'}</span>
                <span class="grow">
                  <b>${esc(m.libelle)}</b>
                  <div class="small muted">${m.id === 'wave' ? 'Envoi direct dans l’app Wave, on valide à la réception.' : m.id === 'orange' ? 'Push Orange Money sur ton téléphone, code PIN.' : 'Tu règles au livreur ou au retrait.'}</div>
                </span>
                <span class="n" style="font-size:12px">${cfg.paiement_mode === 'cinetpay' && m.id !== 'especes' ? 'auto ✔' : 'manuel'}</span>
              </label>`).join('')}
          </div>
          ${cfg.paiement_mode === 'cinetpay'
            ? `<div class="banner ok">${icone('cadenas', { taille: 16 })} Paiement automatique activé : dès que tu paies, la commande passe en préparation sans attendre.</div>`
            : `<div class="banner warn">${icone('alerte', { taille: 16 })} Tu envoies l’argent au numéro de la boutique, la commande est validée dès confirmation (souvent en moins de 10 min).</div>`}
          <div id="co-acompte"></div>
          <div class="banner confiance-note">✔ Une fois la commande créée, on te donne un <b>lien de confirmation</b> à ouvrir sur WhatsApp. Tu appuies, et le livreur ne part que si tu es prête.</div>
        </div>
      </div>

      <div class="bloc" style="align-self:start;position:sticky;top:78px">
        <h3>Ta commande</h3>
        <div class="stack" style="gap:8px">
          ${items.map((i) => `<div class="row spread small"><span>${i.qte}× ${esc(i.titre.slice(0, 28))}${i.taille ? ' · ' + esc(i.taille) : ''}</span><b>${money(i.qte * i.prix)}</b></div>`).join('')}
        </div>
        <hr style="border:0;border-top:1px dashed var(--line);margin:12px 0" />
        <div class="summary">
          <div class="l"><span>Sous-total</span><span>${money(Cart.subtotal())}</span></div>
          <div class="l"><span>Livraison</span><span id="co-ship">—</span></div>
          <div class="l tot"><span>À payer</span><span id="co-total">${money(Cart.subtotal())}</span></div>
        </div>
        <button class="btn gold big block" id="btn-commande" style="margin-top:12px">Valider & payer →</button>
        <p class="small muted center" style="margin:8px 0 0">Aucun article n’est débité avant ta confirmation de paiement.</p>
        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
          <h4 style="font-size:13px">Dans ton panier</h4>
          ${items.map((i) => `<div class="cart-line" style="grid-template-columns:44px 1fr auto;padding:8px 0">
            <div class="im" style="width:44px;height:54px"><img src="${esc(i.image || '/media/demo/robe-boheme.svg')}" alt="" /></div>
            <div class="small">${esc(i.titre)}${i.taille ? `<div class="muted">Taille ${esc(i.taille)}</div>` : ''}</div>
            <div class="small"><b>${money(i.qte * i.prix)}</b></div></div>`).join('')}
        </div>
      </div>
    </div>
  </div>
  <div class="mobar"><div class="in">
    <span class="btn ghost big" style="pointer-events:none">À payer <b id="mob-total" style="margin-left:4px">${money(Cart.subtotal())}</b></span>
    <button class="btn gold big" id="btn-commande-2">Valider & payer</button>
  </div></div>${footer()}`;
}

function majFrais() {
  const c = state.checkout;
  const sous = Cart.subtotal();
  const frais = c.mode === 'livraison' ? Shop.frais(c.zone_id, sous) : 0;
  const total = sous + frais;
  const gratuit = c.mode === 'livraison' && frais === 0 && sous > 0;
  document.getElementById('co-ship').textContent = c.mode === 'retrait' ? 'Gratuit (retrait)' : gratuit ? 'Gratuite' : money(frais);
  document.getElementById('sum-ship') && (document.getElementById('sum-ship').textContent = 'à calculer');
  document.getElementById('co-total').textContent = money(total);
  document.getElementById('mob-total').textContent = money(total);
  const zone = Shop.zone(c.zone_id);
  const items = Cart.read();
  const delaiMax = items.reduce((m, i) => Math.max(m, i.delai_jours || 0), 0);
  const eta = document.getElementById('eta-box');
  if (eta) {
    if (c.mode === 'retrait' || !zone) {
      eta.className = 'banner';
      eta.innerHTML = c.mode === 'retrait'
        ? `<span class="ico-led">${icone('sablier', { taille: 15 })}</span> Retrait prévu ~<b>${delaiMax} ${jplural(delaiMax)}</b> après le paiement (le temps de recevoir l’article du fournisseur).`
        : `<span class="ico-led">${icone('sablier', { taille: 15 })}</span> Choisis ta zone pour estimer la date de réception.`;
    } else {
      eta.className = 'banner ok';
      eta.innerHTML = `${icone('sablier', { taille: 15 })} Estimation : approvisionnement ~<b>${delaiMax} ${jplural(delaiMax)}</b> + livraison <b>${heures(zone.delai_heures)}</b> → reçu dans ~<b>${delaiMax + Math.ceil(zone.delai_heures / 24)} jours</b>.`;
    }
  }
  /* Acompte sur les commandes en espèces : la pratique qui fait le plus chuter
     les commandes qui n'aboutissent pas, sans supprimer le paiement à la livraison. */
  const boite = document.getElementById('co-acompte');
  if (boite) {
    const seuil = Number(Shop.cfg?.cod_acompte_a_partir || 0);
    const montant = Number(Shop.cfg?.cod_acompte_montant || 0);
    const du = c.paiement === 'especes' && montant > 0 && (!seuil || total >= seuil);
    boite.innerHTML = du
      ? `<div class="banner warn">${icone("billets", { taille: 16 })} <b>Acompte de ${money(montant)}</b> à envoyer tout de suite par Wave, le reste — <b>${money(Math.max(0, total - montant))}</b> — au livreur. Le commentaire du transfert : ta référence de commande.</div>`
      : '';
  }
  const btn = document.getElementById('btn-commande');
  if (btn) btn.dataset.total = String(total);
  return { frais, total };
}

async function submitCommande(btn) {
  const c = state.checkout;
  c.client = document.getElementById('f-nom').value.trim();
  c.telephone = document.getElementById('f-tel').value.trim();
  c.adresse = document.getElementById('f-adresse')?.value.trim() || '';
  c.instructions = document.getElementById('f-instr')?.value.trim() || '';
  const { frais, total } = majFrais();
  if (c.client.length < 3) return toast('Écris ton nom complet.', 'ko');
  if (!/^(\+?221)?[\s.-]?(7[0678]\d|77\d)[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}$/.test(c.telephone.replace(/\s/g, '')) && c.telephone.replace(/\D/g, '').length < 9) {
    return toast('Numéro invalide — ex. 77 123 45 67.', 'ko');
  }
  if (c.mode === 'livraison' && !c.zone_id) return toast('Choisis ta zone de livraison.', 'ko');
  if (c.mode === 'livraison' && c.adresse.length < 6) return toast('Précise ton adresse / repère.', 'ko');
  if (state.soumission) return;
  state.soumission = true;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Enregistrement…';
  try {
    const r = await API.post('/api/commandes', {
      client: c.client, telephone: c.telephone, mode: c.mode, zone_id: c.zone_id,
      adresse: c.adresse, instructions: c.instructions, paiement: c.paiement,
      items: Cart.read().map((i) => ({ produit_id: i.produit_id, taille: i.taille, coloris: i.coloris, quantite: i.qte })),
    });
    localStorage.setItem('fatoucha_client', JSON.stringify({ client: c.client, telephone: c.telephone, zone_id: c.zone_id, adresse: c.adresse }));
    localStorage.setItem('fatoucha_pending', JSON.stringify({
      reference: r.reference, telephone: c.telephone, total: r.total,
      code_confirmation: r.code_confirmation || null, page_confirmation: r.page_confirmation || null,
      acompte: r.acompte || 0, reste_a_payer: r.reste_a_payer || 0, paiement: c.paiement,
    }));
    localStorage.setItem('fatoucha_last_ref', r.reference);
    localStorage.setItem('fatoucha_last_tel', c.telephone);
    Mesure.envoyer('commande_validee', null, r.reference);
    API.post('/api/panier/vider', { jeton: jetonPanier() }).catch(() => {});
    Cart.clear();
    toast('Commande ' + r.reference + ' créée ✔', 'ok');
    go('/paiement/' + r.reference);
    setTimeout(() => { state.soumission = false; }, 400);
  } catch (e) {
    toast(e.message || 'Impossible de créer la commande.', 'ko');
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ---------------- VUE : paiement ---------------- */
async function vuePaiement(ref) {
  const pend = JSON.parse(localStorage.getItem('fatoucha_pending') || 'null') || {};
  const cfg = await Shop.load();
  let cmd;
  try { cmd = await API.get('/api/commandes/' + encodeURIComponent(ref) + '?tel=' + encodeURIComponent(pend.telephone || '')); }
  catch { return `<div class="wrap" style="padding:40px 16px"><div class="bloc"><h2>Commande introuvable</h2><a class="btn" href="/" data-spa>Retour boutique</a></div></div>`; }
  if (cmd.statut_paiement === 'paye') return vuePaiementPaye(cmd, cfg);
  return `
  ${topbar('boutique')}
  <div class="wrap" style="padding:22px 16px 60px;max-width:720px">
    <div class="pay-hero">
      <div class="pill">Référence ${esc(cmd.reference)}</div>
      <div class="amt" style="margin-top:8px">${money(cmd.total)}</div>
      <div class="small muted">dont livraison ${money(cmd.frais)} · ${cmd.mode === 'retrait' ? 'retrait boutique' : esc(cmd.zone || '')}</div>
    </div>

    <div class="bloc stack" style="margin-top:16px">
      <h3>Payer avec ${cmd.paiement === 'orange' ? 'Orange Money' : cmd.paiement === 'especes' ? 'espèces' : 'Wave'}</h3>
      <div id="pay-actions" class="stack">
        ${cfg.paiement_mode === 'cinetpay'
          ? `<button class="btn big block ${cmd.paiement === 'orange' ? 'orange' : 'wave'}" data-pay>${icone("carte", { taille: 17 })} Payer ${money(cmd.total)} maintenant</button>
             <p class="small muted" style="margin:0">Tu seras renvoyé·e vers la page de paiement sécurisée : choisis <b>Wave</b> ou <b>Orange Money</b>, saisis ton numéro, puis ton code secret pour valider. La commande passe en préparation toute seule.</p>`
          : cmd.paiement === 'especes'
            ? `<div class="banner ok">${icone('billets', { taille: 16 })} Tu paies <b>à la livraison</b>. Tiens le montant prêt : le livreur ne rend pas toujours la monnaie.</div>`
            : `<div class="banner warn">${icone("alerte", { taille: 16 })} Envoie d’abord l’argent au numéro de la boutique, puis appuie sur « J’ai payé » : Fatou valide dès réception.</div>`}
      </div>
      ${cmd.paiement === 'especes' && (cmd.acompte || 0) > 0 ? `<div class="banner warn" style="margin-top:14px">${icone("billets", { taille: 16 })} <b>Acompte de ${money(cmd.acompte)}</b> à envoyer maintenant par Wave (numéro ${esc(cfg.wave_numero || 'à configurer')}), puis <b>${money(cmd.reste_a_payer || cmd.total)}</b> au livreur.</div>` : ''}
      ${cmd.client_confirme_le
        ? `<div class="banner ok" style="margin-top:14px">✔ Commande confirmée par toi le ${dateFr(cmd.client_confirme_le)} — on t’appelle avant que le livreur parte.</div>`
        : `<div class="bloc bloc-confirme" style="margin-top:14px">
             <h4 style="margin:0 0 4px">Tu seras bien là&nbsp;?</h4>
             <p class="small muted" style="margin:0 0 10px">Un appui sur ce bouton (ou sur le lien WhatsApp) et la boutique sait que ta commande est attendue. Ça évite une course perdue — et ça garde ta pièce réservée.</p>
             <div class="row" style="flex-wrap:wrap;gap:8px">
               <button class="btn gold" data-confirme>✔ Oui, je confirme</button>
               ${cmd.page_confirmation ? `<a class="btn ghost" href="${esc(cmd.page_confirmation)}">Ouvrir mon lien de confirmation</a>` : ''}
               <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${esc((cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Je confirme ma commande ' + cmd.reference + (cmd.code_confirmation ? ' — code ' + cmd.code_confirmation : '') + '.')}">${icone('whatsapp', { taille: 16 })} Confirmer par WhatsApp</a>
             </div>
             ${cmd.code_confirmation ? `<div class="code-conf"><span class="et">${cmd.paiement === 'especes' ? (cmd.mode === 'retrait' ? 'Code à donner en boutique' : 'Code à donner au livreur') : 'Code de confirmation'}</span><b>${esc(cmd.code_confirmation)}</b></div>` : ''}
             ${(cmd.acompte || 0) > 0 ? `<div class="small muted" style="margin-top:8px">Acompte déjà demandé : <b>${money(cmd.acompte)}</b> · reste <b>${money(cmd.reste_a_payer || cmd.total)}</b> ${cmd.mode === 'retrait' ? 'au retrait' : 'au livreur'}.</div>` : ''}
           </div>`}
      <div id="pay-manuel"></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">
        <button class="btn ghost sm" data-switch="wave" ${cmd.paiement === 'wave' ? 'disabled' : ''}>Basculer sur Wave</button>
        <button class="btn ghost sm" data-switch="orange" ${cmd.paiement === 'orange' ? 'disabled' : ''}>Basculer sur Orange Money</button>
        <a class="btn ghost sm" href="https://wa.me/${esc((cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Salam! Je viens de commander ' + cmd.reference + ' (' + cmd.total + ' F) sur le site.')}" target="_blank" rel="noopener">${icone('whatsapp', { taille: 16 })} Écrire à la boutique</a>
      </div>
      <hr style="border:0;border-top:1px dashed var(--line);margin:6px 0" />
      <div class="steps">
        <div><b>1.</b> Choisis Wave ou Orange Money, puis envoie ${money(cmd.total)} à ${esc(cmd.paiement === 'orange' ? cfg.orange_numero : cfg.wave_numero)}.</div>
        <div><b>2.</b> Mets la référence <span class="mono">${esc(cmd.reference)}</span> en commentaire du transfert.</div>
        <div><b>3.</b> Dès que Fatou valide, tu reçois l’appel/SMS et l’article part en préparation.</div>
        <div><b>4.</b> Livraison estimée : ${cmd.delai_estime_jours} ${jplural(cmd.delai_estime_jours)} après validation.</div>
      </div>
      <div class="row" style="flex-wrap:wrap">
        <a class="btn ghost sm" href="/commande/${esc(cmd.reference)}" data-spa>${icone("colis", { taille: 16 })} Voir le suivi</a>
        <button class="btn danger sm" data-cancel>Annuler la commande</button>
      </div>
    </div>
  </div>${footer()}`;
}

function vuePaiementPaye(cmd, cfg) {
  return `
  ${topbar('boutique')}
  <div class="wrap" style="padding:26px 16px 60px;max-width:640px">
    <div class="bloc center stack" style="padding:28px">
      <div class="sceau">${icone("check", { taille: 30 })}</div>
      <h2 style="margin:0">Paiement reçu — commande confirmée</h2>
      <p class="muted">Référence <b class="mono">${esc(cmd.reference)}</b> · ${money(cmd.total)}</p>
      <div class="banner ${cmd.statut === 'livree' ? 'ok' : ''}" style="text-align:left">${icone('sablier', { taille: 16 })} Livraison estimée dans ~<b>${cmd.delai_estime_jours} ${jplural(cmd.delai_estime_jours)}</b>${cmd.mode === 'retrait' ? ' — retrait : ' + esc(cfg.adresse_retrait || '') : ' — ' + esc(cmd.zone || '')}</div>
      <div class="row" style="justify-content:center">
        <a class="btn gold big" href="/commande/${esc(cmd.reference)}" data-spa>${icone("colis", { taille: 17 })} Suivre ma commande</a>
        <a class="btn ghost big" href="/" data-spa>Retour boutique</a>
      </div>
    </div>
  </div>${footer()}`;
}

/* ---------------- VUE : suivi ---------------- */
const STATUTS_SUIVI = [
  ['nouvelle', 'Commande reçue', 'En attente de paiement'],
  ['payee', 'Paiement validé', 'Fatou prépare ton colis'],
  ['en_preparation', 'En préparation', 'Article reçu du fournisseur / vérifié'],
  ['expediee', 'Expédiée', 'Le livreur est en route'],
  ['livree', 'Livrée', 'Profité ! Partage une photo sur WhatsApp'],
];

async function vueSuivi(ref = '', tel = '') {
  const cfg = await Shop.load();
  if (!ref) {
    return `${topbar('boutique')}
    <div class="wrap" style="padding:26px 16px 60px;max-width:520px">
      <div class="bloc stack">
        <h1 class="h-bloc">Suivre une commande</h1>
        <p class="small muted">Entre la référence reçue après ta commande (ex. <span class="mono">CMD-4K7Q-2M8P</span>) et ton numéro.</p>
        <div class="field"><label for="s-ref">Référence</label><input id="s-ref" class="inp mono" placeholder="CMD-XXXX-XXXX" value="${esc(localStorage.getItem('fatoucha_last_ref') || '')}" /></div>
        <div class="field"><label for="s-tel">Ton numéro</label><input id="s-tel" class="inp" placeholder="77 123 45 67" inputmode="tel" value="${esc(localStorage.getItem('fatoucha_last_tel') || '')}" /></div>
        <button class="btn gold big" id="btn-suivi">Rechercher</button>
        <div id="suivi-err"></div>
      </div>
    </div>${footer()}`;
  }
  let cmd;
  try { cmd = await API.get('/api/commandes/' + encodeURIComponent(ref) + '?tel=' + encodeURIComponent(tel || '')); }
  catch (e) { return `${topbar('boutique')}<div class="wrap" style="padding:26px 16px"><div class="banner ko">${esc(e.message)}</div><a class="btn ghost" href="/suivi" data-spa style="margin-top:10px">← Réessayer</a></div>${footer()}`; }
  const idx = STATUTS_SUIVI.findIndex((s) => s[0] === cmd.statut);
  return `${topbar('boutique')}
  <div class="wrap" style="padding:22px 16px 60px;max-width:720px">
    <div class="row spread" style="flex-wrap:wrap;gap:8px">
      <div><h1 style="font-size:21px;margin:0">Commande <span class="mono">${esc(cmd.reference)}</span></h1>
      <div class="small muted">${dateFr(cmd.created_at)} · ${cmd.mode === 'retrait' ? 'retrait boutique' : 'livraison ' + esc(cmd.zone || '')}</div></div>
      <span class="pill ${cmd.statut === 'annulee' ? 'red' : 'teal'}">${cmd.statut === 'annulee' ? 'Annulée' : 'Estimation ~' + cmd.delai_estime_jours + ' ' + jplural(cmd.delai_estime_jours)}</span>
    </div>

    <div class="bloc stack" style="margin-top:14px">
      ${cmd.statut === 'annulee' ? '<div class="banner ko">Cette commande a été annulée (paiement non reçu dans les temps ou demande client).</div>' : ''}
      ${cmd.statut_paiement !== 'paye' && cmd.statut !== 'annulee'
        ? `<div class="banner warn">${icone('carte', { taille: 16 })} Paiement de <b>${money(cmd.total)}</b> en attente. <a class="link" href="/paiement/${esc(cmd.reference)}" data-spa>Payer maintenant →</a></div>` : ''}
      <div class="tl">
        ${STATUTS_SUIVI.map((s, i) => `
          <div class="st ${i < idx ? 'done' : i === idx ? 'now' : ''}">
            <div class="dot">${i < idx ? '✓' : i === idx ? '●' : ''}</div>
            <div><h4>${s[1]}</h4><p>${s[2]}</p></div>
          </div>`).join('')}
      </div>
      <hr style="border:0;border-top:1px dashed var(--line)" />
      ${cmd.lignes.map((l) => `<div class="cart-line">
        <div class="im"><img src="${esc(l.image || '/media/demo/robe-boheme.svg')}" alt="" onerror="this.src='/media/demo/robe-boheme.svg'" /></div>
        <div><div class="nm">${esc(l.titre)}</div><div class="vr">${l.quantite}× ${money(l.prix_unitaire)}${l.taille ? ' · taille ' + esc(l.taille) : ''}${l.coloris ? ' · ' + esc(l.coloris) : ''} · ~${l.delai_jours} j</div></div>
        <div style="text-align:right"><b>${money(l.total_ligne)}</b></div></div>`).join('')}
      <div class="summary" style="margin-top:10px">
        <div class="l"><span>Sous-total</span><span>${money(cmd.sous_total)}</span></div>
        <div class="l"><span>Livraison</span><span>${cmd.frais ? money(cmd.frais) : 'gratuite'}</span></div>
        <div class="l tot"><span>${cmd.statut_paiement === 'paye' ? 'Payé' : 'À payer'}</span><span>${money(cmd.total)}</span></div>
      </div>
      ${!cmd.client_confirme_le && cmd.statut !== 'annulee' && cmd.statut !== 'livree'
        ? `<div class="banner ${cmd.paiement === 'especes' ? 'warn' : ''}">${cmd.paiement === 'especes'
            ? `<span class="ico-led">${icone('alerte', { taille: 15 })}</span> La boutique attend ton feu vert avant d’envoyer le livreur.`
            : 'Un mot pour dire que tu seras bien là, et la boutique prépare ton colis sereinement.'}
           <button class="link" data-confirme-ref="${esc(cmd.reference)}">Je confirme que je suis là</button>
           ${cmd.page_confirmation ? `<a class="link" href="${esc(cmd.page_confirmation)}" data-spa>ou mon lien de confirmation</a>` : ''}</div>` : ''}
      ${cmd.client_confirme_le ? `<div class="banner ok">✔ Confirmée par toi le ${dateFr(cmd.client_confirme_le)} — on t’appelle juste avant que le livreur parte.${cmd.paiement === 'especes' && cmd.reste_a_payer ? ` Prépare <b>${money(cmd.reste_a_payer)}</b>.` : ''}</div>` : ''}
      ${cmd.statut === 'livree' ? `<div class="bloc bloc-note">
        <h4 style="margin:0 0 4px">Comment c’était&nbsp;?</h4>
        <p class="small muted" style="margin:0 0 8px">Deux lignes et une photo de toi avec l’article : c’est ce qui rassure le plus les prochaines clientes.</p>
        ${cmd.lignes.filter((l) => l.produit_slug).slice(0, 2).map((l) => `<a class="btn sm gold" href="/produit/${esc(l.produit_slug)}?avis=1" data-spa data-note="${esc(l.produit_slug)}">Noter « ${esc(l.titre.slice(0, 26))} »</a>`).join(' ')}
      </div>` : ''}
      <div class="row" style="flex-wrap:wrap;margin-top:6px">
        <a class="btn ghost sm" href="https://wa.me/${esc((cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Commande ' + cmd.reference + ' — j’ai un souci / question.')}" target="_blank" rel="noopener">${icone('whatsapp', { taille: 16 })} WhatsApp</a>
        ${cmd.statut === 'nouvelle' && cmd.statut_paiement !== 'paye' ? '<button class="btn danger sm" data-cancel-ref="' + esc(cmd.reference) + '">Annuler</button>' : ''}
        <a class="btn sm ghost" href="/" data-spa>Nouvelle commande</a>
      </div>
    </div>
  </div>${footer()}`;
}

/* ---------------- routeur ---------------- */
async function render() {
  const path = routeCourante();
  const m = (re) => path.match(re);

  /* Une page que le routeur ne dessine pas — /shorts, /confirmer/<ref>/<code>,
     toute page ajoutée côté serveur — est LAISSÉE TELLE. Avant cette garde, le
     routeur la remplaçait par l'accueil : la page s'affichait puis s'effaçait
     sous les yeux, et « la rubrique n'apparaît pas » alors que le serveur
     l'avait bien envoyée. On se contente d'y brancher les gestes globaux. */
  if (!cheminDeSPA(path)) {
    try {
      await Shop.load();
      Cart.renderBadge();
      bind();
      if (typeof Mouvement !== 'undefined') { try { Mouvement.appliquer(root); } catch (e) { /* rien */ } }
    } catch (e) { /* une page lisible sans JavaScript le reste */ }
    return;
  }

  try {
    await Shop.load();
    lireFiltres();
    let html = '';
    if (m(/^\/$/) || m(/^\/boutique/) || m(/^\/categorie\/([^/?]+)/)) {
      const c = m(/^\/categorie\/([^/?]+)/);
      if (c) {
        const cats = await API.get('/api/categories');
        const trouve = cats.find((x) => String(x.slug || x.id) === c[1] || String(x.id) === c[1]);
        state.filtreCat = trouve ? String(trouve.id) : null;
      }
      html = await vueBoutique({ accueil: /^\/$/.test(path.split('?')[0]) });
    }
    else if (m(/^\/produit\/([^/?]+)/)) html = await vueProduit(m(/^\/produit\/([^/?]+)/)[1]);
    else if (m(/^\/panier/)) html = await vuePanier();
    else if (m(/^\/commande$/)) html = await vueCommande();
    else if (m(/^\/paiement\/([\w-]+)/)) html = await vuePaiement(m(/^\/paiement\/([\w-]+)/)[1]);
    else if (m(/^\/commande\/([\w-]+)/)) {
      const mm = m(/^\/commande\/([\w-]+)/);
      const tel = requete().tel || JSON.parse(localStorage.getItem('fatoucha_pending') || '{}').telephone || '';
      html = await vueSuivi(mm[1], tel);
    }
    else if (m(/^\/suivi/)) html = await vueSuivi();
    else if (m(/^\/favoris/)) html = await vueFavoris();
    else if (m(/^\/(faq|retours|livraison|a-propos)/)) html = await vueContenu(m(/^\/(faq|retours|livraison|a-propos)/)[1]);
    else html = await vueBoutique(); /* route connue du routeur mais sans vue dédiée (garde ci-dessus) */
    /* dernier filtre : si un texte saisi dans le back-office contient un emoji,
       il ressort en tracé dessiné — la boutique garde une seule langue graphique */
    root.innerHTML = typeof sansPictos === 'function' ? sansPictos(html) : html;
    bind(html);
    Cart.renderBadge();
    /* le mouvement est branché après chaque rendu : il ne doit jamais
       empêcher une page de s'afficher, d'où le try/catch. */
    if (typeof Mouvement !== 'undefined') { try { Mouvement.appliquer(root); } catch (e) { /* rien */ } }
    /* un vieux lien #/produit/5 est remplacé par l'URL lisible, sans rechargement */
    if (location.hash && window.history && history.replaceState) history.replaceState(null, '', routeCourante());
    Mesure.vider();
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="wrap" style="padding:40px 16px"><div class="banner ko">Le site n’arrive pas à joindre le serveur (${esc(e.message)}). Vérifie que le serveur tourne, puis recharge.</div></div>`;
  }
}

/* ---------------- événements ---------------- */
function bind() {
  const path = hashPath();

  /* Les liens internes restent dans l'application (aucun rechargement) mais
     gardent de vraies URLs — ce que les moteurs et WhatsApp savent lire. */
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const cible = a.getAttribute('href');
    if (!cheminDeSPA(cible) || a.target === '_blank') return;
    a.addEventListener('click', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      go(cible);
    });
  });

  document.querySelectorAll('[data-ancre]').forEach((a) =>
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const cible = document.querySelector(a.getAttribute('href'));
      if (cible) faireDefiler(cible, { behavior: 'smooth', block: 'start' });
    }));

  document.querySelectorAll('[data-go]').forEach((c) =>
    c.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-add]') || ev.target.closest('a') || ev.target.closest('[data-fav]') || ev.target.closest('button')) return;
      go(c.dataset.go);
    }));

  document.querySelectorAll('[data-fav]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = Number(b.dataset.fav);
      const p = (state.produits || []).find((x) => x.id === id) || state.vue?.p || { id };
      const ajoute = Favoris.basculer({ ...p, id });
      document.querySelectorAll(`[data-fav="${id}"]`).forEach((x) => x.classList.toggle('on', ajoute));
      toast(ajoute ? 'Gardé dans tes favoris ♥' : 'Retiré des favoris.', 'ok');
      if (/^\/favoris/.test(path)) render();
    }));

  document.querySelectorAll('[data-vider-rang]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.viderRang === 'favoris') Favoris.vider();
      else Vu.vider();
      render();
    }));

  document.querySelector('[data-plus]')?.addEventListener('click', () => { state.page += 1; render(); });
  document.querySelectorAll('[data-filtre-taille]').forEach((b) =>
    b.addEventListener('click', () => appliquerFiltres({ taille: state.taille === b.dataset.filtreTaille ? '' : b.dataset.filtreTaille })));
  document.querySelector('[data-filtre-prix]')?.addEventListener('click', () =>
    appliquerFiltres({ prixMin: document.getElementById('fl-min')?.value || '', prixMax: document.getElementById('fl-max')?.value || '' }));
  document.getElementById('fl-dispo')?.addEventListener('change', (e) => appliquerFiltres({ dispo: e.target.checked }));

  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = Number(b.dataset.add);
      let p = state.produits.find((x) => x.id === id);
      if (!p) p = await API.get('/api/produits/' + id);
      if (p.tailles?.length || p.coloris?.length) return go('/produit/' + id);
      Cart.add(p, { quantite: 1 });
      toast('Ajouté au panier ✔ ' + p.titre, 'ok');
      if (typeof Mouvement !== 'undefined') Mouvement.voler(btn, document.querySelector('[data-cart-count]'));
    }));

  document.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => { state.filtreCat = b.dataset.cat || null; appliquerFiltres({}); }));
  document.querySelector('#tri')?.addEventListener('change', (e) => appliquerFiltres({ tri: e.target.value }));
  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(state, { filtreCat: null, q: '', tri: 'recent', taille: '', prixMin: '', prixMax: '', dispo: false, page: 1 });
    appliquerFiltres({});
  }));
  document.querySelector('[data-open-search]')?.addEventListener('click', openSearch);
  document.querySelectorAll('[data-cat-jump]').forEach((b) => b.addEventListener('click', () => { state.filtreCat = b.dataset.catJump; appliquerFiltres({}); }));

  /* fiche produit */
  if (/^\/produit\//.test(path)) bindProduit();
  if (/^\/panier/.test(path)) { bindPanier(); bindPanierSuite(); }
  if (/^\/commande$/.test(path)) bindCheckout();
  if (/^\/paiement\//.test(path)) bindPaiement();
  if (/^\/suivi/.test(path)) bindSuivi();

  document.querySelectorAll('[data-cancel-ref]').forEach((b) =>
    b.addEventListener('click', async () => {
      const pend = JSON.parse(localStorage.getItem('fatoucha_pending') || '{}');
      try {
        await API.post('/api/commandes/' + b.dataset.cancelRef + '/annuler', { telephone: pend.telephone || '' });
        toast('Commande annulée.', 'ok');
        render();
      } catch (e) { toast(e.message, 'ko'); }
    }));
}

function bindProduit() {
  const v = state.vue;
  const p = v.p;
  const majDispo = () => {
    const s = stockPour(p, v.taille, v.coloris);
    const d = document.getElementById('pd-dispo');
    if (d) d.innerHTML = s > 0 ? `${icone('check', { taille: 15 })} <b>${s}</b> en stock${v.taille ? ' en taille ' + esc(v.taille) : ''}` : `${icone('alerte', { taille: 15 })} Combinaison épuisée`;
    const price = document.getElementById('pd-price');
    if (price) price.textContent = money(p.prix);
    v.qte = Math.min(v.qte, Math.max(1, s));
    const q = document.getElementById('pd-qte');
    if (q) q.textContent = v.qte;
    const cb = document.querySelector('[data-buy]');
    const cn = document.querySelector('[data-checkout]');
    if (cn) cn.textContent = 'Commander · ' + money(p.prix * v.qte);
    document.querySelectorAll('#pd-tailles .chip').forEach((ch) => { ch.disabled = stockPour(p, ch.dataset.taille, v.coloris) === 0; ch.classList.toggle('on', ch.dataset.taille === v.taille); });
    document.querySelectorAll('#pd-coloris .chip').forEach((ch) => { ch.classList.toggle('on', ch.dataset.coloris === v.coloris); });
  };
  const afficherPhoto = (i) => {
    const im = p.images[i];
    if (!im) return;
    v.idx = i;
    const imgEl = document.getElementById('gal-main');
    if (imgEl) {
      imgEl.src = im.grande || urlImg(im.url, 900);
      if (im.srcset) imgEl.setAttribute('srcset', im.srcset);
      imgEl.alt = im.legende || p.titre;
    }
    document.querySelectorAll('[data-thumb]').forEach((x) => x.classList.toggle('on', Number(x.dataset.thumb) === i));
    const c = document.getElementById('gal-i');
    if (c) c.textContent = String(i + 1);
    const compte = document.querySelector('.gal-compte');
    if (compte && im.legende) compte.lastChild.textContent = ' · ' + im.legende;
  };
  document.querySelectorAll('[data-taille]').forEach((b) => b.addEventListener('click', () => { v.taille = b.dataset.taille; v.qte = 1; majDispo(); }));
  document.querySelectorAll('[data-coloris]').forEach((b) => b.addEventListener('click', () => { v.coloris = b.dataset.coloris; majDispo(); }));
  document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const s = stockPour(p, v.taille, v.coloris);
    v.qte = Math.max(1, Math.min(s || 1, v.qte + Number(b.dataset.q)));
    document.getElementById('pd-qte').textContent = v.qte;
    const cn = document.querySelector('[data-checkout]');
    if (cn) cn.textContent = 'Commander · ' + money(p.prix * v.qte);
  }));
  document.querySelectorAll('[data-thumb]').forEach((b) => b.addEventListener('click', () => afficherPhoto(Number(b.dataset.thumb))));
  document.querySelector('[data-zoom]')?.addEventListener('click', () => ouvrirLoupe(p, v.idx));
  /* la pastille et la carte vidéo font la même chose ; un lien qu'on ne sait
     pas intégrer garde son comportement de lien */
  document.querySelectorAll('[data-vod]').forEach((b) => b.addEventListener('click', (e) => {
    if (!p.video || !p.video.cadre) return;
    e.preventDefault();
    ouvrirVideo(p);
  }));
  document.querySelector('[data-guide]')?.addEventListener('click', () => {
    const d = document.getElementById('pd-guide');
    if (d) { d.open = true; faireDefiler(d, { behavior: 'smooth', block: 'center' }); Mesure.envoyer('guide_tailles', p.id); }
  });
  document.querySelector('[data-trouve]')?.addEventListener('click', () => ouvrirTrouveTaille(p));
  document.querySelector('[data-partage]')?.addEventListener('click', () => ouvrirPartage(p));
  document.querySelector('[data-avis]')?.addEventListener('click', () => ouvrirAvis(p));
  document.querySelector('[data-alerte]')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const telephone = document.getElementById('al-tel')?.value.trim() || '';
    btn.disabled = true;
    try {
      const r = await API.post('/api/alertes-stock', { produit_id: p.id, telephone });
      const out = document.getElementById('al-out');
      if (out) out.innerHTML = `<div class="banner ok">${esc(r.message)}</div>`;
      Mesure.envoyer('alerte_stock', p.id);
      if (r.deja) btn.textContent = 'C’est déjà fait';
    } catch (err) {
      const out = document.getElementById('al-out');
      if (out) out.innerHTML = `<div class="banner ko">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });

  /* flèches clavier dans la galerie : la fiche se parcourt sans souris */
  document.addEventListener('keydown', function fleches(e) {
    if (!document.getElementById('gal-main')) { document.removeEventListener('keydown', fleches); return; }
    if (e.key === 'ArrowRight') afficherPhoto(Math.min(p.images.length - 1, v.idx + 1));
    if (e.key === 'ArrowLeft') afficherPhoto(Math.max(0, v.idx - 1));
  });

  const ajouter = (ev) => {          /* ev : le bouton pressé, pour l'animation du panier */
    if (p.tailles.length && !v.taille) return toast('Choisis une taille.', 'ko');
    if (stockPour(p, v.taille, v.coloris) < 1) return toast('Cette combinaison est épuisée.', 'ko');
    Cart.add(p, { taille: v.taille, coloris: v.coloris, quantite: v.qte });
    Mesure.envoyer('ajout_panier', p.id, v.taille || '');
    toast('Ajouté au panier ✔', 'ok');
    if (typeof Mouvement !== 'undefined') Mouvement.voler(ev && ev.target ? ev.target : document.querySelector('[data-buy]'), document.querySelector('[data-cart-count]'));
  };
  document.querySelector('[data-buy]')?.addEventListener('click', ajouter);
  document.querySelector('[data-checkout]')?.addEventListener('click', () => { ajouter(); go('/commande'); });
  document.querySelector('[data-buynow]')?.addEventListener('click', () => {
    if (p.tailles.length && !v.taille) return toast('Choisis une taille.', 'ko');
    if (stockPour(p, v.taille, v.coloris) < 1) return toast('Cette combinaison est épuisée.', 'ko');
    Cart.add(p, { taille: v.taille, coloris: v.coloris, quantite: v.qte });
    Mesure.envoyer('ajout_panier', p.id, 'direct');
    go('/commande');
  });
  majDispo();
  if (requete().avis === '1') { Mesure.envoyer('clic_whatsapp', p.id, 'depuis-suivi'); setTimeout(() => ouvrirAvis(p), 250); }
}

/* ---------------- la vidéo de l'article ---------------- */
/* Le lecteur n'existe qu'au toucher. Avant le geste, la fiche ne contient
   qu'une image et un lien : pas de demi-seconde perdue, pas d'octets partis en
   douceur pour quelqu'un qui ne voulait que le prix. */
function carteVideo(p, images) {
  const v = p.video;
  if (!v) return '';
  const repli = (images[0] && (images[0].miniature || images[0].url)) || '/media/demo/robe-boheme.svg';
  if (v.fichier) {
    return `<div class="video-box"><video controls playsinline preload="none" poster="${esc(v.miniature || repli)}" src="${esc(v.fichier)}"></video>
      <div class="small muted">Vidéo de l’article réel, filmée par la boutique.</div></div>`;
  }
  if (!v.cadre) {
    return `<a class="vod-cart${v.format === 'vertical' ? ' vertical' : ''}" href="${esc(v.page)}" target="_blank" rel="noopener" data-vod aria-label="Lire la vidéo de l’article (chez le fournisseur)">
      <span class="vod-mini">${v.miniature ? `<img class="vod-img" src="${esc(v.miniature)}" alt="" loading="lazy" decoding="async" />` : ''}<span class="vod-play">${icone('lecture', { taille: 15 })}</span></span>
      <span class="vod-legende">Vidéo de l’article · chez le fournisseur<span class="vod-duree">s’ouvre dans un onglet</span></span>
    </a>`;
  }
  return `<a class="vod-cart${v.format === 'vertical' ? ' vertical' : ''}" href="${esc(v.page)}" target="_blank" rel="noopener" data-vod
     aria-label="Lire la vidéo de l’article (${esc(v.etiquette)})">
    <span class="vod-mini">${v.miniature ? `<img class="vod-img" src="${esc(v.miniature)}" alt="" loading="lazy" decoding="async" />` : ''}<span class="vod-play">${icone('lecture', { taille: 15 })}</span></span>
    <span class="vod-legende">Vidéo de l’article · ${esc(v.etiquette)}<span class="vod-duree">au toucher</span></span>
  </a>`;
}

/* L'autoplay n'est demandé qu'ici, parce que l'ouverture vient d'un geste :
   sinon la plateforme joue toute seule et rame sur une petite connexion. */
function avecAutoplay(cadre) {
  return cadre + (String(cadre).indexOf('?') >= 0 ? '&' : '?') + 'autoplay=1';
}

/* Le referrer du cadre n'est pas un détail de vie privée qu'on peut couper :
   YouTube et Vimeo vérifient l'origine de la page qui les encastre. Avec un
   iframe en referrerpolicy="no-referrer", le lecteur se refuse et affiche
   « Video player configuration error » (Error 153) — le HTML, lui, reste net,
   seul l'écran du cadre parle. On envoie donc l'origine seule : ni le chemin
   de la fiche, ni un paramètre de suivi. */
function ouvrirVideo(p) {
  const v = p.video;
  if (!v || !v.cadre) return;
  const m = el(`<div class="modal vod" role="dialog" aria-modal="true" aria-label="Vidéo de ${esc(p.titre)}">
    <button class="close" data-x aria-label="Fermer la vidéo">${icone('croix')}</button>
    <div class="vod-cadre${v.format === 'vertical' ? ' vertical' : ''}">
      ${v.miniature ? `<img class="vod-fond" src="${esc(v.miniature)}" alt="" />` : ''}
      <iframe src="${esc(avecAutoplay(v.cadre))}" title="Vidéo de ${esc(p.titre)}" referrerpolicy="origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen></iframe>
    </div>
    <div class="vod-aide">${icone('lecture', { taille: 14 })}<span>La lecture vient de ${esc(v.etiquette)} : ça compte sur ton forfait.</span><a href="${esc(v.page)}" target="_blank" rel="noopener">Ouvrir sur ${esc(v.etiquette)}</a></div>
  </div>`);
  document.body.appendChild(m);
  const surTouche = (e) => { if (e.key === 'Escape') fermer(); };
  const fermer = () => { m.remove(); document.removeEventListener('keydown', surTouche); };
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-x]')) fermer();
  });
  document.addEventListener('keydown', surTouche);
  const btn = m.querySelector('.close');
  if (btn) btn.focus();
  Mesure.envoyer('lecture_video', p.id, v.fournisseur);
}

/* ---------------- loupe sur la photo ---------------- */
/* Une photo ne dit rien du tissu. En approchant (clic, molette, deux doigts),
   on voit la trame — ce qui fait le moins de « ce n'était pas comme sur la photo ». */
function ouvrirLoupe(p, idx) {
  const images = p.images.length ? p.images : [{ url: p.image, legende: p.titre }];
  const m = el(`<div class="modal loupe" role="dialog" aria-modal="true" aria-label="Photo en grand de ${esc(p.titre)}">
    <button class="close" data-x aria-label="Fermer">${icone("croix")}</button>
    <div class="loupe-cadre" data-cadre><img alt="${esc(p.titre)}" src="${esc(images[idx].grande || images[idx].url)}" /></div>
    <div class="loupe-aide">Survole ou touche pour zoomer · <span class="mono">${idx + 1}/${images.length}</span>${images[idx].legende ? ' · ' + esc(images[idx].legende) : ''}</div>
    ${images.length > 1 ? '<button class="loupe-nav prev" data-nav="-1" aria-label="Photo précédente">‹</button><button class="loupe-nav next" data-nav="1" aria-label="Photo suivante">›</button>' : ''}
  </div>`);
  document.body.appendChild(m);
  const imgEl = m.querySelector('img');
  const cadre = m.querySelector('[data-cadre]');
  let zoom = 1;
  const regler = (x, y) => {
    imgEl.style.transform = `scale(${zoom})`;
    imgEl.style.transformOrigin = `${x}% ${y}%`;
    imgEl.classList.toggle('zoome', zoom > 1.05);
  };
  const fermer = () => { m.remove(); document.removeEventListener('keydown', surTouche); };
  const surTouche = (e) => {
    if (e.key === 'Escape') fermer();
    if (e.key === 'ArrowRight') changer(1);
    if (e.key === 'ArrowLeft') changer(-1);
  };
  let i = idx;
  function changer(d) {
    i = (i + d + images.length) % images.length;
    imgEl.src = images[i].grande || urlImg(images[i].url, 1200);
    imgEl.alt = images[i].legende || p.titre;
    m.querySelector('.loupe-aide span').textContent = (i + 1) + '/' + images.length;
    zoom = 1;
    regler(50, 50);
    Mesure.envoyer('zoom_photo', p.id, 'n' + (i + 1));
  }
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.hasAttribute('data-x')) return fermer();
    if (e.target.closest('[data-nav]')) return changer(Number(e.target.closest('[data-nav]').dataset.nav));
    const r = cadre.getBoundingClientRect();
    zoom = zoom > 1 ? 1 : 2.4;
    regler(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  cadre.addEventListener('mousemove', (e) => {
    if (zoom <= 1) return;
    const r = cadre.getBoundingClientRect();
    regler(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  cadre.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(1, Math.min(4, zoom + (e.deltaY < 0 ? 0.3 : -0.3))); regler(50, 50); }, { passive: false });
  document.addEventListener('keydown', surTouche);
  Mesure.envoyer('zoom_photo', p.id);
}

/* ---------------- guide des tailles ---------------- */
/* Le vêtement est mesuré à plat par la boutique ; ici on traduit les mesures du
   corps en une taille conseillée. Aucune donnée n'est envoyée ni gardée. */
function ouvrirTrouveTaille(p) {
  const guide = p.guide_tailles || {};
  const tailles = Object.keys(guide);
  if (!tailles.length) return toast('Pas encore de mesures pour cet article.', 'ko');
  const m = el(`<div class="modal" role="dialog" aria-modal="true" aria-label="Trouver ma taille"><div class="sheet" style="max-width:460px">
    <div class="hd"><h3 style="margin:0">Trouver ma taille</h3><button class="close" data-x aria-label="Fermer">${icone("croix")}</button></div>
    <div class="stack">
      <p class="small muted">Trois réponses, sans compte ni donnée gardée : on compare à la grille de cet article.</p>
      <div class="mini-form">
        <div class="field"><label for="tt-t">Ta taille (cm)</label><input class="inp" id="tt-t" type="number" min="120" max="210" value="168" /></div>
        <div class="field"><label for="tt-p">Ton poids (kg)</label><input class="inp" id="tt-p" type="number" min="30" max="180" value="60" /></div>
      </div>
      <div class="opt"><span class="lbl">Coupe préférée</span><div class="chips" id="tt-c">
        <button class="chip" data-c="pres">Près du corps</button>
        <button class="chip on" data-c="normal">Normale</button>
        <button class="chip" data-c="ample">Ample</button>
      </div></div>
      <div id="tt-out" class="banner"></div>
      <p class="small muted">Estimation indicative : en cas de doute, prends la taille au-dessus — l’échange est possible sous 48 h. Pour être sûre, envoie-nous ton tour de poitrine mesuré sur WhatsApp.</p>
    </div></div></div>`);
  document.body.appendChild(m);
  let coupe = 'normal';
  m.querySelectorAll('#tt-c .chip').forEach((b) => b.addEventListener('click', () => {
    coupe = b.dataset.c;
    m.querySelectorAll('#tt-c .chip').forEach((x) => x.classList.toggle('on', x === b));
    calculer();
  }));
  const cle = (t) => {
    const g = guide[t] || {};
    return Number(g.poitrine || g.tour_poitrine || g.hanches || g.taille || g.longueur || 0);
  };
  function calculer() {
    const t = Number(m.querySelector('#tt-t').value) || 168;
    const poids = Number(m.querySelector('#tt-p').value) || 60;
    /* Approximation du tour de poitrine à partir de la taille et du poids.
       Elle ne remplace pas un mètre ruban : elle sert à départager deux tailles. */
    let estime = 82 + (poids - 45) * 0.72 + (t - 150) * 0.18;
    if (coupe === 'pres') estime += 2;
    if (coupe === 'ample') estime -= 5;
    const classes = tailles.map((x) => ({ t: x, v: cle(x) })).filter((x) => x.v > 40).sort((a, b) => a.v - b.v);
    if (!classes.length) return;
    const prise = classes.find((x) => x.v >= estime) || classes[classes.length - 1];
    const avant = classes[classes.indexOf(prise) - 1];
    m.querySelector('#tt-out').className = 'banner ok';
    m.querySelector('#tt-out').innerHTML = `Conseil : <b>taille ${esc(prise.t)}</b>${avant ? ` (entre ${esc(avant.t)} et ${esc(prise.t)}, tour de poitrine estimé ~${Math.round(estime)} cm)` : ` (tour de poitrine estimé ~${Math.round(estime)} cm)`}.
      <div class="row" style="margin-top:8px"><button class="btn sm gold" data-choisir="${esc(prise.t)}">Choisir ${esc(prise.t)}</button></div>`;
    m.querySelector('[data-choisir]')?.addEventListener('click', (e) => {
      const bouton = document.querySelector(`#pd-tailles [data-taille=\"${CSS.escape(e.target.dataset.choisir)}\"]`);
      fermer();
      if (bouton) bouton.click();
      toast('Taille ' + e.target.dataset.choisir + ' sélectionnée.', 'ok');
    });
  }
  const fermer = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) fermer(); });
  m.querySelectorAll('input').forEach((i) => i.addEventListener('input', calculer));
  calculer();
  Mesure.envoyer('guide_tailles', p.id, 'trouve');
}

/* ---------------- avis d'acheteuse ---------------- */
/* Un avis publié depuis une commande livrée paraît tout de suite (achat
   vérifié). Sinon il attend la validation de la boutique : personne ne peut
   fabriquer une note. */
function ouvrirAvis(p) {
  const pend = JSON.parse(localStorage.getItem('fatoucha_pending') || '{}');
  const m = el(`<div class="modal" role="dialog" aria-modal="true" aria-label="Laisser un avis"><div class="sheet" style="max-width:520px">
    <div class="hd"><h3 style="margin:0">Votre avis sur « ${esc(p.titre)} »</h3><button class="close" data-x aria-label="Fermer">${icone("croix")}</button></div>
    <div class="stack">
      <div class="opt"><span class="lbl">Note</span><div class="chips note-choix" id="av-note">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="chip ${n === 5 ? 'on' : ''}" data-note="${n}" aria-label="${n} étoile${n > 1 ? 's' : ''}">${'★'.repeat(n)}</button>`).join('')}
      </div></div>
      <div class="mini-form">
        <div class="field"><label for="av-prenom">Ton prénom</label><input class="inp" id="av-prenom" placeholder="Ex. Awa" maxlength="30" /></div>
        <div class="field"><label for="av-taille">Taille reçue</label><input class="inp" id="av-taille" placeholder="${esc((p.tailles || []).join(', ') || '—')}" maxlength="20" /></div>
      </div>
      <div class="field"><label for="av-texte">Ce que tu en dis</label><textarea class="inp" id="av-texte" rows="4" placeholder="La coupe, la matière, la taille (petite / normale / grande)…"></textarea></div>
      <div class="field"><label for="av-photo">Une photo de toi avec l’article (optionnel)</label>
        <input class="inp" id="av-photo" type="file" accept="image/*" />
        <span class="small muted">Elle sera redimensionnée par le site. Tu peux aussi l’envoyer sur WhatsApp.</span></div>
      <details class="bloc verif-box"><summary>J’ai reçu cet article chez moi (avis vérifié)</summary>
        <div class="mini-form">
          <div class="field"><label for="av-ref">Référence de commande</label><input class="inp mono" id="av-ref" placeholder="CMD-XXXX-XXXX" value="${esc(localStorage.getItem('fatoucha_last_ref') || pend.reference || '')}" /></div>
          <div class="field"><label for="av-tel">Ton numéro</label><input class="inp" id="av-tel" placeholder="77 123 45 67" value="${esc(localStorage.getItem('fatoucha_last_tel') || pend.telephone || '')}" /></div>
        </div>
        <p class="small muted">Avec une commande livrée, l’avis est publié tout de suite et porte la mention « achat vérifié ».</p>
      </details>
      <div id="av-out"></div>
      <button class="btn gold big block" id="av-send">Envoyer mon avis</button>
    </div></div></div>`);
  document.body.appendChild(m);
  let note = 5;
  let photo = null;
  m.querySelectorAll('#av-note .chip').forEach((b) => b.addEventListener('click', () => {
    note = Number(b.dataset.note);
    m.querySelectorAll('#av-note .chip').forEach((x) => x.classList.toggle('on', x === b));
  }));
  m.querySelector('#av-photo').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const out = m.querySelector('#av-out');
    out.innerHTML = '<div class="banner">Envoi de la photo…</div>';
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/avis-photo', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Photo refusée.');
      photo = j.url;
      out.innerHTML = '<div class="banner ok">Photo reçue ✔</div>';
    } catch (err) {
      out.innerHTML = '<div class="banner ko">' + esc(err.message) + '</div>';
    }
  });
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) m.remove(); });
  m.querySelector('#av-send').addEventListener('click', async (ev) => {
    const btn = ev.target;
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    const corps = {
      prenom: m.querySelector('#av-prenom').value.trim(),
      note,
      texte: m.querySelector('#av-texte').value.trim(),
      taille: m.querySelector('#av-taille').value.trim() || null,
      photo,
      reference: m.querySelector('#av-ref').value.trim() || undefined,
      telephone: m.querySelector('#av-tel').value.trim() || undefined,
    };
    try {
      const r = await API.post('/api/produits/' + p.id + '/avis', corps);
      Mesure.envoyer('avis_publie', p.id, r.publie ? 'verifie' : 'a-valider');
      m.remove();
      toast(r.message, 'ok');
      if (r.publie) render();
    } catch (err) {
      m.querySelector('#av-out').innerHTML = '<div class="banner ko">' + esc(err.message) + '</div>';
      btn.disabled = false;
      btn.textContent = 'Envoyer mon avis';
    }
  });
  setTimeout(() => m.querySelector('#av-prenom').focus(), 30);
}

/* ---------------- partage ---------------- */
function ouvrirPartage(p) {
  const lien = location.origin + lienProduit(p);
  const m = el(`<div class="modal" role="dialog" aria-modal="true" aria-label="Partager"><div class="sheet" style="max-width:440px">
    <div class="hd"><h3 style="margin:0">Partager cet article</h3><button class="close" data-x aria-label="Fermer">${icone("croix")}</button></div>
    <div class="stack">
      <div class="copy"><span class="num">${esc(lien)}</span><button class="btn sm ghost" data-copy>Copier</button></div>
      <a class="btn gold block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Regarde : ' + p.titre + ' — ' + money(p.prix) + ' ' + lien)}">${icone('whatsapp', { taille: 16 })} Envoyer sur WhatsApp</a>
      <a class="btn ghost block" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=${esc((Shop.cfg?.whatsapp || '').replace(/\\D/g, ''))}&text=${encodeURIComponent(p.titre + ' — ' + money(p.prix) + ' ' + lien)}">${icone('whatsapp', { taille: 16 })} Envoyer à la boutique</a>
      <p class="small muted">Surprise à l’arrivée : le lien envoie la photo, le prix et l’article directement dans la conversation.</p>
    </div></div></div>`);
  document.body.appendChild(m);
  m.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lien); toast('Lien copié ✔', 'ok'); m.querySelector('[data-copy]').textContent = 'Copié'; }
    catch { toast('Copie impossible : sélectionne le lien.', 'ko'); }
  });
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) m.remove(); });
}

function bindPanier() {
  document.querySelectorAll('[data-cq]').forEach((b) => b.addEventListener('click', () => {
    const it = Cart.read().find((i) => i.key === b.dataset.cq);
    if (!it) return;
    Cart.setQty(it.key, it.qte + Number(b.dataset.d));
    render();
  }));
  document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { Cart.remove(b.dataset.rm); render(); }));
}

/* Un panier enregistré sur le site, retrouvé avec le numéro + le code de
   reprise : rien d'automatique, aucune liste de clientes à aller picorer. */
function bindPanierSuite() {
  document.querySelector('[data-reprise]')?.addEventListener('click', () => {
    const m = el(`<div class="modal" role="dialog" aria-modal="true" aria-label="Retrouver mon panier"><div class="sheet" style="max-width:440px">
      <div class="hd"><h3 style="margin:0">Retrouver mon panier</h3><button class="close" data-x aria-label="Fermer">${icone("croix")}</button></div>
      <div class="stack">
        <p class="small muted">Si tu avais laissé un panier sur un autre téléphone, donne le numéro utilisé au paiement — et le code de reprise affiché à ce moment-là.</p>
        <div class="field"><label for="rp-tel">Ton numéro</label><input class="inp" id="rp-tel" inputmode="tel" placeholder="77 123 45 67" /></div>
        <div class="field"><label for="rp-code">Code de reprise</label><input class="inp mono" id="rp-code" placeholder="A1B2" value="${esc(localStorage.getItem('fatoucha_panier_code') || '')}" /></div>
        <div id="rp-out"></div>
        <button class="btn gold block" id="rp-go">Rechercher</button>
      </div></div></div>`);
    document.body.appendChild(m);
    const fermer = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) fermer(); });
    m.querySelector('#rp-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Recherche…';
      try {
        const n = await Cart.reprendre(m.querySelector('#rp-tel').value.trim(), m.querySelector('#rp-code').value.trim());
        fermer();
        toast(n + ' article(s) retrouvé(s) dans ton panier ✔', 'ok');
        render();
      } catch (err) {
        m.querySelector('#rp-out').innerHTML = '<div class="banner ko">' + esc(err.message) + '</div>';
        e.target.disabled = false;
        e.target.textContent = 'Rechercher';
      }
    });
  });
}

function bindCheckout() {
  const c = state.checkout;
  document.getElementById('f-zone')?.addEventListener('change', (e) => { c.zone_id = Number(e.target.value) || null; majFrais(); });
  document.getElementById('f-adresse')?.addEventListener('input', (e) => (c.adresse = e.target.value));
  document.getElementById('f-instr')?.addEventListener('input', (e) => (c.instructions = e.target.value));
  document.querySelectorAll('#seg-mode button').forEach((b) => b.addEventListener('click', () => {
    c.mode = b.dataset.mode;
    document.querySelectorAll('#seg-mode button').forEach((x) => x.classList.toggle('on', x === b));
    document.getElementById('zone-box').classList.toggle('hidden', c.mode === 'retrait');
    document.getElementById('retrait-box').classList.toggle('hidden', c.mode !== 'retrait');
    majFrais();
  }));
  document.querySelectorAll('#pm-list [data-pm]').forEach((l) => l.addEventListener('click', () => {
    c.paiement = l.dataset.pm;
    document.querySelectorAll('#pm-list [data-pm]').forEach((x) => x.classList.toggle('on', x === l));
    majFrais();
  }));
  Mesure.envoyer('ouverture_commande');
  document.getElementById('btn-commande')?.addEventListener('click', (e) => submitCommande(e.target));
  document.getElementById('btn-commande-2')?.addEventListener('click', (e) => submitCommande(e.target));
  majFrais();
}

function bindPaiement() {
  const ref = hashPath().match(/^\/paiement\/([\w-]+)/)?.[1];
  const pend = JSON.parse(localStorage.getItem('fatoucha_pending') || '{}');
  document.querySelector('[data-pay]')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Connexion au paiement…';
    Mesure.envoyer('paiement_engage', null, ref);
    try {
      const r = await API.post('/api/paiement/checkout', { reference: ref, telephone: pend.telephone });
      if (r.deja_paye) return render();
      if (r.url) {
        window.open(r.url, '_blank', 'noopener');
        await verifierPaiement(ref, btn);
        return;
      }
      afficherManuel(r);
    } catch (err) {
      if (err.data?.fallback === 'manuel') {
        toast('Paiement auto indisponible, on passe en envoi direct.', 'ko');
        afficherManuel({ mode: 'manuel', montant: pend.total, numero: err.data.numero, reference: ref, methode: 'wave', app: {}, message: 'Le prestataire ne répond pas : envoie directement l’argent.' });
      } else {
        toast(err.message, 'ko');
      }
    } finally {
      btn.disabled = false;
      if (document.body.contains(btn)) btn.textContent = 'Payer ' + money(pend.total || 0);
    }
  });

  document.querySelectorAll('[data-switch]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await API.post('/api/paiement/checkout', { reference: ref, telephone: pend.telephone, methode: b.dataset.switch });
        toast('Méthode : ' + (b.dataset.switch === 'orange' ? 'Orange Money' : 'Wave'), 'ok');
        render();
      } catch (e) { toast(e.message, 'ko'); }
    }));

  document.querySelector('[data-confirme]')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Confirmation…';
    try {
      const r = await API.post('/api/commandes/' + encodeURIComponent(ref) + '/confirmer', {
        code: pend.code_confirmation || '', telephone: pend.telephone,
      });
      toast(r.message, 'ok');
      render();
    } catch (err) {
      toast(err.message, 'ko');
      btn.disabled = false;
      btn.textContent = '✔ Oui, je confirme';
    }
  });

  document.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (!confirm('Annuler cette commande ? Le stock retournera en rayon.')) return;
    try { await API.post('/api/commandes/' + ref + '/annuler', { telephone: pend.telephone }); toast('Commande annulée.', 'ok'); go('/'); }
    catch (e) { toast(e.message, 'ko'); }
  });

  /* Mode manuel : on affiche tout de suite les coordonnées d'envoi. */
  Shop.load().then((cfg) => {
    const box = document.getElementById('pay-manuel');
    if (cfg.paiement_mode !== 'cinetpay' && box && !box.innerHTML && cmdNesuiteAffichageManuel(cfg)) {
      API.post('/api/paiement/checkout', { reference: ref, telephone: pend.telephone })
        .then((r) => { if (r.mode === 'manuel') afficherManuel(r); })
        .catch(() => {});
    }
  });
}

function cmdNesuiteAffichageManuel(cfg) { return cfg.paiement_mode !== 'cinetpay'; }

function afficherManuel(r) {
  const box = document.getElementById('pay-manuel');
  if (!box) return;
  const isWave = r.methode !== 'orange';
  box.innerHTML = `
    <div style="margin-top:14px" class="bloc stack">
      <h4 style="margin:0">1 · Envoie ${money(r.montant)} à ${esc(isWave ? 'Wave' : 'Orange Money')}</h4>
      <div class="copy">
        <span class="num">${esc(r.numero || 'à configurer')}</span>
        <button class="btn sm ghost" data-copy="${esc(r.numero || '')}">Copier</button>
        ${r.deeplink ? `<a class="btn sm ${isWave ? 'wave' : 'orange'}" href="${esc(r.deeplink)}" target="_blank" rel="noopener">Ouvrir ${isWave ? 'l’app Wave' : 'Orange Money'}</a>` : ''}
      </div>
      <div class="small muted">${esc(r.message || '')}${r.fallback_ussd ? `<br>${icone('telephone', { taille: 15 })} Ou compose <span class="mono">${esc(r.fallback_ussd)}</span>` : ''}</div>
      <h4 style="margin:6px 0 0">2 · Confirme l’envoi</h4>
      <div class="small muted">Envoie la capture de la transaction sur WhatsApp pour une validation express :</div>
      <a class="btn gold" target="_blank" rel="noopener" href="https://wa.me/${esc((Shop.cfg?.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('J’ai envoyé ' + r.montant + ' F (ref ' + r.reference + '). Voici la capture du paiement.')}" style="width:100%">${icone('whatsapp', { taille: 16 })} Envoyer la preuve</a>
      <hr style="border:0;border-top:1px dashed var(--line)" />
      <div class="row" style="flex-wrap:wrap">
        <button class="btn sm ghost" data-jai-paye>J’ai payé — vérifier</button>
        <span class="small muted">Le statut se met à jour automatiquement.</span>
      </div>
    </div>`;
  box.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(e.target.dataset.copy); toast('Numéro copié ✔', 'ok'); }
    catch { toast('Copie impossible : note le numéro.', 'ko'); }
  });
  box.querySelector('[data-jai-paye]')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Vérification…';
    const ok = await verifierPaiement(hashPath().match(/([\w-]+)$/)?.[1], e.target);
    if (!ok) { e.target.textContent = 'Pas encore vu — envoie la preuve'; }
  });
}

async function verifierPaiement(ref, btn) {
  for (let i = 0; i < 8; i++) {
    try {
      const s = await API.get('/api/paiement/statut/' + encodeURIComponent(ref));
      if (s.statut_paiement === 'paye') {
        if (btn) btn.textContent = 'Paiement reçu ✔';
        toast('Paiement confirmé, commande validée', 'ok');
        setTimeout(() => go('/commande/' + ref), 700);
        return true;
      }
    } catch { /* réseau */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  toast('Paiement pas encore confirmé — envoie la preuve sur WhatsApp, Fatou validera.', 'warn');
  return false;
}

function bindSuivi() {
  document.querySelectorAll('[data-confirme-ref]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      const pend = JSON.parse(localStorage.getItem('fatoucha_pending') || '{}');
      e.target.disabled = true;
      try {
        const r = await API.post('/api/commandes/' + b.dataset.confirmeRef + '/confirmer', { code: pend.code_confirmation || '', telephone: pend.telephone || document.getElementById('s-tel')?.value || '' });
        toast(r.message, 'ok');
        render();
      } catch (err) {
        toast(err.message, 'ko');
        e.target.disabled = false;
      }
    }));
  document.getElementById('btn-suivi')?.addEventListener('click', () => {
    const ref = document.getElementById('s-ref').value.trim().toUpperCase();
    const tel = document.getElementById('s-tel').value.trim();
    if (!ref) return document.getElementById('suivi-err').innerHTML = '<div class="banner ko">Il me faut la référence.</div>';
    localStorage.setItem('fatoucha_last_ref', ref);
    localStorage.setItem('fatoucha_last_tel', tel);
    go('/commande/' + ref + '?tel=' + encodeURIComponent(tel));
  });
}

function openSearch() {
  const m = el(`<div class="modal"><div class="sheet" style="max-width:560px">
    <div class="hd"><h3 style="margin:0">${icone("recherche", { taille: 17 })} Rechercher un article</h3><button class="close" data-x aria-label="Fermer">${icone("croix")}</button></div>
    <input class="inp" id="q" placeholder="robe, sac, parfum, montre…" autocomplete="off" />
    <div class="small muted" style="margin-top:8px">Astuce : tape une taille ou un prix — « robe 15000 », « sac ».</div>
    <div class="stack" style="margin-top:10px;max-height:44vh;overflow:auto" id="qres"></div>
  </div></div>`);
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) close(); });
  const input = m.querySelector('#q');
  const res = m.querySelector('#qres');
  let t;
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) { res.innerHTML = ''; return; }
    try {
      const rows = await API.get('/api/produits?' + new URLSearchParams({ q }));
      res.innerHTML = rows.length
        ? rows.slice(0, 8).map((p) => `<button class="row" data-p="${p.id}" style="text-align:left;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px;cursor:pointer;gap:10px">
            <img src="${esc(img(p))}" style="width:44px;height:54px;object-fit:cover;border-radius:8px" onerror="this.src='/media/demo/robe-boheme.svg'" />
            <span class="grow"><b style="font-size:13.5px">${esc(p.titre)}</b><br><span class="small muted">${money(p.prix)} · ${p.en_rupture ? 'rupture' : 'stock ' + p.stock}</span></span></button>`).join('')
        : '<div class="small muted">Aucun article pour le moment.</div>';
      res.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { close(); go('/produit/' + b.dataset.p); }));
    } catch (e) { res.innerHTML = '<div class="banner ko">' + esc(e.message) + '</div>'; }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 220); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { close(); state.q = input.value.trim(); render(); } });
  input.focus();
}

window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);

/* Installation du site comme application + catalogue gardé en cache : sur un
   réseau faible, une fiche déjà vue s'ouvre instantanément. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* le site marche sans worker */ });
  });
  let differer = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    differer = e;
    if (localStorage.getItem('fatoucha_installe')) return;
    const barre = el(`<div class="installer"><div class="wrap in">
      <b>Installer la boutique</b><span class="small muted">Un raccourci sur ton écran d’accueil, et le catalogue marche même quand le réseau tombe.</span>
      <button class="btn sm gold" data-installer>Installer</button><button class="btn sm ghost" data-plus-tard>Plus tard</button>
    </div></div>`);
    document.body.appendChild(barre);
    barre.querySelector('[data-plus-tard]').addEventListener('click', () => { localStorage.setItem('fatoucha_installe', '1'); barre.remove(); });
    barre.querySelector('[data-installer]').addEventListener('click', async () => {
      if (!differer) return;
      differer.prompt();
      const choix = await differer.userChoice.catch(() => ({ outcome: 'ignore' }));
      if (choix.outcome === 'accepted') { localStorage.setItem('fatoucha_installe', '1'); toast('La boutique est installée ✔', 'ok'); }
      barre.remove();
    });
  });
}
/* Le panier change → on rafraîchit la vue panier seulement (sinon on écraserait
   le formulaire de commande ou la page de paiement en cours de navigation). */
window.addEventListener('cart:change', () => { if (/^\/panier/.test(hashPath()) && !state.soumission) render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.remove());
});
/* Les tuiles des Shorts — sur l'accueil comme sur /shorts — ouvrent le même
   lecteur que la fiche. Délégué sur le document et posé une seule fois : la
  rubrique est redessinée à chaque changement de filtre, le geste survit.
   Sans JavaScript, la tuile reste un lien vers l'article : rien ne se casse. */
if (!document.__courtsPilotes) {
  document.__courtsPilotes = true;
  document.addEventListener('click', async (e) => {
    const tuile = e.target.closest && e.target.closest('[data-short]');
    if (!tuile || tuile.dataset.shortEncours) return;
    e.preventDefault();
    tuile.dataset.shortEncours = '1';
    try {
      const p = await (await fetch('/api/produits/' + encodeURIComponent(tuile.dataset.short))).json();
      if (p && p.video && p.video.cadre) ouvrirVideo(p);
      else location.href = tuile.getAttribute('href');
    } catch {
      location.href = tuile.getAttribute('href');
    } finally {
      delete tuile.dataset.shortEncours;
    }
  });
}
render();
