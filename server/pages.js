/* Rendu serveur des pages publiques.
   ------------------------------------------------------------------
   Pourquoi ce fichier : le front est une application en JavaScript, donc un
   robot (Google) et l'aperçu de lien de WhatsApp/Instagram ne voient qu'une
   coquille vide de 920 octets — ni titre, ni prix, ni photo. Ici, Express
   renvoie le VRAI contenu dans le HTML pour les pages qui comptent
   (accueil, boutique, fiche, catégorie, FAQ, retours) + les balises
   Open Graph et le JSON-LD. Le JavaScript prend ensuite la main sur la même
   URL, sans clignotement et sans rechargement.

   Le balisage reprend les classes de public/css/style.css : ce que voit une
   cliente et ce que voit un moteur de recherche sont la même page. */
const { db, getSetting } = require('./db');
const optima = require('./optima');
const {
  produitPublic,
  listerProduits,
  resumeAvis,
  avisPublics,
  avisPhotos,
  similaires,
  completeLeLook,
  lireGuide,
} = require('./catalogue');

const ech = optima.echapperHtml;
const nf = new Intl.NumberFormat('fr-FR');
const fcfa = (n) => `${nf.format(Math.round(Number(n) || 0))} F`;
const jplural = (n) => (Number(n) > 1 ? 'jours' : 'jour');

/* ---------------- morceaux communs ---------------- */
function entete(cfg, actif = '') {
  const nom = cfg.nom_boutique || 'CHEZ FATOUCHA';
  const mono = nom.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return `<header class="top"><div class="wrap bar">
    <a class="brand" href="/"${actif === 'boutique' ? ' aria-current="page"' : ''}>
      <span class="logo" aria-hidden="true">${ech(mono || 'CF')}</span>
      <span><b>${ech(nom)}</b><small>Dakar · Livraison &amp; retrait</small></span>
    </a>
    <nav class="main" aria-label="Navigation principale">
      <a href="/boutique" class="${actif === 'boutique' ? 'on' : ''}">Boutique</a>
      <a href="/suivi" class="${actif === 'suivi' ? 'on' : ''}">Suivre ma commande</a>
      <a href="/faq" class="${actif === 'faq' ? 'on' : ''}">Questions fréquentes</a>
    </nav>
    <div class="actions">
      <a class="icon-btn" href="/boutique?q=" title="Rechercher un article" aria-label="Rechercher">🔍</a>
      <a class="icon-btn" href="/panier" title="Panier" aria-label="Panier">🧺<span class="count">0</span></a>
    </div>
  </div></header>
  <div class="marquee"><div class="wrap">
    <span>Livraison <b>Dakar dès 1 000 F</b> · régions dès <b>3 000 F</b></span>
    <span>Retrait boutique <b>offert</b></span>
    <span>Paiement <b>Wave</b> &amp; <b>Orange Money</b></span>
    <span>Livraison offerte dès <b>${fcfa(cfg.livraison_gratuite_a_partir || 0)}</b></span>
  </div></div>`;
}

function pied(cfg) {
  return `<footer class="ft"><div class="wrap cols">
    <div>
      <h4>${ech(cfg.nom_boutique || 'Chez Fatoucha')}</h4>
      <div>${ech(cfg.boutique_description || '')}</div>
      <div class="pied-ligne">📍 ${ech(cfg.adresse_retrait || '')}<br />🕘 ${ech(cfg.horaires_retrait || '')}</div>
    </div>
    <div>
      <h4>Aide</h4>
      <div class="stack">
        <a href="/suivi">Suivre une commande</a>
        <a href="/retours">Échanges &amp; retours</a>
        <a href="/faq">Questions fréquentes</a>
        <a href="https://wa.me/${ech(String(cfg.whatsapp || '').replace(/\D/g, ''))}" rel="noopener">WhatsApp ${ech(cfg.telephone || '')}</a>
      </div>
    </div>
    <div>
      <h4>Paiement</h4>
      <div class="row"><span class="pill wave">Wave</span><span class="pill orange">Orange Money</span><span class="pill">Espèces à la livraison</span></div>
      <div class="small pied-note">Prix en FCFA · livraison calculée selon ta zone (21 zones à Dakar et en régions).</div>
    </div>
  </div></footer>`;
}

function carte(p) {
  const lien = p.url || `/produit/${p.id}`;
  const promo = p.prix_barre ? Math.round((1 - p.prix / p.prix_barre) * 100) : 0;
  const flags = [
    promo > 0 ? `<span class="flag promo">-${promo}%</span>` : '',
    p.en_rupture ? '<span class="flag out">Rupture</span>' : p.stock <= 3 && p.stock > 0 ? `<span class="flag rush">Plus que ${p.stock} !</span>` : '',
  ].filter(Boolean).join('');
  const note = p.avis?.nombre ? `<span class="mini note-mini">${'★'.repeat(Math.round(p.avis.moyenne))} ${p.avis.moyenne} (${p.avis.nombre})</span>` : '';
  return `<article class="card" data-go="${ech(lien)}">
    <div class="ph">
      <a href="${ech(lien)}" tabindex="-1" aria-hidden="true">${optima.baliseImage(p.image, p.titre, { sizes: '(max-width:640px) 46vw, 300px' })}</a>
      <div class="flags">${flags}</div>
    </div>
    <div class="body">
      <div class="t"><a href="${ech(lien)}">${ech(p.titre)}</a></div>
      <div class="price">${fcfa(p.prix)}${p.prix_barre ? `<s>${fcfa(p.prix_barre)}</s>` : ''}</div>
      <div class="foot"><span class="mini">~${p.delai_jours} ${jplural(p.delai_jours)} · Dakar</span>${note}</div>
    </div>
  </article>`;
}

function rangee(titre, sousTitre, produits, ancre = '') {
  if (!produits.length) return '';
  return `<section class="blk rang"${ancre ? ` id="${ech(ancre)}"` : ''}><div class="wrap">
    <div class="blk-head"><div><h2>${ech(titre)}</h2><p>${ech(sousTitre)}</p></div><a class="link" href="/boutique">Tout voir →</a></div>
    <div class="grid">${produits.map(carte).join('')}</div>
  </div></section>`;
}

function etoiles(note) {
  const n = Math.max(0, Math.min(5, Math.round(Number(note) || 0)));
  return `<span class="etoiles" role="img" aria-label="${n} étoile${n > 1 ? 's' : ''} sur 5"><i aria-hidden="true">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</i></span>`;
}

/* ---------------- pages ---------------- */
function accueil(req) {
  const cfg = reglages(req);
  const recents = listerProduits({ limit: 12 }).map(produitPublic);
  const vedettes = db
    .prepare('SELECT p.*, c.name AS categorie_nom FROM produits p LEFT JOIN categories c ON c.id = p.categorie_id WHERE p.actif = 1 AND p.vedette = 1 ORDER BY p.id DESC LIMIT 6')
    .all()
    .map(produitPublic);
  const cats = db
    .prepare('SELECT c.id, c.name, c.emoji, c.slug, (SELECT COUNT(*) FROM produits p WHERE p.categorie_id = c.id AND p.actif = 1) AS n FROM categories c ORDER BY c.ordre, c.name')
    .all();
  const photos = avisPhotos(6);
  const total = db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1').get().n;
  const dispo = db.prepare('SELECT COUNT(*) AS n FROM produits WHERE actif = 1 AND stock > 0').get().n;
  const noteGlobale = db.prepare('SELECT COUNT(*) AS n, AVG(note) AS m FROM avis WHERE approuve = 1').get();

  const corps = `
  ${entete(cfg, 'boutique')}
  <section class="hero"><div class="wrap"><div class="inner">
    <div class="txt">
      <span class="sur">Sélection &amp; pièces choisies · Dakar</span>
      <h1>La mode qui t’aime, <em>livrée à ta porte</em>.</h1>
      <p>Robes, ensembles, sacs, chaussures, parfums… choisis ta taille et ta quantité, paie par Wave ou Orange Money. On livre à Dakar et dans toutes les régions — ou tu viens retirer à la boutique.</p>
      <div class="cta">
        <a class="btn gold big" href="/boutique">Voir les ${total} articles</a>
        <a class="btn ghost big" href="/suivi">📦 Suivre ma commande</a>
      </div>
      <div class="stats">
        <div><b>${dispo}</b> articles disponibles</div>
        <div><b>24 h</b> livraison Dakar</div>
        <div><b>1 000 F</b> dès le quartier d’à côté</div>
        <div><b>Wave / OM</b> paiement direct</div>
      </div>
    </div>
    <figure class="visuel">
      ${optima.baliseImage('/media/demo/lookbook.jpg', 'Silhouette de la sélection Chez Fatoucha', { sizes: '(max-width:900px) 92vw, 460px', priorité: true })}
      <figcaption>La sélection Fatoucha</figcaption>
    </figure>
  </div></div></section>

  <section class="blk"><div class="wrap"><div class="cats">
    <button class="cat on" data-cat="">✨ Tout</button>
    ${cats.map((c) => `<a class="cat" href="/categorie/${ech(c.slug || c.id)}">${ech(c.emoji)} ${ech(c.name)} <span class="n">${c.n}</span></a>`).join('')}
  </div></div></section>

  ${rangee('Sélection de Fatou', 'Les pièces qu’elle met en avant cette semaine.', vedettes.length ? vedettes : recents.slice(0, 6))}

  <section class="blk" id="boutique-grid"><div class="wrap">
    <div class="blk-head"><div><h2>Nouveautés &amp; bons plans</h2><p>${recents.length} article(s) · prix en FCFA, livraison calculée au panier</p></div></div>
    <div class="grid">${recents.map(carte).join('')}</div>
    <div class="rang-pied"><a class="btn ghost" href="/boutique">Voir tout le catalogue →</a></div>
  </div></section>

  ${photos.length ? `<section class="blk"><div class="wrap">
    <div class="blk-head"><div><h2>Portées par nos clientes</h2><p>Les photos envoyées après réception — rien de retouché.</p></div></div>
    <div class="photos-avis">${photos.map((a) => `<a class="photo-avis" href="/produit/${ech(a.produit_slug || a.produit_slug)}">${optima.baliseImage(a.photo, `${a.produit_titre} porté par ${a.prenom}`, { largeurs: [220, 480], sizes: '140px' })}<span>${ech(a.prenom)}</span></a>`).join('')}</div>
  </div></section>` : ''}

  <section class="blk"><div class="wrap confiance">
    <div><b>Livraison suivie</b><span class="small">Estimation annoncée avant de payer, et on t’appelle avant que le livreur parte.</span></div>
    <div><b>Paiement mobile</b><span class="small">Wave ou Orange Money depuis le site, ou espèces à la livraison.</span></div>
    <div><b>Taille incertaine ?</b><span class="small">Guide des tailles en centimètres sur chaque fiche, échange sous 48 h.</span></div>
    ${noteGlobale.n ? `<div><b>${noteGlobale.m.toFixed(1)} / 5</b><span class="small">${noteGlobale.n} avis vérifié(s) d’acheteuses.</span></div>` : ''}
  </div></section>
  ${pied(cfg)}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: cfg.nom_boutique || 'CHEZ FATOUCHA',
      url: cfg._url,
      potentialAction: { '@type': 'SearchAction', target: `${cfg._url}/boutique?q={query}`, 'query-input': 'required name=query' },
    },
    entreprise(cfg),
  ];
  if (noteGlobale.n) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Catalogue',
      numberOfItems: total,
      itemListElement: recents.slice(0, 10).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: cfg._url + (p.url || `/produit/${p.id}`), name: p.titre })),
    });
  }
  return pageHTML({
    cfg,
    titre: `${cfg.nom_boutique} — mode & accessoires livrés à Dakar`,
    description: cfg.boutique_description,
    url: `${cfg._url}/`,
    image: '/media/demo/lookbook.jpg',
    jsonLd,
    corps,
  });
}

function boutique(req, { q = '', categorie = null, tri = 'recent', taille = '', prixMin = '', prixMax = '' } = {}) {
  const cfg = reglages(req);
  const rows = listerProduits({
    q,
    categorieId: categorie,
    tri,
    taille,
    prixMin,
    prixMax,
    limit: 24,
  }).map(produitPublic);
  const chats = db.prepare('SELECT id, name, slug, emoji FROM categories ORDER BY ordre, name').all();
  const titre = q
    ? `Recherche « ${q} »`
    : categorie
    ? chats.find((c) => String(c.id) === String(categorie))?.name || 'Catégorie'
    : 'Tous les articles';
  const corps = `
  ${entete(cfg, 'boutique')}
  <section class="blk"><div class="wrap">
    <div class="blk-head"><div><h1>${ech(titre)}</h1><p>${rows.length} article(s) trouvé(s) · prix en FCFA</p></div>
      <form class="filtres" method="get" action="/boutique">
        <input class="inp" type="search" name="q" placeholder="robe, sac, parfum…" value="${ech(q)}" aria-label="Rechercher" />
        <select class="inp" name="tri" aria-label="Trier">
          ${[['recent', 'Nouveautés'], ['prix_asc', 'Prix croissant'], ['prix_desc', 'Prix décroissant'], ['alpha', 'A → Z'], ['promo', 'Bons plans']]
            .map(([v, l]) => `<option value="${v}"${v === tri ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn sm" type="submit">Filtrer</button>
      </form>
    </div>
    ${rows.length ? `<div class="grid">${rows.map(carte).join('')}</div>` : '<div class="empty"><div class="big">🧺</div>Aucun article ne correspond à cette recherche.</div>'}
  </div></section>
  ${pied(cfg)}`;
  return pageHTML({
    cfg,
    titre: `${titre} — ${cfg.nom_boutique}`,
    description: q ? `${rows.length} résultat(s) pour « ${q} » chez ${cfg.nom_boutique} : robes, ensembles, sacs, chaussures, parfums livrés à Dakar.` : `Tout le catalogue ${cfg.nom_boutique} : ${rows.length} articles en stock, livraison à Dakar et en régions, paiement Wave ou Orange Money.`,
    url: `${cfg._url}/boutique`,
    image: rows[0]?.image || '/media/demo/lookbook.jpg',
    corps,
    robots: q ? 'noindex,follow' : 'index,follow',
  });
}

function categorie(req, cat) {
  const cfg = reglages(req);
  const rows = listerProduits({ categorieId: cat.id, limit: 24 }).map(produitPublic);
  const corps = `
  ${entete(cfg, 'boutique')}
  <section class="blk"><div class="wrap">
    <div class="blk-head"><div><h1>${ech(cat.emoji)} ${ech(cat.name)}</h1>
      <p>${rows.length} article(s) dans cette catégorie · livraison Dakar dès 1 000 F.</p></div>
      <a class="link" href="/boutique">Tout le catalogue →</a></div>
    ${rows.length ? `<div class="grid">${rows.map(carte).join('')}</div>` : '<div class="empty">Rien dans cette catégorie pour le moment.</div>'}
  </div></section>
  ${pied(cfg)}`;
  return pageHTML({
    cfg,
    titre: `${cat.name} — ${cfg.nom_boutique}`,
    description: `${cat.name} chez ${cfg.nom_boutique} : ${rows.length} pièces disponibles, prix en FCFA, livraison à Dakar et dans les régions, paiement Wave / Orange Money.`,
    url: `${cfg._url}/categorie/${cat.slug || cat.id}`,
    image: rows[0]?.image || '/media/demo/lookbook.jpg',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Accueil', item: cfg._url + '/' }, { '@type': 'ListItem', position: 2, name: cat.name, item: `${cfg._url}/categorie/${cat.slug || cat.id}` }],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: cat.name,
        url: `${cfg._url}/categorie/${cat.slug || cat.id}`,
        mainEntity: { '@type': 'ItemList', numberOfItems: rows.length, itemListElement: rows.slice(0, 12).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: cfg._url + p.url, name: p.titre })) },
      },
    ],
    corps,
  });
}

function produit(req, row) {
  const p = produitPublic(row);
  const cfg = reglages(req);
  const avis = avisPublics(row.id, 6);
  const resume = resumeAvis(row.id);
  const guide = lireGuide(row.guide_tailles);
  const lesAussi = similaires(row, { limite: 8 });
  const leLook = completeLeLook(row, { limite: 6 });
  const images = p.images.length ? p.images : [{ url: '/media/demo/robe-boheme.svg', legende: null }];
  const stockTexte = p.en_rupture ? 'OutOfStock' : 'InStock';
  const corps = `
  ${entete(cfg, 'boutique')}
  <div class="wrap fil-ariane">
    <a href="/">Boutique</a>${row.categorie_nom ? ` › <a href="/categorie/${ech(row.categorie_slug || p.categorie_id)}">${ech(p.categorie)}</a>` : ''} › <span>${ech(p.titre)}</span>
  </div>
  <div class="wrap"><div class="pd">
    <div class="gallery">
      <div class="main">${optima.baliseImage(images[0].url, images[0].legende || p.titre, { sizes: '(max-width:900px) 94vw, 520px', priorité: true, id: 'gal-main' })}</div>
      ${images.length > 1 ? `<div class="thumbs">${images.map((im, i) => `<button class="${i === 0 ? 'on' : ''}" data-thumb="${i}" aria-label="Photo ${i + 1}">${optima.baliseImage(im.url, '', { largeurs: [220], sizes: '74px' })}</button>`).join('')}</div>` : ''}
      ${p.video_url && /(^\/uploads\/|\\.(mp4|webm)$)/i.test(p.video_url) ? `<div class="video-box"><video controls playsinline preload="none" poster="${ech(images[0].url)}" src="${ech(p.video_url)}"></video></div>` : ''}
      ${p.video_url && !/(^\/uploads\/|\\.(mp4|webm)$)/i.test(p.video_url) ? `<a class="btn ghost block" href="${ech(p.video_url)}" rel="noopener">▶ Voir la vidéo du produit</a>` : ''}
    </div>
    <div class="stack">
      <div>
        <div class="row"><span class="pill teal">${p.en_rupture ? 'Rupture de stock' : p.stock <= 3 ? `Plus que ${p.stock} en stock` : '✔ Disponible'}</span>${p.marque ? `<span class="pill">${ech(p.marque)}</span>` : ''}</div>
        <h1>${ech(p.titre)}</h1>
        <div class="pricebox"><span class="price">${fcfa(p.prix)}</span>${p.prix_barre ? `<s class="muted">${fcfa(p.prix_barre)}</s>` : ''}</div>
        ${resume.nombre ? `<a class="lien-avis" href="#avis">${etoiles(resume.moyenne)} <b>${resume.moyenne}/5</b> · ${resume.nombre} avis</a>` : `<span class="lien-avis">Aucun avis pour l’instant — sois la première à noter.</span>`}
      </div>
      ${p.description ? `<div class="bloc"><h3>Description</h3><div class="desc">${ech(p.description)}</div></div>` : ''}
      ${p.mannequin ? `<div class="puce-mannequin">📏 ${ech(p.mannequin)}</div>` : ''}
      ${p.tailles.length ? `<div class="opt"><span class="lbl">Taille</span><div class="chips">${p.tailles.map((t) => `<button class="chip" data-taille="${ech(t)}">${ech(t)}</button>`).join('')}</div></div>` : ''}
      ${Object.keys(guide).length ? `<div class="bloc"><h3>Guide des tailles (cm)</h3>
        <table class="guide"><thead><tr><th>Taille</th><th>Poitrine</th><th>Taille</th><th>Hanches</th></tr></thead>
        <tbody>${Object.entries(guide).map(([t, m]) => `<tr><td><b>${ech(t)}</b></td><td>${m.poitrine ?? '—'}</td><td>${m.taille ?? '—'}</td><td>${m.hanches ?? '—'}</td></tr>`).join('')}</tbody></table>
        <p class="small muted">Mesures du vêtement à plat ×2. Entre deux tailles ? Prends la plus grande : on échange sous 48 h.</p></div>` : ''}
      <div class="info-lines">
        <div class="li"><i>🚚</i><div><b>Livraison</b> — article commandé au fournisseur sous ~${p.delai_jours} ${jplural(p.delai_jours)}, puis Dakar 24-36 h, régions 2-4 j.</div></div>
        <div class="li"><i>🏪</i><div><b>Retrait gratuit</b> — ${ech(cfg.adresse_retrait || '')} · ${ech(cfg.horaires_retrait || '')}</div></div>
        <div class="li"><i>📱</i><div><b>Paiement</b> — Wave, Orange Money, ou espèces à la livraison.</div></div>
        <div class="li"><i>🔁</i><div><b>Échange</b> — <a href="/retours">taille non conforme ?</a> Préviens-nous sur WhatsApp sous 48 h.</div></div>
      </div>
      <div class="cta-fiche"><a class="btn gold big" href="/panier">Ajouter au panier</a>
        <a class="btn big" href="https://wa.me/${ech(String(cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent(`Salam ! Je suis intéressée par « ${p.titre} » (${fcfa(p.prix)}) — ${cfg._url}/produit/${p.slug || p.id}`)}" rel="noopener">💬 Commander sur WhatsApp</a>
      </div>
    </div>
  </div></div>
  ${lesAussi.length ? rangee('Dans le même esprit', `Autres pièces de la catégorie ${p.categorie || ''}.`, lesAussi) : ''}
  ${leLook.length ? rangee('Ça complète le look', 'Le sac, les chaussures ou le parfum qui vont avec.', leLook) : ''}
  ${avis.length ? `<section class="blk" id="avis"><div class="wrap"><div class="blk-head"><div><h2>${resume.nombre} avis d’acheteuses</h2><p>Seules les commandes livrées peuvent laisser un avis.</p></div></div>
    <div class="avis-liste">${avis.map((a) => `<article class="avis-item">
      <header><b>${ech(a.prenom)}</b>${a.achat_verifie ? '<span class="verif">✔ achat vérifié</span>' : ''}<time>${ech(new Date(a.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }))}</time></header>
      ${etoiles(a.note)}
      ${a.texte ? `<p>${ech(a.texte)}</p>` : ''}
      ${a.photo ? optima.baliseImage(a.photo, `Photo envoyée par ${a.prenom}`, { largeurs: [220, 480], sizes: '220px' }) : ''}
      ${a.reponse ? `<div class="reponse"><b>${ech(cfg.nom_boutique)}</b> — ${ech(a.reponse)}</div>` : ''}
    </article>`).join('')}</div></div></section>` : ''}
  ${pied(cfg)}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.titre,
      sku: `FATOU-${String(p.id).padStart(4, '0')}`,
      productID: p.slug || String(p.id),
      description: (p.description || `${p.titre} — ${cfg.nom_boutique}`).slice(0, 480),
      image: images.map((im) => cfg._url + (im.grande || im.url)),
      brand: p.marque ? { '@type': 'Brand', name: p.marque } : { '@type': 'Brand', name: cfg.nom_boutique || 'Chez Fatoucha' },
      offers: {
        '@type': 'Offer',
        url: cfg._url + (p.url || `/produit/${p.id}`),
        priceCurrency: 'XOF',
        price: p.prix,
        availability: `https://schema.org/${stockTexte}`,
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: cfg.nom_boutique || 'Chez Fatoucha' },
      },
      ...(resume.nombre
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: resume.moyenne, reviewCount: resume.nombre, bestRating: 5, worstRating: 1 } }
        : {}),
      ...(avis.length
        ? { review: avis.slice(0, 3).map((a) => ({ '@type': 'Review', author: { '@type': 'Person', name: a.prenom }, reviewRating: { '@type': 'Rating', ratingValue: a.note, bestRating: 5 }, reviewBody: (a.texte || '').slice(0, 480) })) }
        : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: cfg._url + '/' },
        ...(p.categorie ? [{ '@type': 'ListItem', position: 2, name: p.categorie, item: `${cfg._url}/categorie/${p.categorie_id}` }] : []),
        { '@type': 'ListItem', position: 3, name: p.titre, item: cfg._url + (p.url || `/produit/${p.id}`) },
      ],
    },
  ];
  return pageHTML({
    cfg,
    titre: `${p.titre} — ${fcfa(p.prix)} · ${cfg.nom_boutique}`,
    description: `${p.description || p.titre} — ${fcfa(p.prix)} en stock, ~${p.delai_jours} ${jplural(p.delai_jours)}. Livraison Dakar, retrait offert. ${resume.nombre ? `${resume.nombre} avis, ${resume.moyenne}/5.` : ''}`,
    url: `${cfg._url}${p.url || '/produit/' + p.id}`,
    image: images[0]?.url,
    type: 'product',
    prix: p.prix,
    jsonLd,
    corps,
  });
}

function pageContenu(req, page, { avecFaq = false } = {}) {
  const cfg = reglages(req);
  const questions = avecFaq ? faqDepuisMarkdown(page.corps) : [];
  const jsonLd = questions.length
    ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }]
    : [];
  const corps = `
  ${entete(cfg)}
  <section class="blk"><div class="wrap page">
    <h1>${ech(page.titre)}</h1>
    ${corpsMarkdown(page.corps)}
  </div></section>
  ${pied(cfg)}`;
  return pageHTML({
    cfg,
    titre: `${page.titre} — ${cfg.nom_boutique}`,
    description: page.meta_desc || `${page.titre} chez ${cfg.nom_boutique}.`,
    url: `${cfg._url}/${page.slug}`,
    image: '/media/demo/lookbook.jpg',
    jsonLd,
    corps,
  });
}

/* Markdown très court : titres ##, listes - , paragraphes, gras. De quoi
   écrire une FAQ depuis l'admin sans rien installer. */
function corpsMarkdown(texte) {
  const lignes = String(texte || '').replace(/\r/g, '').split('\n');
  const out = [];
  let liste = false;
  const inline = (t) => ech(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  for (const l of lignes) {
    if (/^##\s+/.test(l)) {
      if (liste) { out.push('</ul>'); liste = false; }
      out.push(`<h2>${inline(l.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^[-*]\s+/.test(l)) {
      if (!liste) { out.push('<ul>'); liste = true; }
      out.push(`<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (!l.trim()) {
      if (liste) { out.push('</ul>'); liste = false; }
    } else {
      if (liste) { out.push('</ul>'); liste = false; }
      out.push(`<p>${inline(l)}</p>`);
    }
  }
  if (liste) out.push('</ul>');
  return out.join('\n');
}

/* ---------------- document ---------------- */
/* Origine absolue : indispensable pour canonical / og:url / le sitemap.
  SITE_URL en variable d'environnement si tu veux forcer un domaine, sinon on
   reprend celui par lequel la cliente est arrivée (Render, IP, domaine perso). */
function baseAbsolue(req) {
  const force = (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (force) return force;
  if (!req) return '';
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const h = req.headers['x-forwarded-host'] || req.headers.host || '';
  return h ? `${proto}://${h}` : '';
}

function reglages(req) {
  return {
    nom_boutique: getSetting('nom_boutique', 'CHEZ FATOUCHA'),
    slogan: getSetting('slogan', ''),
    boutique_description: getSetting('boutique_description', ''),
    telephone: getSetting('telephone', ''),
    whatsapp: getSetting('whatsapp', ''),
    adresse_retrait: getSetting('adresse_retrait', ''),
    horaires_retrait: getSetting('horaires_retrait', ''),
    livraison_gratuite_a_partir: getSetting('livraison_gratuite_a_partir', '0'),
    seo_keywords: getSetting('seo_keywords', ''),
    _url: baseAbsolue(req),
  };
}

function entreprise(cfg) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ClothingStore',
    name: cfg.nom_boutique || 'CHEZ FATOUCHA',
    url: cfg._url + '/',
    telephone: cfg.telephone || undefined,
    image: cfg._url + '/media/favicon.svg',
    description: cfg.boutique_description || undefined,
    address: { '@type': 'PostalAddress', addressLocality: 'Dakar', addressCountry: 'SN', streetAddress: cfg.adresse_retrait || undefined },
    openingHours: 'Mo-Sa 09:00-19:00',
    paymentAccepted: 'Wave, Orange Money, Espèces',
    priceRange: '2000 - 50000 XOF',
    areaServed: 'SN',
  };
}

function pageHTML({ cfg, titre, description, url, image, type = 'website', prix = null, jsonLd = [], corps, robots = 'index,follow' }) {
  const ogImage = image ? (image.startsWith('http') ? image : (cfg._url || '') + image) : (cfg._url || '') + '/media/demo/lookbook.jpg';
  const ogImageOpt = image && !image.startsWith('http') ? (cfg._url || '') + optima.urlPour(image, 900) : ogImage;
  const schema = jsonLd
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n  ');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${ech(titre)}</title>
  <meta name="description" content="${ech(String(description || '').slice(0, 300))}" />
  ${cfg.seo_keywords ? `<meta name="keywords" content="${ech(cfg.seo_keywords)}" />` : ''}
  <meta name="robots" content="${robots}" />
  ${cfg._url ? `<link rel="canonical" href="${ech(url)}" />` : ''}
  <meta name="theme-color" content="#f7f3ec" />
  <meta property="og:type" content="${type === 'product' ? 'product' : 'website'}" />
  <meta property="og:site_name" content="${ech(cfg.nom_boutique || 'CHEZ FATOUCHA')}" />
  <meta property="og:title" content="${ech(titre)}" />
  <meta property="og:description" content="${ech(String(description || '').slice(0, 200))}" />
  ${cfg._url ? `<meta property="og:url" content="${ech(url)}" />` : ''}
  <meta property="og:image" content="${ech(ogImageOpt)}" />
  <meta property="og:image:width" content="900" /><meta property="og:image:height" content="1200" />
  <meta property="og:locale" content="fr_SN" />
  ${type === 'product' && prix ? `<meta property="product:price:amount" content="${prix}" /><meta property="product:price:currency" content="XOF" />` : ''}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ech(titre)}" />
  <meta name="twitter:image" content="${ech(ogImageOpt)}" />
  <link rel="icon" href="/media/favicon.svg" />
  <link rel="apple-touch-icon" href="/media/icone-192.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/css/style.css" />
  ${schema}
</head>
<body>
  <a class="saute" href="#boutique-grid">Aller aux articles</a>
  <div id="app">
${corps}
  </div>
  <div id="toast-root" aria-live="polite"></div>
  <noscript><div class="wrap"><div class="banner warn">Le site a besoin de JavaScript pour le panier et le paiement — les prix, photos et guide des tailles restent lisibles ici. 📱 WhatsApp : <a href="https://wa.me/${ech(String(cfg.whatsapp || '').replace(/\D/g, ''))}">${ech(cfg.telephone || '')}</a></div></div></noscript>
  <script src="/js/api.js"></script>
  <script src="/js/app.js"></script>
</body>
</html>`;
}

/* Questions/réponses d'une page de contenu (pour le balisage FAQPage). */
function faqDepuisMarkdown(corps) {
  const paires = [];
  let courant = null;
  for (const l of String(corps || '').split('\n')) {
    if (/^##\s+/.test(l)) {
      if (courant && courant[1].trim()) paires.push(courant);
      courant = [l.replace(/^##\s+/, '').trim(), ''];
    } else if (courant && l.trim() && !/^[-*]\s/.test(l)) {
      courant[1] = (courant[1] + ' ' + l.trim()).trim();
    }
  }
  if (courant && courant[1].trim()) paires.push(courant);
  return paires.slice(0, 12);
}

/* Page de confirmation d'une commande en espèces : un simple bouton, aucun
   compte, aucun JavaScript nécessaire (le lien est envoyé sur WhatsApp). */
function confirmation(req, { cmd, dejaConfirme = false, ok = false, erreur = '', introuvable = false }) {
  const cfg = reglages(req);
  /* `introuvable` : référence inconnue ou code qui ne colle pas. On n'affiche alors
     ni le récapitulatif ni le bouton « je confirme » — il n'y a rien à confirmer. */
  const corps = `
  ${entete(cfg)}
  <section class="blk"><div class="wrap center cadre-confiance">
    <h1>${introuvable ? 'Ce lien ne correspond à aucune commande' : cmd.statut === 'annulee' ? 'Cette commande est annulée' : ok || dejaConfirme || cmd.client_confirme_le ? 'Commande confirmée ✔' : 'Confirme ta commande'}</h1>
    ${introuvable
      ? `<p class="muted">Référence <span class="mono">${ech(cmd.reference)}</span> — soit le code de six lettres qui termine le lien n'est pas le bon, soit la commande a été annulée et le stock est reparti en rayon.</p>`
      : `<p class="muted">Référence <span class="mono">${ech(cmd.reference)}</span> · ${ech(cmd.client)} · ${fcfa(cmd.total)}${cmd.frais ? ` (dont livraison ${fcfa(cmd.frais)})` : ''}</p>`}
    ${erreur ? `<div class="banner ko">${ech(erreur)}</div>` : ''}
    ${!introuvable && cmd.code_confirmation ? `<div class="code-conf"><span class="et">${cmd.paiement === 'especes' ? (cmd.mode === 'retrait' ? 'Code à donner en boutique' : 'Code à donner au livreur') : 'Code de confirmation'}</span><b>${ech(cmd.code_confirmation)}</b></div>` : ''}
    ${introuvable ? '' : `<div class="recap">
      <div><span class="muted">Sous-total</span><span>${fcfa(cmd.sous_total || 0)}</span></div>
      <div><span class="muted">Livraison</span><span>${cmd.frais ? fcfa(cmd.frais) : 'offerte'}</span></div>
      ${(cmd.acompte || 0) > 0 ? `<div><span class="muted">Acompte à envoyer</span><span>${fcfa(cmd.acompte)}</span></div>
        <div><span class="muted">Reste à payer ${cmd.mode === 'retrait' ? 'au retrait' : 'au livreur'}</span><span>${fcfa(cmd.reste_a_payer || 0)}</span></div>` : ''}
      <div class="tot"><span>Total commande</span><span>${fcfa(cmd.total)}</span></div>
    </div>`}
    ${introuvable
      ? `<div class="banner warn">Pas de panique : écris « ${ech(cmd.reference)} » à la boutique sur WhatsApp, ou reprends le suivi avec ton numéro depuis <a href="/suivi">Suivre ma commande</a>. Si rien n’apparaît là non plus, la commande n’a pas abouti — rien ne t’a été demandé.</div>`
      : ok || dejaConfirme || cmd.client_confirme_le
        ? `<div class="banner ok">Merci ✔ La boutique est prévenue : on t’appelle avant que le livreur parte.${cmd.paiement === 'especes' ? `<br>À préparer : <b>${fcfa(cmd.reste_a_payer || cmd.total)}</b> à donner ${cmd.mode === 'retrait' ? 'au retrait' : 'au livreur'}.</div>` : '</div>'}</div>`
        : cmd.statut === 'annulee'
          ? '<div class="banner warn">Le stock est reparti en rayon. Pour recommander : <a href="/boutique">retour à la boutique</a>.</div>'
          : `<div class="bloc">
             <p>Un clic et la boutique sait que tu es bien prête à recevoir. Ça évite qu'un livreur parte pour rien — et ça garde ta commande vivante.</p>
             <form method="post" action="/confirmer/${ech(cmd.reference)}/${ech(cmd.code_confirmation || '')}">
               <button class="btn gold big" type="submit">✔ Oui, je confirme ma commande</button>
             </form>
             <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px">
               <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/${ech(String(cfg.whatsapp || cfg.telephone || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Salam! Je confirme ma commande ' + cmd.reference + (cmd.code_confirmation ? ' — code ' + cmd.code_confirmation : ' ') + '.')}">Confirmer par WhatsApp</a>
             </div>
             <p class="small muted" style="margin-top:10px">Si tu ne peux pas recevoir la commande, écris-nous sur WhatsApp au ${ech(cfg.telephone || '')} avant qu’elle parte.</p>
           </div>`}
    <div class="row" style="justify-content:center;margin-top:14px">
      <a class="btn ghost" href="/suivi">Suivre ma commande</a>
      <a class="btn ghost" href="/boutique">Continuer mes achats</a>
    </div>
  </div></section>
  ${pied(cfg)}`;
  return pageHTML({
    cfg,
    titre: `${introuvable ? 'Lien de confirmation introuvable' : 'Confirmation ' + cmd.reference} — ${cfg.nom_boutique}`,
    description: 'Confirme ta commande en un clic.',
    url: `${cfg._url}/confirmer/${cmd.reference}`,
    image: '/media/demo/lookbook.jpg',
    robots: 'noindex,nofollow',
    corps,
  });
}

/* ---------------- sitemap & robots ---------------- */
function sitemap(base) {
  const maintenant = new Date().toISOString().slice(0, 10);
  const lignes = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`];
  /* Jamais de « // » dans le chemin — mais on ne touche pas au « :// » du protocole. */
  const url = (p) => `${base}/${String(p).replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  const entree = (p, priorite, freq, modif) =>
    lignes.push(`  <url><loc>${ech(url(p))}</loc><lastmod>${modif || maintenant}</lastmod><changefreq>${freq}</changefreq><priority>${priorite}</priority></url>`);
  entree('/', '1.0', 'daily');
  entree('/boutique', '0.9', 'daily');
  entree('/faq', '0.5', 'monthly');
  entree('/retours', '0.5', 'monthly');
  for (const c of db.prepare('SELECT slug, id FROM categories ORDER BY ordre').all()) entree(`/categorie/${c.slug || c.id}`, '0.7', 'weekly');
  for (const p of db.prepare('SELECT slug, id, updated_at FROM produits WHERE actif = 1 ORDER BY id DESC LIMIT 5000').all())
    entree(`/produit/${p.slug || p.id}`, '0.8', 'weekly', String(p.updated_at || '').slice(0, 10) || maintenant);
  lignes.push('</urlset>');
  return lignes.join('\n');
}

function robots(base) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /*?q=',
    '',
    '# Le back-office est protégé par identifiant ; rien d’utile à explorer ici.',
    base ? `Sitemap: ${base}/sitemap.xml` : '',
    '',
  ].filter((l, i, a) => l !== '' || i === a.length - 1).join('\n');
}

module.exports = { accueil, boutique, categorie, produit, pageContenu, confirmation, pageHTML, sitemap, robots, faqDepuisMarkdown, ech, fcfa, reglages, baseAbsolue };
