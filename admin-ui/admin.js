/* ============================================================
   CHEZ FATOUCHA — ESPACE ADMIN (page autonome, URL /admin)
   Inaccessible depuis la boutique : aucun lien, aucun menu. Ouvre
   cette page puis connecte-toi. Produits, commandes (validation du
   paiement + statuts), zones de livraison, réglages.
   ============================================================ */
const TOKEN_KEY = 'fatoucha_admin_token';
const VUES = ['dash', 'commandes', 'produits', 'avis', 'contenus', 'zones', 'reglages', 'entonnoir'];
const S = {
  vue: 'dash', pret: false,
  commandes: { filtre: 'toutes', q: '' },
  produits: { q: '', etat: 'tous' },
  avis: { etat: 'en_attente' },
  entonnoir: { jours: 30 },
};
const vueDuHash = () => (location.hash || '').replace(/^#\/?/, '').split('?')[0];
const monogramme = () => (A.cfg?.nom_boutique || 'CHEZ FATOUCHA').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join('').toUpperCase() || 'CF';
let A = null; // conteneur racine (#adm-root)

/* --------- helpers --------- */
const A_el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
/* Onglet = hash interne (#commandes) : l'URL de base reste /admin (rien à
   configurer côté serveur) et le bouton retour du navigateur fonctionne. */
const A_go = (v) => {
  const cible = '#' + v;
  if (location.hash === cible) return dessiner();
  location.hash = cible;
};

function modal(titre, contenu, large = false) {
  const m = A_el(`<div class="modal"><div class="sheet" ${large ? 'style="max-width:1080px"' : ''}>
    <div class="hd"><h3 style="margin:0">${titre}</h3><button class="close" data-x>✕</button></div><div class="md-body"></div></div></div>`);
  m.querySelector('.md-body').appendChild(typeof contenu === 'string' ? A_el(`<div>${contenu}</div>`) : contenu);
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) m.remove(); });
  document.body.appendChild(m);
  return { root: m, close: () => m.remove() };
}

async function aReq(method, url, body) {
  const headers = { Authorization: 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (A && S.pret) { S.pret = false; rendreLogin('Session expirée : reconnecte-toi.'); }
    throw new Error('Session expirée, reconnecte-toi.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) throw new Error((data && data.error) || 'Erreur ' + res.status);
  return data;
}

/* --------- coquille --------- */
function coquille() {
  const tabs = [
    ['dash', 'Tableau de bord', 'graphique'], ['commandes', 'Commandes', 'colis'], ['produits', 'Produits', 'robe'],
    ['avis', 'Avis', 'etoile'], ['contenus', 'Contenus', 'document'], ['zones', 'Zones & délais', 'camion'],
    ['reglages', 'Réglages', 'reglages'], ['entonnoir', 'Entonnoir', 'ondule'],
  ];
  return `
  <div class="adm-shell">
    <header class="adm-top"><div class="in">
      <span class="brand"><span class="logo">${esc(monogramme())}</span><span><b>${esc(A.cfg?.nom_boutique || 'CHEZ FATOUCHA')}</b><small>Espace vendeur — privé</small></span></span>
      <nav class="adm-tabs">${tabs.map(([k, l, ic]) => `<a href="#${k}" class="${S.vue === k ? 'on' : ''}" data-tab="${k}">${icone(ic, { taille: 16 })}<span>${l}</span></a>`).join('')}</nav>
      <div class="who">
        <span class="private-flag">${icone('cadenas', { taille: 14 })} ${esc(A.who?.admin?.display_name || A.who?.admin?.username || '')}</span>
        <a class="btn sm ghost" href="/" target="_blank" rel="noopener">Voir la boutique</a>
        <button class="btn sm ghost" data-logout>Quitter</button>
      </div>
    </div></header>
    <main class="adm-main" id="admin-body"></main>
    <footer class="adm-foot">Espace de gestion : les clientes n'ont pas ce lien et ne voient ni les prix d'achat, ni les liens fournisseurs.<span id="adm-mode"></span></footer>
  </div>`;
}

async function dessiner() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  try {
    A.cfg = await API.get('/api/config');
    document.querySelectorAll('[data-tab]').forEach((a) => {
      a.classList.toggle('on', a.dataset.tab === S.vue);
      a.addEventListener('click', (e) => { e.preventDefault(); A_go(a.dataset.tab); });
    });
    const mode = document.getElementById('adm-mode');
    if (mode) mode.textContent = A.paiement_mode === 'cinetpay'
      ? ' · Paiement Wave / Orange Money automatique ✔'
      : ' · Paiement : validation manuelle à cocher dans l’onglet Commandes.';
    if (S.vue === 'dash') await vueDash(body);
    else if (S.vue === 'commandes') await vueCommandes(body);
    else if (S.vue === 'produits') await vueProduits(body);
    else if (S.vue === 'avis') await vueAvis(body);
    else if (S.vue === 'contenus') await vueContenus(body);
    else if (S.vue === 'entonnoir') await vueEntonnoir(body);
    else if (S.vue === 'zones') await vueZones(body);
    else if (S.vue === 'reglages') await vueReglages(body);
  } catch (e) {
    if (e.message !== 'Session expirée, reconnecte-toi.') body.innerHTML = `<div class="banner ko">${esc(e.message)}</div>`;
  }
  A_pictos();
}

/* L'espace vendeur est rempli de libellés courts (« 💾 Enregistrer », « 📤 Glisse tes
   photos »). Plutôt que de retoucher quarante chaînes une à une — et d'en rater une —
   on passe le HTML posé dans le même filtre que la boutique : tout pictogramme
   coloré ressort en tracé dessiné, dans la langue graphique du thème. */
function A_pictos(racine) {
  if (typeof sansPictos !== 'function') return;
  const hote = racine || document.body;
  for (const el of hote.querySelectorAll('.btn, .drop, h1, h2, h3, .tag, .small, .private-flag, .cat, label, [data-logout]')) {
    if (el.querySelector('.ico')) continue;
    const net = sansPictos(el.innerHTML);
    if (net !== el.innerHTML) el.innerHTML = net;
  }
  /* les « ::placeholder » ne peuvent pas contenir de dessin : on y retire
     simplement le pictogramme, l'indication de recherche reste lisible */
  for (const el of hote.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    const net = sansPictos(el.getAttribute('placeholder'));
    if (net !== el.getAttribute('placeholder')) el.setAttribute('placeholder', net.replace(/<[^>]+>/g, '').trim());
  }
}

/* --------- login --------- */
function rendreLogin(msg) {
  A.innerHTML = `<div class="adm-login"><div class="card-box">
    <div class="lock">${icone('cadenas', { taille: 26 })}</div>
    <h1>Espace vendeur</h1>
    <p class="sub">Réservé à la boutique — les clientes restent sur le catalogue.</p>
    <div class="stack">
      <div class="field"><label for="l-u">Identifiant</label><input id="l-u" class="inp" autocomplete="username" /></div>
      <div class="field"><label for="l-p">Mot de passe</label><input id="l-p" class="inp" type="password" autocomplete="current-password" /></div>
      <button class="btn gold big block" id="l-btn">Se connecter</button>
      <div id="l-err">${msg ? `<div class="banner ko">${esc(msg)}</div>` : ''}</div>
      <div class="note">Identifiants définis au déploiement par <span class="mono">ADMIN1_USERNAME</span> / <span class="mono">ADMIN1_PASSWORD</span> (fichier <span class="mono">.env</span> en local, <em>Variables</em> dans Render).</div>
    </div></div></div>`;
  const submit = async () => {
    const u = document.getElementById('l-u').value.trim();
    const p = document.getElementById('l-p').value;
    const btn = document.getElementById('l-btn');
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      const r = await API.post('/api/admin/login', { username: u, password: p });
      localStorage.setItem(TOKEN_KEY, r.token);
      toast('Bonjour ' + (r.admin.display_name || r.admin.username), 'ok');
      mont();
    } catch (e) {
      document.getElementById('l-err').innerHTML = `<div class="banner ko">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Se connecter';
    }
  };
  document.getElementById('l-btn').addEventListener('click', submit);
  document.getElementById('l-p').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

/* --------- tableau de bord --------- */
async function vueDash(body) {
  const d = await aReq('GET', '/api/admin/dashboard');
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Bonjour 👋</h2><p class="small muted" style="margin:2px 0 0">Voici la boutique maintenant. ${d.paiement_mode === 'cinetpay' ? 'Paiement automatique actif ✔' : 'Paiement : validation manuelle (ajoute tes clés CinetPay pour automatiser).'}</p></div>
    <div class="row"><button class="btn sm ghost" data-reload>↻ Actualiser</button><a class="btn sm" href="#commandes">Voir les commandes</a></div>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${fcfa(d.ca_jour)}</b><span>CA encaissé aujourd'hui</span></div>
    <div class="kpi"><b>${fcfa(d.ca_semaine)}</b><span>CA 7 jours</span></div>
    <div class="kpi"><b>${fcfa(d.ca_total)}</b><span>CA total</span></div>
    <div class="kpi"><b>${d.commandes_a_payer}</b><span>À payer (rappel ?)</span></div>
    <div class="kpi"><b>${d.commandes_a_preparer}</b><span>À préparer</span></div>
    <div class="kpi"><b>${d.commandes_en_route}</b><span>En route</span></div>
    <div class="kpi"><b>${d.produits_actifs}</b><span>Articles en ligne</span></div>
    <div class="kpi"><b style="color:${d.produits_rupture ? 'var(--ko)' : 'inherit'}">${d.produits_rupture}</b><span>En rupture</span></div>
  </div>

  <div class="pd">
    <div class="bloc stack">
      <div class="row spread"><h3 style="margin:0">Dernières commandes</h3><a class="link" href="#commandes">tout voir →</a></div>
      ${d.derniers_commandes.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Réf.</th><th>Client</th><th>Total</th><th>Paiement</th><th>Statut</th><th></th></tr></thead><tbody>
        ${d.derniers_commandes.map((c) => `<tr>
          <td class="mono small">${esc(c.reference)}</td>
          <td>${esc(c.client)}<br><span class="small muted">${esc(c.telephone)} · ${c.mode === 'retrait' ? 'retrait' : 'livraison'}</span></td>
          <td><b>${fcfa(c.total)}</b></td>
          <td><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ payé' : icone('sablier', { taille: 13 }) + ' ' + esc(c.paiement)}</span></td>
          <td><span class="tag ${c.statut}">${esc(c.statut.replace('_', ' '))}</span></td>
          <td><button class="btn sm ghost" data-open-cmd="${c.id}">Ouvrir</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Aucune commande pour l’instant. Partage le lien de la boutique !</div>'}
      ${d.stock_faible.length ? `<div class="banner warn">⚠️ Stock faible : ${d.stock_faible.map((s) => `${esc(s.titre)} (<b>${s.stock}</b>)`).join(' · ')}</div>` : ''}
    </div>
    <div class="bloc stack">
      <h3 style="margin:0">Meilleures ventes</h3>
      ${d.top_produits.length ? d.top_produits.map((t, i) => `<div class="row spread small" style="padding:6px 0;border-bottom:1px dashed var(--line)">
        <span>${i + 1}. ${esc(t.titre)}</span><span class="muted">${t.vendus} vendu(s)</span><b>${fcfa(t.ca)}</b></div>`).join('') : '<div class="small muted">Pas encore de ventes payées.</div>'}
    </div>
  </div>`;
  body.querySelector('[data-reload]')?.addEventListener('click', dessiner);
  body.querySelectorAll('[data-open-cmd]').forEach((b) => b.addEventListener('click', () => ouvrirCommande(Number(b.dataset.openCmd))));
}

/* --------- produits --------- */
async function vueProduits(body) {
  const [rows, cats] = await Promise.all([
    aReq('GET', '/api/admin/produits?' + new URLSearchParams(S.produits)),
    aReq('GET', '/api/admin/categories'),
  ]);
  A.cats = cats;
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Produits <span class="muted small">(${rows.length})</span></h2>
      <p class="small muted" style="margin:2px 0 0">Ajoute tes propres articles : photo, prix FCFA, tailles, stock, délai.
      ${(() => {
        const avec = rows.filter((r) => r.video);
        const vertical = avec.filter((r) => r.video.format === 'vertical').length;
        const mots = (n) => n + (n > 1 ? ' articles' : ' article');
        if (S.produits.etat === 'shorts') {
          return avec.length
            ? `<b>${mots(avec.length)} avec un Short (portrait)</b> — la rubrique « Shorts » de l’accueil en montre ${avec.length}.`
            : `<span class="tag nouvelle">aucun Short enregistré</span> — un lien <span class="mono">youtube.com/shorts/…</span> collé dans une fiche la fait entrer ici et sur l’accueil.`;
        }
        return avec.length
          ? `<b>${mots(avec.length)} sur ${rows.length} ont une vidéo</b>${vertical ? `, dont ${vertical} en Short (portrait)` : ''}.`
          : `<span class="tag nouvelle">aucune vidéo enregistrée</span> sur ${rows.length} articles — tant que le champ n’est pas rempli dans l’article, la fiche n’a rien à afficher.`;
      })()}</p></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn sm ghost" data-filtre="tous" ${S.produits.etat === 'tous' ? 'style="border-color:var(--ink)"' : ''}>Tous</button>
      <button class="btn sm ghost" data-filtre="actifs" ${S.produits.etat === 'actifs' ? 'style="border-color:var(--ink)"' : ''}>En ligne</button>
      <button class="btn sm ghost" data-filtre="rupture" ${S.produits.etat === 'rupture' ? 'style="border-color:var(--ink)"' : ''}>Rupture</button>
      <button class="btn sm ghost" data-filtre="shorts" ${S.produits.etat === 'shorts' ? 'style="border-color:var(--ink)"' : ''}>Avec Short</button>
      <button class="btn sm ghost" data-filtre="inactifs" ${S.produits.etat === 'inactifs' ? 'style="border-color:var(--ink)"' : ''}>Masqués</button>
      <input id="p-q" class="inp" style="height:34px;width:170px" placeholder="rechercher un article…" value="${esc(S.produits.q)}" />
      <button class="btn gold" data-new>${icone('plus', { taille: 14 })} Nouvel article</button>
    </div>
  </div>
  ${rows.length ? `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>Photo</th><th>Article</th><th>Prix</th><th>Stock</th><th>Délai</th><th>Cat.</th><th>Visible</th><th>★</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td><img class="im" src="${esc(p.image || '/media/demo/robe-boheme.svg')}" onerror="this.src='/media/demo/robe-boheme.svg'" /></td>
      <td><b>${esc(p.titre)}</b><br><span class="small muted">${p.marque ? esc(p.marque) + ' · ' : ''}${p.tailles.length ? 'tailles ' + p.tailles.join('/') + ' · ' : ''}${p.lien_source ? '<a class="link" href="' + esc(p.lien_source) + '" target="_blank" rel="noopener">lien fournisseur</a>' : 'sans lien'}</span><br>${p.video ? `<span class="tag payee">${icone('lecture', { taille: 12 })} ${p.video.format === 'vertical' ? 'Short' : 'vidéo'} · ${esc(p.video.etiquette)}${p.video.miniature_du_site ? ' · miniature rangée' : ' · sans miniature'}</span>` : '<span class="small muted">sans vidéo</span>'}</td>
      <td>${fcfa(p.prix)}${p.prix_barre ? `<br><s class="small muted">${fcfa(p.prix_barre)}</s>` : ''}</td>
      <td>${p.stock > 0 ? `<b>${p.stock}</b>` : '<span class="tag annulee">0</span>'}<br><span class="small muted">${p.reserve} réservé(s)</span></td>
      <td class="small">${p.delai_jours} j</td>
      <td class="small">${esc(p.categorie || '—')}</td>
      <td><button class="btn sm ${p.actif ? 'ghost' : ''}" data-toggle="${p.id}" data-k="actif" data-v="${p.actif ? 0 : 1}">${p.actif ? '✔ en ligne' : 'masqué'}</button></td>
      <td><button class="btn sm ${p.vedette ? 'gold' : 'ghost'}" data-toggle="${p.id}" data-k="vedette" data-v="${p.vedette ? 0 : 1}">★</button></td>
      <td class="row" style="gap:4px"><button class="btn sm ghost" data-edit="${p.id}" aria-label="Modifier « ${esc(p.titre)} »" title="Modifier">${icone('crayon', { taille: 15 })}</button><button class="btn sm danger" data-del="${p.id}" aria-label="Désactiver « ${esc(p.titre)} »" title="Désactiver">${icone('poubelle', { taille: 15 })}</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : `<div class="bloc empty"><div class="big">${icone('robe', { taille: 30 })}</div><b>Aucun article.</b><br>Crée ton premier article : titre, prix, photo, tailles, stock.</div>`}
  <div class="banner">💡 Astuce : si tu as la fiche de l’article en ligne, ouvre « Nouvel article → Récupérer depuis une URL » pour récupérer la photo automatiquement, puis corrige prix et tailles.</div>`;

  body.querySelector('[data-new]')?.addEventListener('click', () => formProduit(null));
  body.querySelectorAll('[data-filtre]').forEach((b) => b.addEventListener('click', () => { S.produits.etat = b.dataset.filtre; dessiner(); }));
  body.querySelector('#p-q')?.addEventListener('input', (e) => { clearTimeout(body._t); body._t = setTimeout(() => { S.produits.q = e.target.value; dessiner(); }, 350); });
  body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    await aReq('PATCH', '/api/admin/produits/' + b.dataset.toggle, { [b.dataset.k]: Number(b.dataset.v) });
    if (b.dataset.k === 'stock') toast('Stock mis à jour', 'ok');
    dessiner();
  }));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => formProduit(rows.find((r) => r.id === Number(b.dataset.edit)))));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const dur = confirm('Supprimer DÉFINITIVEMENT cet article ?\n(Non = le masquer seulement)');
    await aReq('DELETE', '/api/admin/produits/' + b.dataset.del + (dur ? '?dur=1' : ''));
    toast(dur ? 'Article supprimé.' : 'Article masqué.', 'ok');
    dessiner();
  }));
}

/* --------- formulaire produit --------- */
async function formProduit(p) {
  const isEdit = !!p;
  let prod = p;
  if (isEdit) prod = await aReq('GET', '/api/admin/produits?' + new URLSearchParams({ q: p.titre })).then((r) => r[0] || p);
  const data = {
    titre: '', description: '', prix: '', prix_barre: '', prix_achat: '', marque: '', lien_source: '', delai_jours: 7,
    images: [], tailles: [], coloris: [], stock: 1, actif: true, vedette: false, variantes: [], categorie_id: '',
    ...(prod || {}),
  };
  const f = A_el(`<div class="stack">
    <div class="mini-form">
      <div class="field full"><label>Titre de l’article *</label><input class="inp" id="f-titre" value="${esc(data.titre)}" placeholder="Ex. Robe longue bohème fleurie" /></div>
      <div class="field full"><label>Description</label><textarea class="inp" id="f-desc" placeholder="Tissu, coupe, ce que le client doit savoir…">${esc(data.description)}</textarea></div>
      <div class="field"><label>Prix vente (FCFA) *</label><input class="inp" id="f-prix" type="number" min="50" step="50" value="${esc(data.prix)}" /></div>
      <div class="field"><label>Prix barré (promo)</label><input class="inp" id="f-prixbarre" type="number" min="0" step="50" value="${esc(data.prix_barre || '')}" /></div>
      <div class="field"><label>Prix d’achat (interne)</label><input class="inp" id="f-prixachat" type="number" min="0" step="100" value="${esc(data.prix_achat || '')}" /><span class="small muted">Pour suivre ta marge, invisible côté client.</span></div>
      <div class="field"><label>Marque / origine</label><input class="inp" id="f-marque" value="${esc(data.marque || '')}" placeholder="SHEIN, TEMU, (vendeur local)…" /></div>
      <div class="field full"><label>Lien fournisseur (à garder pour toi)</label><input class="inp" id="f-lien" value="${esc(data.lien_source || '')}" placeholder="https://…" /></div>
      <div class="field"><label>Catégorie</label><select class="inp" id="f-cat">
        <option value="">— sans catégorie —</option>
        ${(A.cats || []).map((c) => `<option value="${c.id}" ${String(data.categorie_id) === String(c.id) ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Délai d’approvisionnement (jours)</label><input class="inp" id="f-delai" type="number" min="0" max="120" value="${esc(data.delai_jours ?? 7)}" /></div>
      <div class="field"><label>Stock total (si pas de tailles)</label><input class="inp" id="f-stock" type="number" min="0" value="${esc(data.stock ?? 1)}" /></div>
      <div class="field"><label>État</label><div class="row" style="gap:16px">
        <label class="sw"><input type="checkbox" id="f-actif" ${data.actif ? 'checked' : ''} /> Visible dans la boutique</label>
        <label class="sw"><input type="checkbox" id="f-vedette" ${data.vedette ? 'checked' : ''} /> ★ Vedette (accueil)</label>
      </div></div>
    </div>

    <div class="bloc" style="background:#fff">
      <h3>📷 Photos (${data.images.length})</h3>
      <div class="imgs-admin" id="f-imgs"></div>
      <div class="drop" id="f-drop">📤 Glisse tes photos ici, ou clique pour choisir<br><span class="small muted">JPG / PNG / WEBP · 8 Mo max · la 1ʳᵉ est la photo principale</span>
        <input type="file" id="f-files" accept="image/*" multiple class="hidden" /></div>
      <div class="row" style="margin-top:8px"><input class="inp" id="f-imgurl" placeholder="…ou colle une URL d’image puis Entrée" /><button class="btn sm ghost" id="f-addurl">Ajouter</button></div>
      <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">🔗 Récupérer la photo depuis une URL produit (SHEIN, Temu, Jumia…)</summary>
        <div class="row" style="margin-top:8px"><input class="inp" id="f-impurl" placeholder="https://sst.shein.com/…  (lien de la fiche produit)" /><button class="btn sm ghost" id="f-import">Récupérer</button></div>
        <div id="f-imp-out" class="small muted"></div>
      </details>
    </div>

    <div class="bloc" style="background:#fff">
      <h3>📐 Tailles, coloris & stock par variante</h3>
      <div class="mini-form">
        <div class="field"><label>Tailles (séparées par des virgules)</label><input class="inp" id="f-tailles" value="${esc((data.tailles || []).join(', '))}" placeholder="S, M, L, XL" /></div>
        <div class="field"><label>Coloris (séparés par des virgules)</label><input class="inp" id="f-coloris" value="${esc((data.coloris || []).join(', '))}" placeholder="Noir, Beige" /></div>
      </div>
      <div style="margin-top:10px"><span class="lbl" style="font-size:12px;font-weight:800;text-transform:uppercase;color:var(--muted)">Stock par variante</span>
        <div class="var-grid" id="f-vars" style="margin-top:6px"></div></div>
      <div class="small muted" style="margin-top:6px">Laisse vide si l’article n’a qu’une taille : le stock total est utilisé. Le stock total se recalcule tout seul à partir des variantes.</div>
    </div>

    <div class="bloc" style="background:#fff">
      <h3>Vidéo &amp; réassurance <span class="small muted" style="font-weight:400;text-transform:none;letter-spacing:0">— ce qui fait acheter en ligne</span></h3>
      <div class="mini-form">
        <div class="field full"><label>Vidéo de la pièce — YouTube, <b>Short vertical</b>, TikTok, Vimeo, ou MP4 déposé ici</label>
          <div class="row" style="gap:8px">
            <input class="inp" id="f-video" value="${esc(data.video_url || '')}" placeholder="https://www.youtube.com/watch?v=…  ·  /uploads/produits/… .mp4" />
            <button class="btn sm ghost" id="f-topvideo" type="button">Téléverser</button>
            <input type="file" id="f-videofile" accept="video/mp4,video/webm" class="hidden" />
          </div>
          <input type="hidden" id="f-video-mini" value="${esc(data.video_miniature || '')}" />
          <div id="f-video-out" class="small muted"></div>
          <span class="small muted">Colle le lien de la vidéo que tu as mise sur YouTube (un Short marche aussi) : la fiche montrera une miniature, et la lecture ne démarrera que si la cliente la touche — rien de lourd pour elle. 10 secondes suffisent, le tissu qui bouge. Le lecteur est ensuite habillé par la boutique : leur barre de contrôles disparaît, leur marque reste visible mais ne se clique plus, et la vidéo s'arrête avant leur écran de suggestions — c'est ta fiche qui reprend la main. Rien n'est caché par-dessus chez eux : ce sont leurs propres réglages, et c'est la seule voie qui ne risque pas de faire bloquer tes vidéos. Laisse vide pour n'avoir que les photos. Si l'auteur de la vidéo a fermé l'intégration aux autres sites, YouTube écrira « vidéo indisponible » dans le cadre : dans ce cas, dépose le fichier avec le bouton ci-contre ou choisis une autre vidéo.</span>
        </div>
        <div class="field full"><label>Message « portée par »</label>
          <input class="inp" id="f-mannequin" value="${esc(data.mannequin || '')}" placeholder="Photo portée par Awa, 1,72 m, 58 kg — elle porte du S." />
          <span class="small muted">Affiché sous les tailles : c'est ce qui réduit le plus les retours.</span>
        </div>
      </div>
      <div style="margin-top:10px">
        <div class="row spread" style="align-items:baseline">
          <span class="lbl" style="font-size:12px;font-weight:800;text-transform:uppercase;color:var(--muted)">Guide des tailles (centimètres)</span>
          <button class="btn sm ghost" id="f-guidedup" type="button">Dupliquer la 1ʳᵉ ligne</button>
        </div>
        <div class="guide-grid" id="f-guide" style="margin-top:6px"></div>
        <div class="small muted" style="margin-top:6px">Mesure à plat ×2 pour le tour. Laisse vide si l’article est « taille unique » — le lien « Guide des tailles » disparaît de la fiche.</div>
      </div>
    </div>

    <div class="row spread" style="flex-wrap:wrap">
      <button class="btn ghost" id="f-cancel">Annuler</button>
      <div class="row"><button class="btn gold big" id="f-save">${isEdit ? '💾 Enregistrer' : '➕ Créer l’article'}</button></div>
    </div>
  </div>`);

  const M = modal(isEdit ? 'Modifier un article' : 'Nouvel article', f, true);

  /* Guide des tailles : une ligne par taille déclarée, valeurs conservées. */
  const guide = { ...(data.guide_tailles && typeof data.guide_tailles === 'object' ? data.guide_tailles : {}) };
  const COLS_GUIDE = [['poitrine', 'Poitrine'], ['taille', 'Taille'], ['hanches', 'Hanches'], ['longueur', 'Longueur']];
  const dessineGuide = () => {
    const box = f.querySelector('#f-guide');
    const tl = f.querySelector('#f-tailles').value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!tl.length) { box.innerHTML = '<div class="small muted">Déclare d’abord des tailles (S, M, L…) pour saisir un guide.</div>'; return; }
    box.innerHTML = '<span></span>' + COLS_GUIDE.map(([, l]) => `<span>${l}</span>`).join('')
      + tl.map((t) => `<b class="gt">${esc(t)}</b>` + COLS_GUIDE.map(([k]) => `<input type="number" min="20" max="300" step="1" data-gt="${esc(t)}" data-gk="${k}" value="${guide[t]?.[k] ?? ''}" />`).join('')).join('');
  };
  f.querySelector('#f-tailles').addEventListener('change', dessineGuide);
  f.querySelector('#f-guidedup').addEventListener('click', () => {
    const inputs = [...f.querySelectorAll('#f-guide [data-gt]')];
    if (inputs.length <= COLS_GUIDE.length) return toast('Ajoute au moins deux tailles à remplir.', 'ko');
    COLS_GUIDE.forEach(([, ], i) => { inputs[inputs.length - i - 1].value = inputs[COLS_GUIDE.length - i - 1].value; });
    return toast('Ligne recopiée — ajuste les centimètres.', 'ok');
  });
  const lisGuide = () => {
    const out = {};
    f.querySelectorAll('#f-guide [data-gt]').forEach((inp) => {
      const v = Math.round(Number(inp.value) || 0);
      if (v >= 20 && v <= 300) { out[inp.dataset.gt] = out[inp.dataset.gt] || {}; out[inp.dataset.gt][inp.dataset.gk] = v; }
    });
    return out;
  };
  dessineGuide();

  const imgs = data.images.map((i) => ({ url: i.url, legende: i.legende, is_main: i.is_main }));
  const drawImgs = () => {
    const box = f.querySelector('#f-imgs');
    box.innerHTML = imgs.map((im, i) => `<figure>
      <img src="${esc(im.url)}" onerror="this.parentElement.style.opacity=.4" />
      ${im.is_main ? '<span class="main">principale</span>' : ''}
      <button class="rm" data-rm-img="${i}">✕</button></figure>`).join('') || '<div class="small muted">Aucune photo — le client verra un visuel par défaut.</div>';
    box.querySelectorAll('[data-rm-img]').forEach((b) => b.addEventListener('click', () => { imgs.splice(Number(b.dataset.rmImg), 1); if (imgs[0]) imgs[0].is_main = 1; drawImgs(); }));
    f.querySelector('h3').textContent = `📷 Photos (${imgs.length})`;
  };
  drawImgs();

  /* upload */
  const drop = f.querySelector('#f-drop');
  const files = f.querySelector('#f-files');
  drop.addEventListener('click', () => files.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  const envoi = async (list) => {
    const fd = new FormData();
    [...list].forEach((x) => fd.append('files', x));
    drop.textContent = 'Envoi en cours…';
    const r = await fetch('/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) }, body: fd });
    const j = await r.json();
    drop.innerHTML = '📤 Glisse tes photos ici, ou clique pour choisir<br><span class="small muted">JPG / PNG / WEBP · 8 Mo max · la 1ʳᵉ est la photo principale</span>';
    if (!r.ok) return toast(j.error || 'Échec de l’envoi.', 'ko');
    for (const u of j.urls) imgs.push({ url: u, is_main: imgs.length ? 0 : 1 });
    drawImgs(); toast(j.urls.length + ' photo(s) ajoutée(s) ✔', 'ok');
  };
  files.addEventListener('change', () => envoi(files.files));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); envoi(e.dataTransfer.files); });

  const videoFichier = f.querySelector('#f-videofile');
  f.querySelector('#f-topvideo').addEventListener('click', () => videoFichier.click());
  videoFichier.addEventListener('change', async () => {
    const fu = videoFichier.files[0];
    if (!fu) return;
    const fd = new FormData();
    fd.append('file', fu);
    const btn = f.querySelector('#f-topvideo');
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const r = await fetch('/api/admin/upload-video', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) }, body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Envoi impossible.');
      f.querySelector('#f-video').value = j.url;
      toast('Vidéo ajoutée (' + Math.round((j.octets || 0) / 1024) + ' Ko) ✔', 'ok');
    } catch (e2) { toast(e2.message, 'ko'); }
    btn.disabled = false; btn.textContent = 'Téléverser';
  });

  /* Le lien collé est reconnu tout de suite, pour que la vendeuse voie ce que
     la fiche va devenir avant d'enregistrer. La miniature est recopiée sur le
     site à cette occasion : la fiche ne dépendra pas d'un serveur tiers pour
     afficher une image. */
  const champVideo = f.querySelector('#f-video');
  const sortieVideo = f.querySelector('#f-video-out');
  async function reconnaitreVideo() {
    const brut = champVideo.value.trim();
    if (!brut) {
      sortieVideo.innerHTML = '';
      f.querySelector('#f-video-mini').value = '';
      return;
    }
    sortieVideo.textContent = 'Lecture du lien…';
    try {
      const r = await aReq('POST', '/api/admin/video-info', { url: brut });
      const format = r.format === 'vertical' ? 'Short vertical (9:16), lu en portrait' : r.format === 'libre' ? (r.integrateur === 'lien' ? 'lien externe' : 'fichier lu directement') : 'format paysage (16:9)';
      const facon = r.integrateur === 'cadre' ? 'lecteur intégré au toucher' : r.integrateur === 'lien' ? 'la fiche mettra un bouton qui ouvre la vidéo chez le fournisseur' : 'fichier du site';
      sortieVideo.innerHTML = `<span class="tag ${r.integrateur === 'lien' ? 'nouvelle' : 'payee'}">${esc(r.etiquette)}</span> ${esc(format)} · ${esc(facon)}${r.miniature_site ? ' · miniature recopiée ✔' : ''}`
        + (r.miniature_site ? ` <button class="btn sm ghost" type="button" id="f-video-phot">Utiliser la miniature comme photo</button>` : '')
        + (r.avertissement ? `<br><span class="small muted">${esc(r.avertissement)}</span>` : '');
      f.querySelector('#f-video-mini').value = r.miniature_site || '';
      /* le lien raccourci du téléphone est remplacé par l'adresse complète :
         c'est elle qui est solide, et c'est elle que le site sait intégrer */
      if (r.url_remplacee) {
        champVideo.value = r.url_remplacee;
        sortieVideo.innerHTML += ' <span class="small muted">· lien raccourci déroulé en lien complet ✔</span>';
      }
      const bout = f.querySelector('#f-video-phot');
      if (bout) bout.addEventListener('click', () => {
        if (imgs.some((im) => im.url === r.miniature_site)) return toast('Elle est déjà dans les photos.', 'ko');
        imgs.push({ url: r.miniature_site, is_main: imgs.length ? 0 : 1 });
        drawImgs();
        toast('Miniature ajoutée aux photos ✔', 'ok');
      });
    } catch (e) {
      sortieVideo.innerHTML = `<span class="tag annulee">lien non reconnu</span> ${esc(e.message)} — YouTube, Shorts, Vimeo, TikTok, Instagram, ou un .mp4 déposé ici.`;
    }
  }
  champVideo.addEventListener('change', reconnaitreVideo);
  champVideo.addEventListener('blur', () => { if (champVideo.value.trim()) reconnaitreVideo(); });
  if (champVideo.value.trim()) reconnaitreVideo();

  f.querySelector('#f-addurl').addEventListener('click', async (e) => {
    const u = f.querySelector('#f-imgurl').value.trim();
    if (!u) return;
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Récupération…';
    try {
      const r = await aReq('POST', '/api/admin/images-from-url', { urls: u.split(/[\s,]+/).filter(Boolean) });
      (r.urls || []).forEach((x) => imgs.push({ url: x, is_main: imgs.length ? 0 : 1 }));
      f.querySelector('#f-imgurl').value = '';
      drawImgs();
      toast((r.urls || []).length + ' photo(s) ajoutée(s) ✔', 'ok');
      if (r.erreurs?.length) console.warn(r.erreurs);
    } catch (err) { toast(err.message, 'ko'); }
    btn.disabled = false; btn.textContent = 'Ajouter';
  });
  f.querySelector('#f-imgurl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.querySelector('#f-addurl').click(); } });

  f.querySelector('#f-import').addEventListener('click', async () => {
    const url = f.querySelector('#f-impurl').value.trim();
    const out = f.querySelector('#f-imp-out');
    if (!url) return;
    out.textContent = 'Lecture de la page… (5-10 s)';
    try {
      const r = await aReq('POST', '/api/admin/produits/importer-url', { url });
      if (!f.querySelector('#f-titre').value && r.titre) f.querySelector('#f-titre').value = r.titre;
      if (!f.querySelector('#f-desc').value && r.description) f.querySelector('#f-desc').value = r.description;
      (r.images || []).forEach((im) => imgs.push({ url: im.url, is_main: imgs.length ? 0 : 1 }));
      drawImgs();
      out.innerHTML = `<span class="tag payee">${(r.images || []).length} photo(s) rapatriée(s)</span> ${esc(r.message || '')}`;
      f.querySelector('#f-lien').value = url;
    } catch (e) {
      out.innerHTML = `<span class="tag annulee">échec</span> ${esc(e.message)} — téléverse plutôt la photo depuis ton téléphone.`;
    }
  });

  /* variantes */
  const drawVars = () => {
    const tailles = f.querySelector('#f-tailles').value.split(',').map((x) => x.trim()).filter(Boolean);
    const coloris = f.querySelector('#f-coloris').value.split(',').map((x) => x.trim()).filter(Boolean);
    const box = f.querySelector('#f-vars');
    const deja = new Map((data.variantes || []).map((v) => [`${v.taille || ''}|${v.coloris || ''}`, v.stock]));
    const cells = [];
    for (const t of tailles.length ? tailles : [null]) for (const c of coloris.length ? coloris : [null]) {
      if (!t && !c) continue;
      cells.push({ t, c });
    }
    box.innerHTML = cells.length
      ? cells.map((x, i) => `<label class="cell"><b>${esc(x.t || '—')}${x.c ? ' · ' + esc(x.c) : ''}</b>
          <input data-vi="${i}" type="number" min="0" value="${deja.get(`${x.t || ''}|${x.c || ''}`) ?? 1}" placeholder="stock" /></label>`).join('')
      : '<div class="small muted">Pas de taille ni de coloris : un seul stock global sera utilisé.</div>';
    box._cells = cells;
  };
  f.querySelector('#f-tailles').addEventListener('input', drawVars);
  f.querySelector('#f-coloris').addEventListener('input', drawVars);
  drawVars();

  f.querySelector('#f-cancel').addEventListener('click', M.close);
  f.querySelector('#f-save').addEventListener('click', async () => {
    const btn = f.querySelector('#f-save');
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    const box = f.querySelector('#f-vars');
    const body = {
      titre: f.querySelector('#f-titre').value,
      description: f.querySelector('#f-desc').value,
      prix: f.querySelector('#f-prix').value,
      prix_barre: f.querySelector('#f-prixbarre').value || null,
      prix_achat: f.querySelector('#f-prixachat').value || null,
      marque: f.querySelector('#f-marque').value,
      lien_source: f.querySelector('#f-lien').value,
      delai_jours: f.querySelector('#f-delai').value,
      stock: f.querySelector('#f-stock').value,
      categorie_id: f.querySelector('#f-cat').value || null,
      actif: f.querySelector('#f-actif').checked,
      vedette: f.querySelector('#f-vedette').checked,
      images: imgs.map((i, idx) => ({ ...i, is_main: idx === 0 ? 1 : i.is_main ? 1 : 0 })),
      tailles: [...new Set(imgs.length ? f.querySelector('#f-tailles').value.split(',').map((x) => x.trim()).filter(Boolean) : [])],
      coloris: f.querySelector('#f-coloris').value.split(',').map((x) => x.trim()).filter(Boolean),
      variantes: (box._cells || []).map((c, i) => ({ taille: c.t, coloris: c.c, stock: Number(box.querySelector(`[data-vi="${i}"]`)?.value) || 0 })),
      video_url: f.querySelector('#f-video').value.trim(),
      video_miniature: f.querySelector('#f-video-mini').value,
      mannequin: f.querySelector('#f-mannequin').value.trim(),
      guide_tailles: lisGuide(),
    };
    try {
      if (isEdit) await aReq('PUT', '/api/admin/produits/' + prod.id, body);
      else await aReq('POST', '/api/admin/produits', body);
      M.close(); toast(isEdit ? 'Article mis à jour ✔' : 'Article créé ✔', 'ok'); dessiner();
    } catch (e) {
      toast(e.message, 'ko');
      btn.disabled = false; btn.textContent = isEdit ? '💾 Enregistrer' : '➕ Créer l’article';
    }
  });
}

/* --------- avis clients (modération) --------- */
const ETOILES = (n) => '★★★★★'.slice(0, Math.max(0, Math.min(5, n))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(0, Math.min(5, n)));

async function vueAvis(body) {
  const etat = S.avis.etat;
  const rows = await aReq('GET', '/api/admin/avis?etat=' + encodeURIComponent(etat));
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Avis des clientes</h2>
      <p class="small muted" style="margin:2px 0 0">Rien n’apparaît en ligne sans ton feu vert. Un avis avec photo et achat vérifié convertit mieux qu’un badge de paiement.</p></div>
    <div class="row" style="gap:6px">
      ${[['en_attente', 'À valider'], ['tous', 'Tous']].map(([k, l]) => `<button class="btn sm ${etat === k ? 'gold' : 'ghost'}" data-etat="${k}">${l}</button>`).join('')}
    </div>
  </div>
  ${etat === 'en_attente' && rows.length ? `<div class="banner warn" style="margin-top:12px">${rows.length} avis en attente — publie-les vite, ils dorment sinon.</div>` : ''}
  ${rows.length ? `<div class="avis-liste" style="margin-top:12px">${rows.map((a) => `
    <article class="bloc avis-card">
      <div class="row spread" style="gap:10px;flex-wrap:wrap">
        <div><b>${esc(a.prenom || 'Anonyme')}</b> <span class="small muted">sur <a href="/produit/${esc(a.produit_slug || a.produit_id)}" target="_blank" rel="noopener">${esc(a.produit_titre || 'article #' + a.produit_id)}</a>${a.reference ? ` · commande <span class="mono">${esc(a.reference)}</span>` : ''}</span></div>
        <div class="row" style="gap:8px;align-items:center">
          <span class="avis-note" title="${a.note}/5">${ETOILES(a.note)}</span>
          ${a.achat_verifie ? '<span class="tag-ok">achat vérifié</span>' : '<span class="tag-co">non vérifié</span>'}
          ${a.approuve ? '<span class="tag-ok">en ligne</span>' : '<span class="tag-co">à valider</span>'}
        </div>
      </div>
      ${a.texte ? `<p style="margin:8px 0 0">${esc(a.texte)}</p>` : ''}
      <div class="small muted" style="margin-top:6px">${a.taille ? `Porte du ${esc(a.taille)} · ` : ''}${dateFr(a.created_at)}</div>
      ${a.photo ? `<figure class="avis-photo"><img src="${esc(a.photo)}" alt="Photo envoyée par la cliente" loading="lazy" /></figure>` : ''}
      ${a.reponse ? `<div class="avis-reponse"><b>Réponse de la boutique</b><p style="margin:4px 0 0">${esc(a.reponse)}</p></div>` : ''}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">
        ${a.approuve
          ? `<button class="btn sm ghost" data-rej="${a.id}">Retirer de la page</button>`
          : `<button class="btn sm gold" data-appr="${a.id}">Publier</button>`}
        <button class="btn sm ghost" data-rep="${a.id}">${a.reponse ? 'Modifier la réponse' : 'Répondre'}</button>
        <button class="btn sm ghost" data-edit="${a.id}">Corriger texte / note</button>
        <button class="btn sm danger" data-del="${a.id}">Supprimer</button>
      </div>
    </article>`).join('')}</div>`
    : `<div class="empty bloc" style="margin-top:12px"><div class="big">⭐</div>${etat === 'en_attente' ? 'Aucun avis en attente.' : 'Pas encore d’avis.'}<br><span class="small muted">Après une commande livrée, la cliente reçoit un lien « laisse un avis » (à envoyer depuis le détail de la commande).</span></div>`}
  `;
  body.querySelectorAll('[data-etat]').forEach((b) => b.addEventListener('click', () => { S.avis.etat = b.dataset.etat; dessiner(); }));
  const maj = async (id, patch, msg) => {
    try { await aReq('PATCH', '/api/admin/avis/' + id, patch); toast(msg, 'ok'); dessiner(); }
    catch (e) { toast(e.message, 'ko'); }
  };
  body.querySelectorAll('[data-appr]').forEach((b) => b.addEventListener('click', () => maj(b.dataset.appr, { approuve: 1 }, 'Avis publié ✔')));
  body.querySelectorAll('[data-rej]').forEach((b) => b.addEventListener('click', () => maj(b.dataset.rej, { approuve: 0 }, 'Avis retiré de la page.')));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement cet avis ?')) return;
    try { await aReq('DELETE', '/api/admin/avis/' + b.dataset.del); toast('Avis supprimé.', 'ok'); dessiner(); }
    catch (e) { toast(e.message, 'ko'); }
  }));
  body.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    const a = rows.find((x) => String(x.id) === b.dataset.rep) || {};
    const champ = A_el(`<div class="stack"><p class="small muted">Publiée sous l’avis, en clair. Une réponse honnête à un avis à 2 étoiles rassure plus que cinq avis à 5.</p>
      <div class="field"><label>Réponse</label><textarea class="inp" id="av-r" rows="4">${esc(a.reponse || '')}</textarea></div>
      <button class="btn gold block" id="av-save">Enregistrer la réponse</button></div>`);
    const M = modal('Répondre à ‘' + (a.prenom || '') + '’', champ);
    champ.querySelector('#av-save').addEventListener('click', async () => {
      try { await aReq('PATCH', '/api/admin/avis/' + a.id, { reponse: champ.querySelector('#av-r').value.trim(), approuve: 1 }); M.close(); toast('Réponse envoyée ✔ (et avis publié)', 'ok'); dessiner(); }
      catch (e) { toast(e.message, 'ko'); }
    });
  }));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const a = rows.find((x) => String(x.id) === b.dataset.edit) || {};
    const champ = A_el(`<div class="stack">
      <div class="field"><label>Note</label><input class="inp" id="av-n" type="number" min="1" max="5" value="${a.note || 5}" /></div>
      <div class="field"><label>Texte publié</label><textarea class="inp" id="av-t" rows="5">${esc(a.texte || '')}</textarea></div>
      <button class="btn gold block" id="av-save">Corriger</button></div>`);
    const M = modal('Corriger l’avis #' + a.id, champ);
    champ.querySelector('#av-save').addEventListener('click', async () => {
      try { await aReq('PATCH', '/api/admin/avis/' + a.id, { note: champ.querySelector('#av-n').value, texte: champ.querySelector('#av-t').value }); M.close(); toast('Avis corrigé ✔', 'ok'); dessiner(); }
      catch (e) { toast(e.message, 'ko'); }
    });
  }));
}

/* --------- pages de contenu (FAQ, retours, livraison, maison) --------- */
const PAGES_ADMIN = [
  ['faq', 'Questions fréquentes', 'Chaque titre “## question” devient une question dépliable — et Google l’affiche dans les résultats.'],
  ['retours', 'Retours & échanges', 'Écris-y les vrais délais : c’est la page que la cliente lit avant de payer.'],
  ['livraison', 'Livraison', 'Quartiers, délais, tarif. Le reste est calculé par les zones.'],
  ['a-propos', 'La maison', 'Ton histoire, ton quartier, comment tu choisis.'],
];

async function vueContenus(body) {
  const rows = await aReq('GET', '/api/admin/pages');
  const parSlug = {};
  rows.forEach((r) => { parSlug[r.slug] = r; });
  body.innerHTML = `
  <div><h2 style="margin:0">Pages de contenu</h2>
    <p class="small muted" style="margin:2px 0 0">Ces textes sont écrits par la boutique — ce sont eux qui répondent aux objections, pas les fiches produits. Format : du texte simple, des lignes <span class="mono">## Titre</span> pour les questions, <span class="mono">-</span> pour les listes.</p></div>
  <div class="contenus" style="margin-top:14px">${PAGES_ADMIN.map(([slug, titre, aide]) => {
    const pg = parSlug[slug];
    return `<article class="bloc contenu-card">
      <div class="row spread" style="flex-wrap:wrap;gap:8px">
        <div><b>${esc(titre)}</b> <span class="small muted mono">/${slug}</span></div>
        <div class="row" style="gap:6px">
          <a class="btn sm ghost" href="/${slug}" target="_blank" rel="noopener">Voir en ligne</a>
          <button class="btn sm gold" data-edite="${slug}">${pg ? 'Modifier' : 'Rédiger'}</button>
        </div>
      </div>
      <p class="small muted" style="margin:6px 0 0">${esc(aide)}</p>
      <div class="small" style="margin-top:8px">${pg ? `${(pg.corps || '').length} caractères · dernière écriture ${dateFr(pg.updated_at)}` : '<span class="tag-co">page vide</span>'}</div>
    </article>`;
  }).join('')}</div>`;
  body.querySelectorAll('[data-edite]').forEach((b) => b.addEventListener('click', async () => {
    const slug = b.dataset.edite;
    const def = PAGES_ADMIN.find((x) => x[0] === slug) || [];
    let pg = parSlug[slug] || null;
    try { pg = await aReq('GET', '/api/admin/pages/' + slug) || pg; } catch { /* page encore vierge */ }
    const champ = A_el(`<div class="stack">
      <div class="field"><label>Titre de la page</label><input class="inp" id="c-t" value="${esc((pg && pg.titre) || def[1] || '')}" /></div>
      <div class="field"><label>Phrase pour Google (meta description, ~155 caractères)</label><input class="inp" id="c-m" value="${esc((pg && pg.meta_desc) || '')}" /></div>
      <div class="field"><label>Texte</label><textarea class="inp mono-block" id="c-c" rows="16" placeholder="## Quelle est la taille de ma robe ?&#10;Réponse en deux ou trois phrases.">${esc((pg && pg.corps) || '')}</textarea></div>
      <div class="row" style="gap:8px">
        <button class="btn ghost" id="c-x">Annuler</button>
        <button class="btn gold big" id="c-ok" style="flex:1">Enregistrer la page</button>
      </div></div>`);
    const M = modal('Page /' + slug, champ, true);
    champ.querySelector('#c-x').addEventListener('click', () => M.close());
    champ.querySelector('#c-ok').addEventListener('click', async () => {
      const btn = champ.querySelector('#c-ok');
      btn.disabled = true; btn.textContent = 'Enregistrement…';
      try {
        await aReq('PUT', '/api/admin/pages/' + slug, {
          titre: champ.querySelector('#c-t').value.trim(),
          meta_desc: champ.querySelector('#c-m').value.trim(),
          corps: champ.querySelector('#c-c').value,
        });
        M.close(); toast('Page enregistrée — visible tout de suite sur le site ✔', 'ok'); dessiner();
      } catch (e) { btn.disabled = false; btn.textContent = 'Enregistrer la page'; toast(e.message, 'ko'); }
    });
  }));
}

/* --------- entonnoir de vente, paniers abandonnés, alertes de retour --------- */
async function vueEntonnoir(body) {
  const jours = S.entonnoir.jours;
  const [d, paniers, alertes] = await Promise.all([
    aReq('GET', '/api/admin/entonnoir?jours=' + jours),
    aReq('GET', '/api/admin/paniers?jours=' + Math.min(30, jours)).catch(() => []),
    aReq('GET', '/api/admin/alertes-stock').catch(() => []),
  ]);
  const max = Math.max(1, ...d.etapes.map((e) => e.n));
  const aRelancer = paniers.filter((x) => x.telephone && !x.a_deja_commande);
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Entonnoir de vente</h2>
      <p class="small muted" style="margin:2px 0 0">Ce que les visiteuses font, pas ce qu’on aimerait qu’elles fassent. Compteurs côté site, sans outil externe.</p></div>
    <div class="row" style="gap:6px">${[7, 30, 90].map((j) => `<button class="btn sm ${jours === j ? 'gold' : 'ghost'}" data-jours="${j}">${j} j</button>`).join('')}</div>
  </div>
  <div class="kpis" style="margin-top:14px">
    <div class="kpi"><b>${d.conversion_fiche_commande} %</b><span>Fiche → commande</span></div>
    <div class="kpi"><b>${fcfa(Math.round(d.panier_moyen || 0))}</b><span>Panier moyen</span></div>
    <div class="kpi"><b>${aRelancer.length}</b><span>Paniers à relancer</span></div>
    <div class="kpi"><b>${alertes.filter((x) => !x.notifie_le).length}</b><span>Alertes de retour</span></div>
  </div>
  <div class="bloc" style="margin-top:14px">
    <h3>Étapes</h3>
    <div class="entonnoir">${d.etapes.map((e) => `
      <div class="etape"><span class="nom">${esc(e.libelle)}</span>
        <span class="bar"><i style="width:${Math.round((e.n / max) * 100)}%"></i></span>
        <b class="n">${e.n}</b></div>`).join('')}</div>
    <p class="small muted" style="margin:10px 0 0">Le trou entre « Commandes commencées » et « Commandes enregistrées », c’est le paiement qui coince : vérifie les numéros Wave/Orange Money dans ⚙️ Réglages.</p>
  </div>
  <div class="deux-colonnes" style="margin-top:14px">
    <div class="bloc">
      <h3>Les plus vues</h3>
      ${d.top_vus.length ? `<table class="tbl"><tbody>${d.top_vus.map((x) => `<tr><td><a href="/produit/${esc(x.slug || x.id)}" target="_blank" rel="noopener">${esc(x.titre || 'article retiré')}</a></td><td style="text-align:right">${x.vues}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Aucune vue enregistrée sur la période (le compte démarre quand le site est consulté).</div>'}
    </div>
    <div class="bloc">
      <h3>Sans avis</h3>
      ${d.sans_avis.length ? `<table class="tbl"><tbody>${d.sans_avis.map((x) => `<tr><td><a href="/produit/${esc(x.slug || x.id)}" target="_blank" rel="noopener">${esc(x.titre)}</a></td><td style="text-align:right" class="small muted">à relancer</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Toutes les pièces en stock ont au moins un avis publié.</div>'}
    </div>
  </div>
  <div class="bloc" style="margin-top:14px">
    <h3>Paniers laissés en route <span class="small muted" style="font-weight:400;text-transform:none;letter-spacing:0">— ${aRelancer.length} à relancer sur ${jours} jours</span></h3>
    ${aRelancer.length ? `<table class="tbl"><thead><tr><th>Cliente</th><th>Articles</th><th>Total</th><th>Depuis</th><th></th></tr></thead><tbody>
      ${aRelancer.slice(0, 12).map((x) => {
        const msg = 'Salam' + (x.client ? ' ' + x.client.split(' ')[0] : '') + ' ! Ton panier chez Fatoucha est toujours dispo : ' + x.articles.join(', ') + ' (' + fcfa(x.total) + '). Je te le réserve ?';
        return `<tr><td><b>${esc(x.client || 'sans nom')}</b><br><span class="small muted mono">${esc(x.telephone)}</span></td>
          <td class="small">${esc(x.articles.join(' · '))}<br><span class="muted">${x.nb} article(s) · code reprise <span class="mono">${esc(x.code_reprise || '')}</span></span></td>
          <td>${fcfa(x.total)}</td>
          <td class="small muted">${dateFr(x.updated_at)}</td>
          <td style="text-align:right"><a class="btn sm gold" target="_blank" rel="noopener" href="https://wa.me/${esc(String(x.telephone).replace(/\D/g, ''))}?text=${encodeURIComponent(msg)}">Relancer</a></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="small muted">Personne n’a laissé de panier avec un numéro sur la période — ou tout le monde a fini sa commande.</div>'}
    <p class="small muted" style="margin:8px 0 0">Relance une seule fois, le lendemain avant 13h. Deux messages, c’est du harcèlement.</p>
  </div>
  <div class="bloc" style="margin-top:14px">
    <h3>Retour en stock promis</h3>
    ${alertes.length ? `<table class="tbl"><thead><tr><th>Article</th><th>Numéro</th><th>Demandé le</th><th>Stock</th><th></th></tr></thead><tbody>
      ${alertes.slice(0, 20).map((x) => `<tr>
        <td><a href="/produit/${esc(x.slug || x.produit_id)}" target="_blank" rel="noopener">${esc(x.titre)}</a></td>
        <td class="mono small">${esc(x.telephone)}</td>
        <td class="small muted">${dateFr(x.created_at)}</td>
        <td>${x.stock > 0 ? '<span class="tag-ok">dispo</span>' : '<span class="tag-co">rupture</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${x.stock > 0 ? `<a class="btn sm gold" target="_blank" rel="noopener" href="https://wa.me/${esc(String(x.telephone).replace(/\D/g, ''))}?text=${encodeURIComponent('Bonne nouvelle : « ' + x.titre + ' » est de retour chez Fatoucha. Je te la mets de côté ?')}">Prévenir</a>` : ''}
          ${x.notifie_le ? `<span class="small muted">prévenue ${dateFr(x.notifie_le)}</span>` : `<button class="btn sm ghost" data-notif="${x.id}">Marquer prévenu</button>`}
        </td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Aucune attente : personne n’a demandé à être prévenu d’un retour en stock.</div>'}
  </div>`;
  body.querySelectorAll('[data-jours]').forEach((b) => b.addEventListener('click', () => { S.entonnoir.jours = Number(b.dataset.jours); dessiner(); }));
  body.querySelectorAll('[data-notif]').forEach((b) => b.addEventListener('click', async () => {
    try { await aReq('POST', '/api/admin/alertes-stock/' + b.dataset.notif + '/notifie'); toast('Notée prévenue.', 'ok'); dessiner(); }
    catch (e) { toast(e.message, 'ko'); }
  }));
}

/* --------- commandes --------- */
const LIB_STATUT = { nouvelle: 'Nouvelle', payee: 'Payée', en_preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' };
const SUITE = { nouvelle: 'payee', payee: 'en_preparation', en_preparation: 'expediee', expediee: 'livree' };

async function vueCommandes(body) {
  const rows = await aReq('GET', '/api/admin/commandes?' + new URLSearchParams(S.commandes));
  const compte = (s) => rows.filter((r) => r.statut === s).length;
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap;gap:10px">
    <div><h2 style="margin:0">Commandes</h2><p class="small muted" style="margin:2px 0 0">Clique une ligne pour la détailer : valider le paiement, changer le statut, imprimer le bordereau livreur.</p></div>
    <div class="row" style="flex-wrap:wrap">
      <input id="c-q" class="inp" style="height:34px;width:190px" placeholder="réf., nom, téléphone…" value="${esc(S.commandes.q)}" />
      <a class="btn sm ghost" href="/api/admin/commandes-export">⬇️ CSV</a>
    </div>
  </div>
  <div class="cats">
    ${['toutes', 'nouvelle', 'payee', 'en_preparation', 'expediee', 'livree', 'annulee'].map((k) =>
      `<button class="cat ${S.commandes.filtre === k ? 'on' : ''}" data-f="${k}">${k === 'toutes' ? icone('grille', { taille: 14 }) + ' Toutes' : LIB_STATUT[k]} <span class="n">${k === 'toutes' ? rows.length : compte(k)}</span></button>`).join('')}
  </div>
  ${rows.length ? `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>Réf.</th><th>Client</th><th>Mode</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Statut</th><th></th></tr></thead>
    <tbody>${rows.map((c) => `<tr>
      <td class="mono small">${esc(c.reference)}<br><span class="muted">${dateFr(c.created_at)}</span></td>
      <td><b>${esc(c.client)}</b><br><span class="small muted"><a class="link" href="tel:${esc(c.telephone)}">${esc(c.telephone)}</a></span></td>
      <td class="small">${c.mode === 'retrait' ? '🏪 retrait' : '🚚 ' + esc(c.zone_nom || '—')}</td>
      <td class="small">${c.nb_articles} art.</td>
      <td><b>${fcfa(c.total)}</b><br><span class="small muted">dont ${fcfa(c.frais)}</span></td>
      <td><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ ' + esc(c.prestataire || '') : icone('sablier', { taille: 13 }) + ' ' + esc(c.paiement)}</span></td>
      <td><span class="tag ${c.statut}">${LIB_STATUT[c.statut]}</span></td>
      <td><button class="btn sm ghost" data-open="${c.id}">Ouvrir</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="bloc empty"><div class="big">📦</div>Aucune commande dans ce filtre.</div>'}`;

  body.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { S.commandes.filtre = b.dataset.f; dessiner(); }));
  body.querySelector('#c-q')?.addEventListener('input', (e) => { clearTimeout(body._t); body._t = setTimeout(() => { S.commandes.q = e.target.value; dessiner(); }, 350); });
  body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => ouvrirCommande(Number(b.dataset.open))));
}

async function ouvrirCommande(id) {
  const c = await aReq('GET', '/api/admin/commandes/' + id);
  const cfg = A.cfg || await API.get('/api/config');
  const zone = cfg.zones?.find((z) => z.id === c.zone_id);
  const eta = (Math.max(0, ...c.lignes.map((l) => l.delai_jours)) || 0) + (c.mode === 'livraison' ? Math.ceil((zone?.delai_heures || 24) / 24) : 1);
  const f = A_el(`<div class="stack">
    <div class="row spread" style="flex-wrap:wrap;gap:8px">
      <div><h3 class="mono" style="margin:0">${esc(c.reference)}</h3><span class="small muted">${dateFr(c.created_at)} · ${c.mode === 'retrait' ? 'retrait boutique' : 'livraison'}</span></div>
      <span class="tag ${c.statut}">${LIB_STATUT[c.statut]}</span>
    </div>
    <div class="mini-form">
      <div class="bloc" style="background:#fff"><b>${esc(c.client)}</b><br>
        <a class="link" href="tel:${esc(c.telephone)}">${esc(c.telephone)}</a>
        ${c.adresse ? `<div class="small">${esc(c.adresse)}</div>` : ''}
        ${zone ? `<div class="small muted">Zone : ${esc(zone.nom)} (${fcfa(zone.frais)}, ${heures(zone.delai_heures)})</div>` : ''}
        ${c.instructions ? `<div class="small banner" style="margin-top:6px">📝 ${esc(c.instructions)}</div>` : ''}
        <div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
          <a class="btn sm ghost" href="https://wa.me/221${esc(String(c.telephone).replace(/\D/g, '').slice(-9))}?text=${encodeURIComponent('Bonjour ' + c.client + ', ta commande CHEZ FATOUCHA ' + c.reference + ' (" + fcfa(c.total) + ")…')}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <button class="btn sm ghost" data-print>🖨 Bordereau livreur</button>
        </div>
      </div>
      <div class="bloc" style="background:#fff"><h4 style="margin:0 0 6px">Paiement</h4>
        <div class="row spread"><span>${c.paiement === 'orange' ? 'Orange Money' : c.paiement === 'especes' ? 'Espèces' : 'Wave'}</span><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ payé' : icone('sablier', { taille: 13 }) + ' en attente'}</span></div>
        <div class="small muted" style="margin-top:4px">Montant attendu : <b>${fcfa(c.total)}</b> → ${esc(c.paiement === 'orange' ? cfg.orange_numero : cfg.wave_numero)}<br>
        Transaction : <span class="mono small">${esc(c.transaction_id || '—')}</span> · Payée le : ${dateFr(c.payee_le)}</div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap">
          ${c.statut_paiement !== 'paye' ? '<button class="btn sm gold" data-mark-paid>✔ Paiement reçu</button>' : '<button class="btn sm ghost" data-unpay>Rendre « non payé »</button>'}
          <input class="inp" id="c-trx" style="height:34px" placeholder="n° transaction" value="${esc(c.transaction_id || '')}" />
        </div>
      </div>
    </div>
    <div class="bloc" style="background:#fff"><h4 style="margin:0 0 6px">Articles (${c.lignes.length})</h4>
      ${c.lignes.map((l) => `<div class="cart-line" style="grid-template-columns:46px 1fr auto">
        <div class="im" style="width:46px;height:56px"><img src="${esc(l.image || '/media/demo/robe-boheme.svg')}" onerror="this.src='/media/demo/robe-boheme.svg'" /></div>
        <div><b class="small">${esc(l.titre)}</b><div class="vr">${l.quantite} × ${fcfa(l.prix_unitaire)}${l.taille ? ' · taille ' + esc(l.taille) : ''}${l.coloris ? ' · ' + esc(l.coloris) : ''} · dispo ~${l.delai_jours} j</div>
          ${l.produit_id ? `<button class="link small" data-bought="${l.produit_id}">remettre +1 en stock</button>` : ''}</div>
        <div><b>${fcfa(l.total_ligne)}</b></div></div>`).join('')}
      <div class="summary" style="margin-top:8px">
        <div class="l"><span>Sous-total</span><span>${fcfa(c.sous_total)}</span></div>
        <div class="l"><span>Livraison</span><span>${fcfa(c.frais)}</span></div>
        <div class="l tot"><span>Total</span><span>${fcfa(c.total)}</span></div>
      </div>
      <div class="banner" style="margin-top:8px">⏱️ Estimation client : ~${eta} ${jplural(eta)} après validation du paiement.</div>
    </div>
    <div class="bloc" style="background:#fff"><h4 style="margin:0 0 8px">Faire avancer la commande</h4>
      <div class="row" style="flex-wrap:wrap">
        ${['nouvelle', 'payee', 'en_preparation', 'expediee', 'livree', 'annulee'].map((s) =>
          `<button class="btn sm ${c.statut === s ? 'gold' : 'ghost'}" data-st="${s}" ${c.statut === s ? 'disabled' : ''}>${LIB_STATUT[s]}</button>`).join('')}
      </div>
      ${SUITE[c.statut] ? `<div class="small muted" style="margin-top:8px">Prochaine étape conseillée : <b>${LIB_STATUT[SUITE[c.statut]]}</b></div>` : ''}
    </div>
  </div>`);
  const M = modal('Commande ' + c.reference, f, true);

  f.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
    await aReq('PATCH', '/api/admin/commandes/' + c.id, { statut: b.dataset.st });
    toast('Statut : ' + LIB_STATUT[b.dataset.st], 'ok'); M.close(); dessiner();
  }));
  f.querySelector('[data-mark-paid]')?.addEventListener('click', async () => {
    await aReq('POST', '/api/admin/commandes/' + c.id + '/payer', { transaction_id: f.querySelector('#c-trx').value });
    toast('Paiement validé, commande en préparation ✔', 'ok'); M.close(); dessiner();
  });
  f.querySelector('[data-unpay]')?.addEventListener('click', async () => {
    await aReq('PATCH', '/api/admin/commandes/' + c.id, { statut_paiement: 'en_attente', statut: 'nouvelle' });
    M.close(); dessiner();
  });
  f.querySelectorAll('[data-bought]').forEach((b) => b.addEventListener('click', async () => {
    const p = await aReq('GET', '/api/admin/produits?q=' + encodeURIComponent('')).then((r) => r.find((x) => x.id === Number(b.dataset.bought)));
    if (!p) return toast('Produit introuvable.', 'ko');
    await aReq('PATCH', '/api/admin/produits/' + p.id, { stock: p.stock + 1 });
    toast('Stock +1 pour ' + p.titre, 'ok');
  }));
  f.querySelector('[data-print]')?.addEventListener('click', () => imprimerBordereau(c, zone));
}

function imprimerBordereau(c, zone) {
  const w = window.open('', '_blank', 'width=760,height=900');
  if (!w) return toast('Autorise les fenêtres pop-up pour imprimer.', 'ko');
  w.document.write(`<html><head><title>Bordereau ${c.reference}</title><style>
    body{font:15px system-ui;padding:26px;color:#14110f}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:14px 0}
    td,th{border:1px solid #ccc;padding:7px;text-align:left}tfoot td{font-weight:800}.big{font-size:22px;font-weight:900}</style></head><body>
    <h1>CHEZ FATOUCHA — bordereau livreur</h1>
    <div class="big">${c.reference}</div>
    <p><b>${esc(c.client)}</b> · ${esc(c.telephone)}<br>${c.mode === 'retrait' ? 'RETRAIT BOUTIQUE' : 'LIVRAISON — ' + esc(c.adresse || '') + (zone ? ' (' + esc(zone.nom) + ')' : '')}</p>
    <table><thead><tr><th>Article</th><th>Qté</th><th>Taille</th><th>Prix</th></tr></thead><tbody>
    ${c.lignes.map((l) => `<tr><td>${esc(l.titre)}</td><td>${l.quantite}</td><td>${esc(l.taille || '—')}</td><td>${fcfa(l.total_ligne)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Total</td><td></td><td></td><td>${fcfa(c.total)}</td></tr>
    <tr><td>Livraison encaissée</td><td></td><td></td><td>${c.paiement === 'especes' ? 'À encaisser : ' + fcfa(c.total) : 'Payé ✔'}</td></tr></tfoot></table>
    <p>Paiement : ${c.paiement === 'orange' ? 'Orange Money' : c.paiement === 'especes' ? 'Espèces' : 'Wave'} · statut ${LIB_STATUT[c.statut]}</p>
    <script>window.print()<\/script></body></html>`);
  w.document.close();
}

/* --------- zones --------- */
async function vueZones(body) {
  const rows = await aReq('GET', '/api/admin/zones');
  const parVille = {};
  rows.forEach((z) => { (parVille[z.ville] ||= []).push(z); });
  body.innerHTML = `
  <div class="row spread" style="flex-wrap:wrap">
    <div><h2 style="margin:0">Zones de livraison & délais</h2><p class="small muted" style="margin:2px 0 0">Ces tarifs s’affichent au client dès qu’il choisit sa zone. Le retrait boutique est toujours gratuit.</p></div>
    <button class="btn gold" data-new>➕ Nouvelle zone</button>
  </div>
  ${Object.entries(parVille).map(([ville, list]) => `
    <div class="bloc" style="background:#fff">
      <div class="row spread"><h3 style="margin:0">${esc(ville)}</h3><span class="small muted">${list.length} zone(s) · ${fcfa(Math.min(...list.map((z) => z.frais)))} → ${fcfa(Math.max(...list.map((z) => z.frais)))}</span></div>
      <div class="tbl-scroll" style="margin-top:8px"><table class="tbl"><thead><tr><th>Zone</th><th>Frais</th><th>Délai</th><th>Visible</th><th></th></tr></thead><tbody>
      ${list.map((z) => `<tr><td>${esc(z.nom)}</td><td><b>${fcfa(z.frais)}</b></td><td>${heures(z.delai_heures)}</td>
        <td><button class="btn sm ${z.actif ? 'ghost' : ''}" data-actif="${z.id}" data-v="${z.actif ? 0 : 1}">${z.actif ? '✔ oui' : 'masquée'}</button></td>
        <td class="row" style="gap:4px"><button class="btn sm ghost" data-edit="${z.id}">✏️</button><button class="btn sm danger" data-del="${z.id}">🗑</button></td></tr>`).join('')}
      </tbody></table></div>
    </div>`).join('')}`;
  const zoneForm = (z = {}) => {
    const f = A_el(`<div class="stack">
      <div class="field"><label>Nom de la zone</label><input class="inp" id="z-nom" value="${esc(z.nom || '')}" placeholder="Ex. Pikine (Sicage, Niacou-Ndick, Yeumbeul)" /></div>
      <div class="mini-form">
        <div class="field"><label>Ville / groupe</label><select class="inp" id="z-ville">${['Dakar', 'Banlieue', 'Région', 'Autre'].map((v) => `<option ${z.ville === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Frais (FCFA)</label><input class="inp" id="z-frais" type="number" step="100" value="${esc(z.frais ?? 2000)}" /></div>
        <div class="field"><label>Délai (heures)</label><input class="inp" id="z-delai" type="number" min="1" value="${esc(z.delai_heures ?? 24)}" /></div>
        <div class="field"><label>Ordre d’affichage</label><input class="inp" id="z-ordre" type="number" value="${esc(z.ordre ?? 99)}" /></div>
      </div>
      <label class="sw"><input type="checkbox" id="z-actif" ${z.actif === undefined || z.actif ? 'checked' : ''} /> Visible côté client</label>
      <button class="btn gold big" id="z-save">💾 Enregistrer</button></div>`);
    const M = modal(z.id ? 'Modifier la zone' : 'Nouvelle zone', f);
    f.querySelector('#z-save').addEventListener('click', async () => {
      const body = { nom: f.querySelector('#z-nom').value, ville: f.querySelector('#z-ville').value, frais: f.querySelector('#z-frais').value, delai_heures: f.querySelector('#z-delai').value, ordre: f.querySelector('#z-ordre').value, actif: f.querySelector('#z-actif').checked ? 1 : 0 };
      if (z.id) await aReq('PUT', '/api/admin/zones/' + z.id, body); else await aReq('POST', '/api/admin/zones', body);
      M.close(); toast('Zone enregistrée ✔', 'ok'); dessiner();
    });
  };
  body.querySelector('[data-new]')?.addEventListener('click', () => zoneForm());
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => zoneForm(rows.find((r) => r.id === Number(b.dataset.edit)))));
  body.querySelectorAll('[data-actif]').forEach((b) => b.addEventListener('click', async () => {
    const z = rows.find((r) => r.id === Number(b.dataset.actif));
    await aReq('PUT', '/api/admin/zones/' + z.id, { ...z, actif: Number(b.dataset.v) });
    dessiner();
  }));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Supprimer cette zone ?')) return;
    await aReq('DELETE', '/api/admin/zones/' + b.dataset.del);
    dessiner();
  }));
}

/* --------- réglages --------- */
async function vueReglages(body) {
  const s = await aReq('GET', '/api/admin/settings');
  const champs = [
    ['nom_boutique', 'Nom de la boutique'], ['slogan', 'Slogan (hero)'], ['boutique_description', 'Description (pied de page)'],
    ['telephone', 'Téléphone affiché'], ['whatsapp', 'WhatsApp (22177…)'], ['email', 'E-mail'],
    ['adresse_retrait', 'Adresse de retrait'], ['horaires_retrait', 'Horaires de retrait'],
    ['wave_numero', 'Numéro Wave'], ['wave_nom', 'Titulaire Wave'], ['orange_numero', 'Numéro Orange Money'], ['orange_nom', 'Titulaire Orange Money'],
    ['livraison_gratuite_a_partir', 'Livraison offerte à partir de (FCFA)'], ['delai_retrait_heures', 'Préparation retrait (heures)'],
    ['expiration_commande_h', 'Annulation auto des impayés (heures)'], ['caution_pourcentage', 'Caution en % (info client)'],
    ['cinetpay_site_id', 'CinetPay — Site ID'], ['cinetpay_api_key', 'CinetPay — API key'], ['mode_paiement', 'Mode de paiement (auto|manuel)'],
    ['seo_keywords', 'Mots-clés (référencement)'],
  ];
  body.innerHTML = `
  <h2 style="margin:0">Réglages de la boutique</h2>
  <p class="small muted">Tout est modifiable ici — aucune ligne de code à toucher.</p>
  <div class="bloc" style="background:#fff"><h3>Identité & contact</h3>
    <div class="mini-form">${champs.filter(([k]) => !k.startsWith('cinetpay') && k !== 'mode_paiement').map(([k, l]) => `
      <div class="field ${['boutique_description', 'seo_keywords'].includes(k) ? 'full' : ''}">
        <label for="s-${k}">${l}</label>
        ${['boutique_description'].includes(k)
          ? `<textarea class="inp" id="s-${k}">${esc(s[k] || '')}</textarea>`
          : `<input class="inp" id="s-${k}" value="${esc(s[k] ?? '')}" ${k === 'mode_paiement' ? 'placeholder="auto"' : ''} />`}
      </div>`).join('')}
    </div>
  </div>
  <div class="bloc" style="background:#fff">
    <h3>Paiement Wave / Orange Money</h3>
    <div class="banner ${s.paiement_mode_effectif === 'cinetpay' ? 'ok' : 'warn'}">
      Mode actuel : <b>${s.paiement_mode_effectif === 'cinetpay' ? 'automatique (CinetPay — le client paie et la commande se valide seule)' : 'manuel (le client envoie l’argent, tu valides depuis « Commandes »)'}</b>
    </div>
    <div class="mini-form" style="margin-top:10px">
      <div class="field"><label>CinetPay — Site ID</label><input class="inp" id="s-cinetpay_site_id" value="${esc(s.cinetpay_site_id || '')}" /></div>
      <div class="field"><label>CinetPay — API key ${s.cinetpay_api_key_present ? '(déjà enregistrée : ' + esc(s.cinetpay_api_key) + ')' : ''}</label><input class="inp" id="s-cinetpay_api_key" placeholder="${s.cinetpay_api_key_present ? 'laisser vide pour garder' : 'CP_…'}" /></div>
      <div class="field"><label>Mode de paiement</label><select class="inp" id="s-mode_paiement">
        ${[['auto', 'auto (CinetPay si les clés existent)'], ['manuel', 'manuel uniquement'], ['hybride', 'hybride (CinetPay + repli manuel)']].map(([v, l]) => `<option value="${v}" ${s.mode_paiement === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
    </div>
    <p class="small muted">Ouvre un compte marchand gratuit sur <b>cinetpay.com</b> (Wave + Orange Money + Free Money inclus), colle ici le <span class="mono">site_id</span> et l’<span class="mono">api_key</span> : le paiement devient instantané et automatique. <a class="link" href="https://www.cinetpay.com/" target="_blank" rel="noopener">Docs CinetPay →</a></p>
  </div>
  <div class="bloc" style="background:#fff">
    <h3>Sécurité</h3>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      <input class="inp" id="pw-old" type="password" placeholder="Mot de passe actuel" style="max-width:220px;height:40px" />
      <input class="inp" id="pw-new" type="password" placeholder="Nouveau (8+ caractères)" style="max-width:220px;height:40px" />
      <button class="btn sm" id="pw-save">Changer le mot de passe</button>
    </div>
  </div>
  <div class="row"><button class="btn gold big" id="s-save">💾 Enregistrer les réglages</button></div>`;

  body.querySelector('#s-save').addEventListener('click', async (e) => {
    const bodyReq = {};
    for (const [k] of champs) {
      const inp = document.getElementById('s-' + k);
      if (inp && inp.value !== '') bodyReq[k] = inp.value;
    }
    if (document.getElementById('s-mode_paiement')) bodyReq.mode_paiement = document.getElementById('s-mode_paiement').value;
    if (!bodyReq.cinetpay_api_key) delete bodyReq.cinetpay_api_key;
    e.target.disabled = true; e.target.textContent = 'Enregistrement…';
    try { await aReq('PUT', '/api/admin/settings', bodyReq); toast('Réglages enregistrés ✔', 'ok'); await Shop.load(true); e.target.disabled = false; e.target.textContent = '💾 Enregistrer les réglages'; }
    catch (err) { toast(err.message, 'ko'); e.target.disabled = false; e.target.textContent = '💾 Enregistrer les réglages'; }
  });
  body.querySelector('#pw-save').addEventListener('click', async (e) => {
    try {
      await aReq('POST', '/api/admin/password', { ancien: document.getElementById('pw-old').value, nouveau: document.getElementById('pw-new').value });
      toast('Mot de passe changé ✔', 'ok');
    } catch (err) { toast(err.message, 'ko'); }
    e.target.textContent = 'Changer le mot de passe';
  });
}

/* --------- entrée --------- */
async function mont() {
  A = document.getElementById('adm-root');
  const tok = localStorage.getItem(TOKEN_KEY);
  if (!tok) return rendreLogin();
  try { A.who = await aReq('GET', '/api/admin/moi'); }
  catch { return rendreLogin(); }
  try { A.paiement_mode = (await aReq('GET', '/api/admin/dashboard')).paiement_mode; } catch { /* pas bloquant */ }
  if (VUES.includes(vueDuHash())) S.vue = vueDuHash();
  await dessinerInit();
}

/* Premier rendu : la coquille doit exister avant de dessiner la vue. */
async function dessinerInit() {
  A.cfg = await API.get('/api/config');
  A.innerHTML = coquille();
  S.pret = true;
  document.querySelector('[data-logout]')?.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    S.pret = false;
    if (location.hash) { location.hash = ''; return; }
    rendreLogin();
  });
  await dessiner();
}

window.addEventListener('hashchange', () => {
  if (!S.pret) return;
  const v = vueDuHash();
  if (VUES.includes(v)) { S.vue = v; dessiner(); }
});
document.addEventListener('DOMContentLoaded', mont);
