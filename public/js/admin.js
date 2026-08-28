/* ============================================================
   CHEZ FATOUCHA — espace administrateur (chargé sur #/admin)
   Produits, commandes (validation paiement + statuts), zones, réglages.
   ============================================================ */
const TOKEN_KEY = 'fatoucha_admin_token';
const S = { vue: 'dash', commandes: { filtre: 'toutes', q: '' }, produits: { q: '', etat: 'tous' } };
let A = null; // conteneur racine

/* --------- helpers --------- */
const A_el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
/* Changer d'onglet sans re-démonter l'app : on remplace l'URL sans événement. */
const A_go = (v) => { S.vue = v; try { history.replaceState(null, '', '#/admin/' + v); } catch { location.hash = '#/admin/' + v; } dessiner(); };

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
  if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); rendreLogin(); throw new Error('Session expirée, reconnecte-toi.'); }
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) throw new Error((data && data.error) || 'Erreur ' + res.status);
  return data;
}

/* --------- coquille --------- */
function coquille() {
  const tabs = [['dash', '📊 Tableau de bord'], ['commandes', '📦 Commandes'], ['produits', '👗 Produits'], ['zones', '🚚 Zones & délais'], ['reglages', '⚙️ Réglages']];
  return `
  <header class="top"><div class="wrap bar">
    <a class="brand" href="#/"><span class="logo">🛍️</span><span><b>${esc(A.cfg?.nom_boutique || 'CHEZ FATOUCHA')}</b><small>ESPACE VENDEUR</small></span></a>
    <nav class="main">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${S.vue === k ? 'on' : ''}" data-tab="${k}">${l}</a>`).join('')}</nav>
    <div class="actions"><a class="icon-btn" href="#/">👁️ Boutique</a><button class="icon-btn" data-logout>Déconnexion</button></div>
  </div></header>
  <main class="wrap admin" id="admin-body"></main>`;
}

async function dessiner() {
  const body = document.getElementById('admin-body');
  if (!body) return;
  try {
    A.cfg = await API.get('/api/config');
    document.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); A_go(a.dataset.tab); }));
    if (S.vue === 'dash') await vueDash(body);
    else if (S.vue === 'commandes') await vueCommandes(body);
    else if (S.vue === 'produits') await vueProduits(body);
    else if (S.vue === 'zones') await vueZones(body);
    else if (S.vue === 'reglages') await vueReglages(body);
  } catch (e) {
    if (e.message !== 'Session expirée, reconnecte-toi.') body.innerHTML = `<div class="banner ko">${esc(e.message)}</div>`;
  }
}

/* --------- login --------- */
function rendreLogin() {
  A.innerHTML = `<div class="login-box">
    <div class="center" style="margin-bottom:14px"><div class="brand" style="justify-content:center"><span class="logo">🛍️</span><span><b>CHEZ FATOUCHA</b><small>ESPACE VENDEUR</small></span></div></div>
    <div class="stack">
      <div class="field"><label for="l-u">Identifiant</label><input id="l-u" class="inp" autocomplete="username" value="admin" /></div>
      <div class="field"><label for="l-p">Mot de passe</label><input id="l-p" class="inp" type="password" autocomplete="current-password" /></div>
      <button class="btn gold big block" id="l-btn">Se connecter</button>
      <div id="l-err"></div>
      <div class="small muted">Comptes créés au premier lancement via <span class="mono">ADMIN1_USERNAME</span> / <span class="mono">ADMIN1_PASSWORD</span> (voir <span class="mono">.env</span> ou Render).</div>
    </div></div>`;
  const submit = async () => {
    const u = document.getElementById('l-u').value.trim();
    const p = document.getElementById('l-p').value;
    const btn = document.getElementById('l-btn');
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      const r = await API.post('/api/admin/login', { username: u, password: p });
      localStorage.setItem(TOKEN_KEY, r.token);
      toast('Bonjour ' + (r.admin.display_name || r.admin.username) + ' 👋', 'ok');
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
    <div class="row"><button class="btn sm ghost" data-reload>↻ Actualiser</button><a class="btn sm" href="#/admin/commandes">Voir les commandes</a></div>
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
      <div class="row spread"><h3 style="margin:0">Dernières commandes</h3><a class="link" href="#/admin/commandes">tout voir →</a></div>
      ${d.derniers_commandes.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Réf.</th><th>Client</th><th>Total</th><th>Paiement</th><th>Statut</th><th></th></tr></thead><tbody>
        ${d.derniers_commandes.map((c) => `<tr>
          <td class="mono small">${esc(c.reference)}</td>
          <td>${esc(c.client)}<br><span class="small muted">${esc(c.telephone)} · ${c.mode === 'retrait' ? 'retrait' : 'livraison'}</span></td>
          <td><b>${fcfa(c.total)}</b></td>
          <td><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ payé' : '⏳ ' + esc(c.paiement)}</span></td>
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
      <p class="small muted" style="margin:2px 0 0">Ajoute tes propres articles : photo, prix FCFA, tailles, stock, délai.</p></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn sm ghost" data-filtre="tous" ${S.produits.etat === 'tous' ? 'style="border-color:var(--ink)"' : ''}>Tous</button>
      <button class="btn sm ghost" data-filtre="actifs" ${S.produits.etat === 'actifs' ? 'style="border-color:var(--ink)"' : ''}>En ligne</button>
      <button class="btn sm ghost" data-filtre="rupture" ${S.produits.etat === 'rupture' ? 'style="border-color:var(--ink)"' : ''}>Rupture</button>
      <button class="btn sm ghost" data-filtre="inactifs" ${S.produits.etat === 'inactifs' ? 'style="border-color:var(--ink)"' : ''}>Masqués</button>
      <input id="p-q" class="inp" style="height:34px;width:170px" placeholder="🔍 rechercher…" value="${esc(S.produits.q)}" />
      <button class="btn gold" data-new>➕ Nouvel article</button>
    </div>
  </div>
  ${rows.length ? `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>Photo</th><th>Article</th><th>Prix</th><th>Stock</th><th>Délai</th><th>Cat.</th><th>Visible</th><th>★</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td><img class="im" src="${esc(p.image || '/media/demo/robe-boheme.svg')}" onerror="this.src='/media/demo/robe-boheme.svg'" /></td>
      <td><b>${esc(p.titre)}</b><br><span class="small muted">${p.marque ? esc(p.marque) + ' · ' : ''}${p.tailles.length ? 'tailles ' + p.tailles.join('/') + ' · ' : ''}${p.lien_source ? '<a class="link" href="' + esc(p.lien_source) + '" target="_blank" rel="noopener">lien fournisseur</a>' : 'sans lien'}</span></td>
      <td>${fcfa(p.prix)}${p.prix_barre ? `<br><s class="small muted">${fcfa(p.prix_barre)}</s>` : ''}</td>
      <td>${p.stock > 0 ? `<b>${p.stock}</b>` : '<span class="tag annulee">0</span>'}<br><span class="small muted">${p.reserve} réservé(s)</span></td>
      <td class="small">${p.delai_jours} j</td>
      <td class="small">${esc(p.categorie || '—')}</td>
      <td><button class="btn sm ${p.actif ? 'ghost' : ''}" data-toggle="${p.id}" data-k="actif" data-v="${p.actif ? 0 : 1}">${p.actif ? '✔ en ligne' : 'masqué'}</button></td>
      <td><button class="btn sm ${p.vedette ? 'gold' : 'ghost'}" data-toggle="${p.id}" data-k="vedette" data-v="${p.vedette ? 0 : 1}">★</button></td>
      <td class="row" style="gap:4px"><button class="btn sm ghost" data-edit="${p.id}">✏️</button><button class="btn sm danger" data-del="${p.id}">🗑</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : '<div class="bloc empty"><div class="big">👗</div><b>Aucun article.</b><br>Crée ton premier article : titre, prix, photo, tailles, stock.</div>'}
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

    <div class="row spread" style="flex-wrap:wrap">
      <button class="btn ghost" id="f-cancel">Annuler</button>
      <div class="row"><button class="btn gold big" id="f-save">${isEdit ? '💾 Enregistrer' : '➕ Créer l’article'}</button></div>
    </div>
  </div>`);

  const M = modal(isEdit ? 'Modifier un article' : 'Nouvel article', f, true);
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
      <input id="c-q" class="inp" style="height:34px;width:190px" placeholder="🔍 réf., nom, téléphone…" value="${esc(S.commandes.q)}" />
      <a class="btn sm ghost" href="/api/admin/commandes-export">⬇️ CSV</a>
    </div>
  </div>
  <div class="cats">
    ${['toutes', 'nouvelle', 'payee', 'en_preparation', 'expediee', 'livree', 'annulee'].map((k) =>
      `<button class="cat ${S.commandes.filtre === k ? 'on' : ''}" data-f="${k}">${k === 'toutes' ? '🗂 Toutes' : LIB_STATUT[k]} <span class="n">${k === 'toutes' ? rows.length : compte(k)}</span></button>`).join('')}
  </div>
  ${rows.length ? `<div class="tbl-scroll"><table class="tbl">
    <thead><tr><th>Réf.</th><th>Client</th><th>Mode</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Statut</th><th></th></tr></thead>
    <tbody>${rows.map((c) => `<tr>
      <td class="mono small">${esc(c.reference)}<br><span class="muted">${dateFr(c.created_at)}</span></td>
      <td><b>${esc(c.client)}</b><br><span class="small muted"><a class="link" href="tel:${esc(c.telephone)}">${esc(c.telephone)}</a></span></td>
      <td class="small">${c.mode === 'retrait' ? '🏪 retrait' : '🚚 ' + esc(c.zone_nom || '—')}</td>
      <td class="small">${c.nb_articles} art.</td>
      <td><b>${fcfa(c.total)}</b><br><span class="small muted">dont ${fcfa(c.frais)}</span></td>
      <td><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ ' + esc(c.prestataire || '') : '⏳ ' + esc(c.paiement)}</span></td>
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
        <div class="row spread"><span>${c.paiement === 'orange' ? 'Orange Money' : c.paiement === 'especes' ? 'Espèces' : 'Wave'}</span><span class="tag ${c.statut_paiement}">${c.statut_paiement === 'paye' ? '✔ payé' : '⏳ en attente'}</span></div>
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
  const tok = localStorage.getItem(TOKEN_KEY);
  if (!tok) return rendreLogin();
  try { A.who = await aReq('GET', '/api/admin/moi'); }
  catch { return rendreLogin(); }
  A.cfg = await API.get('/api/config');
  A.innerHTML = coquille();
  const seg = hashPath().match(/^\/admin\/(\w+)/);
  if (seg && ['dash', 'commandes', 'produits', 'zones', 'reglages'].includes(seg[1])) S.vue = seg[1];
  document.querySelector('[data-logout]')?.addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); rendreLogin(); });
  await dessiner();
}

window.Admin = {
  async mount(container) {
    A = container;
    await mont();
  },
};
