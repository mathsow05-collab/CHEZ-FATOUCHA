/* ============================================================
   CHEZ FATOUCHA — front client (SPA à hash, sans framework)
   Routes : #/  #/produit/ID  #/panier  #/commande  #/paiement/REF  #/suivi
   L'espace vendeur n'est PAS ici : c'est une page à part, servie sur /admin.
   ============================================================ */
const root = document.getElementById('app');
const state = { produits: [], vue: {}, filtreCat: null, q: '', tri: 'recent' };

/* ---------------- utils DOM ---------------- */
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const money = fcfa;
const hashPath = () => (location.hash || '#/').replace(/^#/, '');
const go = (h) => { location.hash = h; };
const img = (p) => p.image || (p.images && p.images[0]?.url) || '/media/demo/robe-boheme.svg';

function topbar(active = '') {
  return `
  <header class="top">
    <div class="wrap bar">
      <a class="brand" href="#/">
        <span class="logo">🛍️</span>
        <span><b>${esc(Shop.cfg?.nom_boutique || 'CHEZ FATOUCHA')}</b><small>DAKAR · LIVRAISON PARTOUT</small></span>
      </a>
      <nav class="main">
        <a href="#/" class="${active === 'boutique' ? 'on' : ''}">Boutique</a>
        <a href="#/suivi" class="${active === 'suivi' ? 'on' : ''}">Suivre ma commande</a>
      </nav>
      <div class="actions">
        <button class="icon-btn" data-open-search title="Rechercher">🔍<span class="hidden"> </span></button>
        <a class="icon-btn" href="#/panier" title="Panier">🧺 <span class="count" data-cart-count>0</span></a>
      </div>
    </div>
  </header>
  <div class="marquee"><div class="wrap">
    <span>🚚 Livraison <b>Dakar 1 000 F</b> · régions dès <b>3 000 F</b></span>
    <span>🏪 Retrait boutique <b>gratuit</b></span>
    <span>📱 Paiement <b>Wave</b> / <b>Orange Money</b></span>
    <span>🆓 Livraison offerte dès <b>${money(Shop.cfg?.livraison_gratuite_a_partir || 0)}</b> d’achat</span>
  </div></div>`;
}

function footer() {
  const c = Shop.cfg || {};
  return `<footer class="ft"><div class="wrap cols">
    <div>
      <h4>${esc(c.nom_boutique || 'Chez Fatoucha')}</h4>
      <div>${esc(c.boutique_description || '')}</div>
      <div style="margin-top:10px">📍 ${esc(c.adresse_retrait || '')}<br>🕘 ${esc(c.horaires_retrait || '')}</div>
    </div>
    <div>
      <h4>Aide</h4>
      <div class="stack" style="gap:6px">
        <a href="#/suivi">Suivre une commande</a>
        <a href="https://wa.me/${esc((c.whatsapp || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp ${esc(c.telephone || '')}</a>
        <a href="#/boutique">Tous les articles</a>
      </div>
    </div>
    <div>
      <h4>Paiement</h4>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        <span class="pill wave">Wave</span><span class="pill orange">Orange Money</span><span class="pill">Espèces à la livraison</span>
      </div>
      <div class="small" style="margin-top:10px">Les prix sont en FCFA, livraison calculée selon ta zone.</div>
    </div>
  </div></footer>`;
}

function card(p) {
  const promo = p.prix_barre ? Math.round((1 - p.prix / p.prix_barre) * 100) : 0;
  const flags = [
    promo > 0 ? `<span class="flag promo">-${promo}%</span>` : '',
    p.en_rupture ? '<span class="flag out">Rupture</span>' : p.stock <= 3 ? `<span class="flag rush">Plus que ${p.stock} !</span>` : '',
    p.vedette && !p.en_rupture ? '<span class="flag new">★ Vedette</span>' : '',
  ].filter(Boolean).join('');
  return `<article class="card" data-go="#/produit/${p.id}">
    <div class="ph">
      <img src="${esc(img(p))}" alt="${esc(p.titre)}" loading="lazy" onerror="this.src='/media/demo/robe-boheme.svg'" />
      <div class="flags">${flags}</div>
    </div>
    <div class="body">
      <div class="t">${esc(p.titre)}</div>
      <div class="price">${money(p.prix)}${p.prix_barre ? `<s>${money(p.prix_barre)}</s>` : ''}</div>
      <div class="foot">
        <span class="mini">🚚 ~${p.delai_jours} ${jplural(p.delai_jours)}</span>
        <button class="add-mini" data-add="${p.id}" title="Ajouter au panier" ${p.en_rupture ? 'disabled' : ''}>+</button>
      </div>
    </div>
  </article>`;
}

/* ---------------- VUE : boutique ---------------- */
async function vueBoutique() {
  const [cats, produits] = await Promise.all([
    API.get('/api/categories'),
    API.get('/api/produits' + '?' + new URLSearchParams({ ...(state.filtreCat ? { categorie: state.filtreCat } : {}), ...(state.q ? { q: state.q } : {}), tri: state.tri })),
  ]);
  state.produits = produits;
  const dispo = produits.filter((p) => !p.en_rupture).length;
  return `
  ${topbar('boutique')}
  <section class="hero"><div class="wrap"><div class="inner">
    <h1>La mode qui t’aime, <em>livrée à ta porte</em>.</h1>
    <p>Robes, ensembles, sacs, chaussures, parfums… choisis ta taille et ta quantité, paie par Wave ou Orange Money. On livre à Dakar et dans toutes les régions — ou tu viens retirer à la boutique.</p>
    <div class="cta">
      <a class="btn gold big" href="#boutique-grid">Voir les ${produits.length} articles</a>
      <a class="btn ghost big" href="#/suivi">📦 Suivre ma commande</a>
    </div>
    <div class="stats">
      <div><b>${dispo}</b> articles disponibles</div>
      <div><b>24 h</b> livraison Dakar</div>
      <div><b>1 000 F</b> frais dès le quartier d’à côté</div>
      <div><b>Wave / OM</b> paiement direct</div>
    </div>
  </div></div></section>

  <section class="blk"><div class="wrap">
    <div class="cats" id="cats">
      <button class="cat ${!state.filtreCat ? 'on' : ''}" data-cat="">✨ Tout</button>
      ${cats.map((c) => `<button class="cat ${String(state.filtreCat) === String(c.id) ? 'on' : ''}" data-cat="${c.id}">${c.emoji} ${esc(c.name)} <span class="n">${c.n}</span></button>`).join('')}
    </div>
  </div></section>

  <section class="blk" id="boutique-grid"><div class="wrap">
    <div class="blk-head">
      <div>
        <h2>${state.q ? `Résultats pour « ${esc(state.q)} »` : state.filtreCat ? cats.find((c) => String(c.id) === String(state.filtreCat))?.name || 'Catégorie' : 'Nouveautés & bons plans'}</h2>
        <p>${produits.length} article(s) · prix en FCFA, livraison calculée au panier</p>
      </div>
      <div class="row">
        <select class="inp" id="tri" style="height:38px;padding:0 10px;width:auto">
          ${[['recent', 'Nouveautés'], ['prix_asc', 'Prix croissant'], ['prix_desc', 'Prix décroissant'], ['alpha', 'A → Z']]
            .map(([v, l]) => `<option value="${v}" ${state.tri === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    ${produits.length ? `<div class="grid">${produits.map(card).join('')}</div>`
      : `<div class="empty"><div class="big">🧺</div>Aucun article ne correspond.<br><button class="link" data-clear>Enlever les filtres</button></div>`}
  </div></section>
  ${footer()}`;
}

/* ---------------- VUE : fiche produit ---------------- */
async function vueProduit(id) {
  let p;
  try { p = await API.get('/api/produits/' + id); }
  catch { return `<div class="wrap" style="padding:60px 16px"><h2>Article indisponible</h2><p>Cet article n’est plus au catalogue.</p><a class="btn" href="#/">← Retour à la boutique</a></div>`; }
  state.vue = { p, taille: p.tailles[0] || null, coloris: p.coloris[0] || null, qte: 1, idx: 0 };
  const images = p.images.length ? p.images : [{ url: '/media/demo/robe-boheme.svg' }];
  const promo = p.prix_barre ? Math.round((1 - p.prix / p.prix_barre) * 100) : 0;
  return `
  ${topbar('boutique')}
  <div class="wrap" style="padding-top:18px">
    <div class="small muted" style="margin-bottom:10px">
      <a href="#/" class="link">Boutique</a>${p.categorie ? ` › <a href="#/" class="link" data-cat-jump="${p.categorie_id}">${esc(p.categorie)}</a>` : ''} › ${esc(p.titre)}
    </div>
    <div class="pd">
      <div class="gallery">
        <div class="main"><img id="gal-main" src="${esc(images[0].url)}" alt="${esc(p.titre)}" onerror="this.src='/media/demo/robe-boheme.svg'" /></div>
        ${images.length > 1 ? `<div class="thumbs">${images.map((im, i) => `<button data-thumb="${i}" class="${i === 0 ? 'on' : ''}"><img src="${esc(im.url)}" alt="" onerror="this.parentElement.remove()" /></button>`).join('')}</div>` : ''}
      </div>

      <div class="stack">
        <div>
          <div class="row" style="gap:6px;margin-bottom:6px">
            ${p.marque ? `<span class="pill">${esc(p.marque)}</span>` : ''}
            ${promo ? `<span class="pill red">-${promo}%</span>` : ''}
            ${p.en_rupture ? '<span class="pill red">Rupture de stock</span>' : `<span class="pill teal">${p.stock <= 3 ? `Plus que ${p.stock} en stock` : '✔ Disponible'}</span>`}
          </div>
          <h1>${esc(p.titre)}</h1>
          <div class="pricebox">
            <span class="price" id="pd-price">${money(p.prix)}</span>
            ${p.prix_barre ? `<s class="muted">${money(p.prix_barre)}</s>` : ''}
          </div>
        </div>

        ${p.tailles.length ? `<div class="opt"><span class="lbl">Taille</span><div class="chips" id="pd-tailles">
          ${p.tailles.map((t) => `<button class="chip ${state.vue.taille === t ? 'on' : ''}" data-taille="${esc(t)}" ${stockPour(p, t, state.vue.coloris) === 0 ? 'disabled' : ''}>${esc(t)}</button>`).join('')}
        </div></div>` : ''}
        ${p.coloris.length ? `<div class="opt"><span class="lbl">Coloris</span><div class="chips" id="pd-coloris">
          ${p.coloris.map((c) => `<button class="chip swatch ${state.vue.coloris === c ? 'on' : ''}" data-coloris="${esc(c)}"><span class="dot" style="background:${esc(teinte(c))}"></span>${esc(c)}</button>`).join('')}
        </div></div>` : ''}

        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="qty">
            <button data-q="-1">−</button><span id="pd-qte">1</span><button data-q="1">+</button>
          </div>
          <div class="small muted" id="pd-dispo"></div>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn gold big grow" data-buy ${p.en_rupture ? 'disabled' : ''}>🧺 Ajouter au panier</button>
          <button class="btn big" data-buynow ${p.en_rupture ? 'disabled' : ''}>⚡ Commander</button>
        </div>
        <p class="small muted" style="margin:0">Prix en FCFA · la livraison s’ajoute selon ta zone (gratuite si tu viens retirer).</p>

        ${p.description ? `<div class="bloc"><h3>Description</h3><div class="desc">${esc(p.description)}</div></div>` : ''}

        <div class="info-lines">
          <div class="li"><i>🚚</i><div><b>Livraison</b> — article commandé au fournisseur sous ~${p.delai_jours} ${jplural(p.delai_jours)}, puis on te l’apporte : Dakar 24-36 h, régions 2-4 j.</div></div>
          <div class="li"><i>🏪</i><div><b>Retrait gratuit</b> — ${esc(Shop.cfg?.adresse_retrait || '')} · ${esc(Shop.cfg?.horaires_retrait || '')}</div></div>
          <div class="li"><i>📱</i><div><b>Paiement</b> — Wave ou Orange Money (direct depuis le site), ou espèces à la livraison.</div></div>
          <div class="li"><i>🔁</i><div><b>Échange</b> — taille non conforme ? Préviens-nous sur WhatsApp sous 48 h.</div></div>
        </div>
      </div>
    </div>
  </div>
  <div class="mobar"><div class="in">
    <button class="btn ghost big" data-buy ${p.en_rupture ? 'disabled' : ''}>🧺 Ajouter</button>
    <button class="btn gold big" data-checkout ${p.en_rupture ? 'disabled' : ''}>Commander · ${money(p.prix)}</button>
  </div></div>
  ${footer()}`;
}

function teinte(nom) {
  const n = String(nom).toLowerCase();
  const map = [['noir', '#111'], ['blanc', '#f7f7f7'], ['rouge', '#c62828'], ['bordeaux', '#6d1b2b'], ['bleu', '#1e5bb8'], ['nuit', '#1a2340'], ['beige', '#d9c4a3'], ['doré', '#d4a017'], ['dor', '#d4a017'], ['argent', '#b8bcc0'], ['vert', '#2e7d32'], ['kaki', '#6b6b2f'], ['rose', '#e91e63'], ['mauve', '#8e6bb1'], ['jaune', '#fbc02d'], ['orange', '#ef6c00'], ['violet', '#5e35b1'], ['gris', '#78909c'], ['marron', '#6d4c41'], ['ciel', '#8ecae6']];
  for (const [k, v] of map) if (n.includes(k)) return v;
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 55%)`;
}

/* ---------------- VUE : panier ---------------- */
function vuePanier() {
  const items = Cart.read();
  if (!items.length) {
    return `${topbar('boutique')}
      <div class="wrap" style="padding:40px 16px 60px">
        <div class="empty bloc"><div class="big">🧺</div><h3>Ton panier est vide</h3>
        <p>Ajoute un article et choisis ta taille — on calcule la livraison tout de suite après.</p>
        <a class="btn gold big" href="#/">Voir la boutique</a></div>
      </div>${footer()}`;
  }
  const sous = Cart.subtotal();
  return `${topbar('boutique')}
  <div class="wrap" style="padding:20px 16px 60px">
    <h1 style="font-size:24px">🧺 Mon panier <span class="muted small">(${items.length} ligne${items.length > 1 ? 's' : ''})</span></h1>
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
        <a class="btn gold big block" href="#/commande">Passer commande →</a>
        <a class="btn ghost block" href="#/" style="margin-top:8px">Continuer mes achats</a>
      </div>
    </div>
  </div>${footer()}`;
}

/* ---------------- VUE : commande / checkout ---------------- */
async function vueCommande() {
  const items = Cart.read();
  if (!items.length) { go('#/panier'); return ''; }
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
    <h1 style="font-size:24px">🧾 Finaliser la commande</h1>
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
            <button data-mode="livraison" class="on">🚚 Livraison</button>
            <button data-mode="retrait">🏪 Retrait boutique</button>
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
          <div id="retrait-box" class="hidden banner ok">🏪 <div><b>Retrait gratuit</b> — ${esc(cfg.adresse_retrait || '')}<br><span class="small">${esc(cfg.horaires_retrait || '')}. On t’appelle dès que l’article est prêt.</span></div></div>
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
                <span class="badge" style="background:${m.couleur}">${m.id === 'wave' ? 'W' : m.id === 'orange' ? 'OM' : '💵'}</span>
                <span class="grow">
                  <b>${esc(m.libelle)}</b>
                  <div class="small muted">${m.id === 'wave' ? 'Envoi direct dans l’app Wave, on valide à la réception.' : m.id === 'orange' ? 'Push Orange Money sur ton téléphone, code PIN.' : 'Tu règles au livreur ou au retrait.'}</div>
                </span>
                <span class="n" style="font-size:12px">${cfg.paiement_mode === 'cinetpay' && m.id !== 'especes' ? 'auto ✔' : 'manuel'}</span>
              </label>`).join('')}
          </div>
          ${cfg.paiement_mode === 'cinetpay'
            ? '<div class="banner ok">🔒 Paiement automatique activé : dès que tu paies, la commande passe en préparation sans attendre.</div>'
            : '<div class="banner warn">ℹ️ Tu envoies l’argent au numéro de la boutique, la commande est validée dès confirmation (souvent en moins de 10 min).</div>'}
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
  document.getElementById('co-ship').textContent = c.mode === 'retrait' ? 'Gratuit (retrait)' : gratuit ? 'Gratuite 🎉' : money(frais);
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
        ? `⏱️ Retrait prévu ~<b>${delaiMax} ${jplural(delaiMax)}</b> après le paiement (le temps de recevoir l’article du fournisseur).`
        : '⏱️ Choisis ta zone pour estimer la date de réception.';
    } else {
      eta.className = 'banner ok';
      eta.innerHTML = `⏱️ Estimation : approvisionnement ~<b>${delaiMax} ${jplural(delaiMax)}</b> + livraison <b>${heures(zone.delai_heures)}</b> → reçu dans ~<b>${delaiMax + Math.ceil(zone.delai_heures / 24)} jours</b>.`;
    }
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
    localStorage.setItem('fatoucha_pending', JSON.stringify({ reference: r.reference, telephone: c.telephone, total: r.total }));
    Cart.clear();
    toast('Commande ' + r.reference + ' créée ✔', 'ok');
    go('#/paiement/' + r.reference);
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
  catch { return `<div class="wrap" style="padding:40px 16px"><div class="bloc"><h2>Commande introuvable</h2><a class="btn" href="#/">Retour boutique</a></div></div>`; }
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
          ? `<button class="btn big block ${cmd.paiement === 'orange' ? 'orange' : 'wave'}" data-pay>💳 Payer ${money(cmd.total)} maintenant</button>
             <p class="small muted" style="margin:0">Tu seras renvoyé·e vers la page de paiement sécurisée : choisis <b>Wave</b> ou <b>Orange Money</b>, saisis ton numéro, puis ton code secret pour valider. La commande passe en préparation toute seule.</p>`
          : cmd.paiement === 'especes'
            ? '<div class="banner ok">💵 Tu paies <b>à la livraison</b>. Tiens le montant prêt : le livreur ne rend pas toujours la monnaie.</div>'
            : `<div class="banner warn">ℹ️ Envoie d’abord l’argent au numéro de la boutique, puis appuie sur « J’ai payé » : Fatou valide dès réception.</div>`}
      </div>
      <div id="pay-manuel"></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:4px">
        <button class="btn ghost sm" data-switch="wave" ${cmd.paiement === 'wave' ? 'disabled' : ''}>Basculer sur Wave</button>
        <button class="btn ghost sm" data-switch="orange" ${cmd.paiement === 'orange' ? 'disabled' : ''}>Basculer sur Orange Money</button>
        <a class="btn ghost sm" href="https://wa.me/${esc((cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Salam! Je viens de commander ' + cmd.reference + ' (' + cmd.total + ' F) sur le site.')}" target="_blank" rel="noopener">💬 Écrire à la boutique</a>
      </div>
      <hr style="border:0;border-top:1px dashed var(--line);margin:6px 0" />
      <div class="steps">
        <div><b>1.</b> Choisis Wave ou Orange Money, puis envoie ${money(cmd.total)} à ${esc(cmd.paiement === 'orange' ? cfg.orange_numero : cfg.wave_numero)}.</div>
        <div><b>2.</b> Mets la référence <span class="mono">${esc(cmd.reference)}</span> en commentaire du transfert.</div>
        <div><b>3.</b> Dès que Fatou valide, tu reçois l’appel/SMS et l’article part en préparation.</div>
        <div><b>4.</b> Livraison estimée : ${cmd.delai_estime_jours} ${jplural(cmd.delai_estime_jours)} après validation.</div>
      </div>
      <div class="row" style="flex-wrap:wrap">
        <a class="btn ghost sm" href="#/commande/${esc(cmd.reference)}">📦 Voir le suivi</a>
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
      <div style="font-size:52px">🎉</div>
      <h2 style="margin:0">Paiement reçu — commande confirmée</h2>
      <p class="muted">Référence <b class="mono">${esc(cmd.reference)}</b> · ${money(cmd.total)}</p>
      <div class="banner ${cmd.statut === 'livree' ? 'ok' : ''}" style="text-align:left">⏱️ Livraison estimée dans ~<b>${cmd.delai_estime_jours} ${jplural(cmd.delai_estime_jours)}</b>${cmd.mode === 'retrait' ? ' — retrait : ' + esc(cfg.adresse_retrait || '') : ' — ' + esc(cmd.zone || '')}</div>
      <div class="row" style="justify-content:center">
        <a class="btn gold big" href="#/commande/${esc(cmd.reference)}">📦 Suivre ma commande</a>
        <a class="btn ghost big" href="#/">Retour boutique</a>
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
  ['livree', 'Livrée', 'Profité ! Partage une photo sur WhatsApp 😍'],
];

async function vueSuivi(ref = '', tel = '') {
  const cfg = await Shop.load();
  if (!ref) {
    return `${topbar('boutique')}
    <div class="wrap" style="padding:26px 16px 60px;max-width:520px">
      <div class="bloc stack">
        <h2 style="font-size:20px">📦 Suivre une commande</h2>
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
  catch (e) { return `${topbar('boutique')}<div class="wrap" style="padding:26px 16px"><div class="banner ko">${esc(e.message)}</div><a class="btn ghost" href="#/suivi" style="margin-top:10px">← Réessayer</a></div>${footer()}`; }
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
        ? `<div class="banner warn">💳 Paiement de <b>${money(cmd.total)}</b> en attente. <a class="link" href="#/paiement/${esc(cmd.reference)}">Payer maintenant →</a></div>` : ''}
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
      <div class="row" style="flex-wrap:wrap;margin-top:6px">
        <a class="btn ghost sm" href="https://wa.me/${esc((cfg.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('Commande ' + cmd.reference + ' — j’ai un souci / question.')}" target="_blank" rel="noopener">💬 WhatsApp</a>
        ${cmd.statut === 'nouvelle' && cmd.statut_paiement !== 'paye' ? '<button class="btn danger sm" data-cancel-ref="' + esc(cmd.reference) + '">Annuler</button>' : ''}
        <a class="btn sm ghost" href="#/">Nouvelle commande</a>
      </div>
    </div>
  </div>${footer()}`;
}

/* ---------------- routeur ---------------- */
async function render() {
  const path = hashPath();
  const m = (re) => path.match(re);

  /* « Espace vendeur » est devenu une vraie page séparée (/admin). Les vieux
     favoris #/admin... sont renvoyés là, avec leur onglet ; le code admin
     n'est jamais chargé ni affiché dans la boutique. */
  const exAdmin = path.match(/^\/admin(?:\/(\w+))?(?:[?#].*)?$/);
  if (exAdmin) {
    root.innerHTML = '<div class="boot"><div class="boot-logo">ESPACE VENDEUR</div><div class="boot-bar"><i></i></div></div>';
    location.replace('/admin' + (exAdmin[1] ? '#' + exAdmin[1] : ''));
    return;
  }

  try {
    await Shop.load();
    let html = '';
    if (m(/^\/$/)) html = await vueBoutique();
    else if (m(/^\/boutique/)) html = await vueBoutique();
    else if (m(/^\/produit\/(\d+)/)) html = await vueProduit(m(/^\/produit\/(\d+)/)[1]);
    else if (m(/^\/panier/)) html = vuePanier();
    else if (m(/^\/commande$/)) html = await vueCommande();
    else if (m(/^\/paiement\/([\w-]+)/)) html = await vuePaiement(m(/^\/paiement\/([\w-]+)/)[1]);
    else if (m(/^\/commande\/([\w-]+)/)) {
      const mm = m(/^\/commande\/([\w-]+)/);
      const tel = new URLSearchParams(location.hash.split('?')[1] || '').get('tel') || JSON.parse(localStorage.getItem('fatoucha_pending') || '{}').telephone || '';
      html = await vueSuivi(mm[1], tel);
    }
    else if (m(/^\/suivi/)) html = await vueSuivi();
    else html = await vueBoutique();
    root.innerHTML = html;
    bind(html);
    Cart.renderBadge();
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="wrap" style="padding:40px 16px"><div class="banner ko">Le site n’arrive pas à joindre le serveur (${esc(e.message)}). Vérifie que le serveur tourne, puis recharge.</div></div>`;
  }
}

/* ---------------- événements ---------------- */
function bind() {
  const path = hashPath();

  document.querySelectorAll('[data-go]').forEach((c) =>
    c.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-add]')) return;
      go(c.dataset.go);
    }));

  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = Number(b.dataset.add);
      let p = state.produits.find((x) => x.id === id);
      if (!p) p = await API.get('/api/produits/' + id);
      if (p.tailles?.length || p.coloris?.length) return go('#/produit/' + id);
      Cart.add(p, { quantite: 1 });
      toast('Ajouté au panier ✔ ' + p.titre, 'ok');
    }));

  document.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => { state.filtreCat = b.dataset.cat || null; render(); }));
  document.querySelector('#tri')?.addEventListener('change', (e) => { state.tri = e.target.value; render(); });
  document.querySelector('[data-clear]')?.addEventListener('click', () => { state.filtreCat = null; state.q = ''; render(); });
  document.querySelector('[data-open-search]')?.addEventListener('click', openSearch);
  document.querySelector('[data-cat-jump]')?.addEventListener('click', (e) => { state.filtreCat = e.target.dataset.catJump; render(); });

  /* fiche produit */
  if (/^\/produit\//.test(path)) bindProduit();
  if (/^\/panier/.test(path)) bindPanier();
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
    if (d) d.innerHTML = s > 0 ? `✔ <b>${s}</b> en stock${v.taille ? ' en taille ' + esc(v.taille) : ''}` : '✖ Combinaison épuisée';
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
  document.querySelectorAll('[data-taille]').forEach((b) => b.addEventListener('click', () => { v.taille = b.dataset.taille; v.qte = 1; majDispo(); }));
  document.querySelectorAll('[data-coloris]').forEach((b) => b.addEventListener('click', () => { v.coloris = b.dataset.coloris; majDispo(); }));
  document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const s = stockPour(p, v.taille, v.coloris);
    v.qte = Math.max(1, Math.min(s || 1, v.qte + Number(b.dataset.q)));
    document.getElementById('pd-qte').textContent = v.qte;
    const cn = document.querySelector('[data-checkout]');
    if (cn) cn.textContent = 'Commander · ' + money(p.prix * v.qte);
  }));
  document.querySelectorAll('[data-thumb]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById('gal-main').src = p.images[Number(b.dataset.thumb)].url;
    document.querySelectorAll('[data-thumb]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  }));
  const ajouter = () => {
    if (p.tailles.length && !v.taille) return toast('Choisis une taille.', 'ko');
    if (stockPour(p, v.taille, v.coloris) < 1) return toast('Cette combinaison est épuisée.', 'ko');
    Cart.add(p, { taille: v.taille, coloris: v.coloris, quantite: v.qte });
    toast('Ajouté au panier ✔', 'ok');
  };
  document.querySelector('[data-buy]')?.addEventListener('click', ajouter);
  document.querySelector('[data-checkout]')?.addEventListener('click', () => { ajouter(); go('#/commande'); });
  document.querySelector('[data-buynow]')?.addEventListener('click', () => {
    if (p.tailles.length && !v.taille) return toast('Choisis une taille.', 'ko');
    if (stockPour(p, v.taille, v.coloris) < 1) return toast('Cette combinaison est épuisée.', 'ko');
    Cart.add(p, { taille: v.taille, coloris: v.coloris, quantite: v.qte });
    go('#/commande');
  });
  majDispo();
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
  }));
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
      if (document.body.contains(btn)) btn.textContent = '💳 Payer ' + money(pend.total || 0);
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

  document.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (!confirm('Annuler cette commande ? Le stock retournera en rayon.')) return;
    try { await API.post('/api/commandes/' + ref + '/annuler', { telephone: pend.telephone }); toast('Commande annulée.', 'ok'); go('#/'); }
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
      <div class="small muted">${esc(r.message || '')}${r.fallback_ussd ? `<br>⌨️ Ou compose <span class="mono">${esc(r.fallback_ussd)}</span>` : ''}</div>
      <h4 style="margin:6px 0 0">2 · Confirme l’envoi</h4>
      <div class="small muted">Envoie la capture de la transaction sur WhatsApp pour une validation express :</div>
      <a class="btn gold" target="_blank" rel="noopener" href="https://wa.me/${esc((Shop.cfg?.whatsapp || '').replace(/\D/g, ''))}?text=${encodeURIComponent('J’ai envoyé ' + r.montant + ' F (ref ' + r.reference + '). Voici la capture du paiement.')}" style="width:100%">💬 Envoyer la preuve</a>
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
    if (!ok) { e.target.textContent = 'Pas encore vu — envoie la preuve 😉'; }
  });
}

async function verifierPaiement(ref, btn) {
  for (let i = 0; i < 8; i++) {
    try {
      const s = await API.get('/api/paiement/statut/' + encodeURIComponent(ref));
      if (s.statut_paiement === 'paye') {
        if (btn) btn.textContent = 'Paiement reçu ✔';
        toast('Paiement confirmé, commande validée 🎉', 'ok');
        setTimeout(() => go('#/commande/' + ref), 700);
        return true;
      }
    } catch { /* réseau */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  toast('Paiement pas encore confirmé — envoie la preuve sur WhatsApp, Fatou validera.', 'warn');
  return false;
}

function bindSuivi() {
  document.getElementById('btn-suivi')?.addEventListener('click', () => {
    const ref = document.getElementById('s-ref').value.trim().toUpperCase();
    const tel = document.getElementById('s-tel').value.trim();
    if (!ref) return document.getElementById('suivi-err').innerHTML = '<div class="banner ko">Il me faut la référence.</div>';
    localStorage.setItem('fatoucha_last_ref', ref);
    localStorage.setItem('fatoucha_last_tel', tel);
    go('#/commande/' + ref + '?tel=' + encodeURIComponent(tel));
  });
}

function openSearch() {
  const m = el(`<div class="modal"><div class="sheet" style="max-width:560px">
    <div class="hd"><h3 style="margin:0">🔍 Rechercher un article</h3><button class="close" data-x>✕</button></div>
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
      res.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { close(); go('#/produit/' + b.dataset.p); }));
    } catch (e) { res.innerHTML = '<div class="banner ko">' + esc(e.message) + '</div>'; }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 220); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { close(); state.q = input.value.trim(); render(); } });
  input.focus();
}

window.addEventListener('hashchange', render);
/* Le panier change → on rafraîchit la vue panier seulement (sinon on écraserait
   le formulaire de commande ou la page de paiement en cours de navigation). */
window.addEventListener('cart:change', () => { if (/^\/panier/.test(hashPath()) && !state.soumission) render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.remove());
});
render();
