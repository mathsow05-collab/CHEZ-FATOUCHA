/* Petite boîte à outils commune : appels API, panier (localStorage), formatage. */
const API = {
  token: null,
  async req(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (API.token) headers.Authorization = 'Bearer ' + API.token;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || 'Erreur ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b),
  put: (u, b) => API.req('PUT', u, b),
  patch: (u, b) => API.req('PATCH', u, b),
  del: (u) => API.req('DELETE', u),
};

const nf = new Intl.NumberFormat('fr-FR');
const fcfa = (n) => nf.format(Math.round(Number(n) || 0)) + ' F';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const jplural = (n) => (Number(n) > 1 ? 'jours' : 'jour');
const dateFr = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const heures = (h) => (h >= 24 ? `~${Math.round(h / 24)} j` : `${h} h`);

function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ---------------- Panier (localStorage, relu par le back-office) ---------------- */
const CART_KEY = 'fatoucha_cart_v1';
const Cart = {
  read() {
    try {
      const v = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  },
  write(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    Cart.renderBadge();
    window.dispatchEvent(new CustomEvent('cart:change'));
    Cart.sync();
  },
  /* Copie serveur du panier : reprise sur un autre téléphone (avec le code de
     reprise) et, surtout, possibilité pour la boutique de relancer une
     commande interrompue. Rien n'est envoyé sans numéro saisi au paiement. */
  sync() {
    clearTimeout(Cart._t);
    Cart._t = setTimeout(async () => {
      const items = Cart.read();
      const client = JSON.parse(localStorage.getItem('fatoucha_client') || '{}');
      try {
        const r = await fetch('/api/panier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jeton: jetonPanier(),
            client: client.client || undefined,
            telephone: client.telephone || undefined,
            items: items.map((i) => ({ produit_id: i.produit_id, quantite: i.qte, taille: i.taille, coloris: i.coloris })),
          }),
        });
        if (r.ok) { const j = await r.json(); if (j.etabli) localStorage.setItem('fatoucha_panier_code', j.etabli); }
      } catch { /* hors ligne : le panier local suffit, la copie reprendra */ }
    }, 1200);
  },
  async reprendre(telephone, code) {
    const q = new URLSearchParams({ tel: telephone, code: code || '' });
    const r = await API.get('/api/panier?' + q);
    if (!r.found || !r.items.length) throw new Error('Aucun panier enregistré pour ce numéro.');
    Cart.write(r.items.map((i) => ({
      key: `${i.produit_id}|${i.taille || ''}|${i.coloris || ''}`,
      produit_id: i.produit_id, titre: i.titre, image: i.image, taille: i.taille, coloris: i.coloris,
      prix: i.prix, qte: i.quantite, delai_jours: i.delai_jours, stock: i.stock, slug: i.slug,
    })));
    return r.items.length;
  },
  add(p, { taille = null, coloris = null, quantite = 1 }) {
    const items = Cart.read();
    const key = `${p.id}|${taille || ''}|${coloris || ''}`;
    const found = items.find((i) => i.key === key);
    const stock = stockPour(p, taille, coloris);
    if (found) found.qte = Math.min(stock || 1, found.qte + quantite);
    else
      items.push({
        key, produit_id: p.id, titre: p.titre, image: p.image, taille, coloris,
        prix: p.prix, qte: Math.min(quantite, stock || 1), delai_jours: p.delai_jours, stock,
      });
    Cart.write(items);
    return items;
  },
  setQty(key, qte) {
    const n = Math.floor(Number(qte));
    if (!Number.isFinite(n)) return;
    const items = Cart.read().map((i) => (i.key === key ? { ...i, qte: Math.max(1, Math.min(i.stock || 99, n)) } : i));
    Cart.write(items);
  },
  remove(key) {
    Cart.write(Cart.read().filter((i) => i.key !== key));
  },
  clear() { Cart.write([]); },
  count() { return Cart.read().reduce((s, i) => s + i.qte, 0); },
  subtotal() { return Cart.read().reduce((s, i) => s + i.qte * i.prix, 0); },
  renderBadge() {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      const n = Cart.count();
      el.textContent = n;
      el.classList.toggle('hidden', n === 0);
    });
  },
};

function stockPour(p, taille, coloris) {
  if (!p.a_des_variantes || (!taille && !coloris)) return p.stock;
  const v = (p.variantes || []).find(
    (x) => (x.taille || null) === (taille || null) && (x.coloris || null) === (coloris || null)
  );
  return v ? v.stock : 0;
}

/* ------------------------------------------------------------------ */
/* Images : le serveur fabrique les tailles utiles (/img/480/…).         */
/* Une vignette de 300 px ne doit pas coûter 4 Mo à une cliente en data. */
/* ------------------------------------------------------------------ */
const TAILLES_IMG = [220, 480, 900, 1200];
const _optimisable = (u) => !!u && /\.(jpe?g|png|webp|avif|tiff)$/i.test(String(u).split('?')[0]);
const urlImg = (u, largeur) => (_optimisable(u) ? '/img/' + largeur + (String(u).startsWith('/') ? '' : '/') + u : u);
const srcsetImg = (u, largeurs = TAILLES_IMG) => (_optimisable(u) ? largeurs.map((l) => urlImg(u, l) + ' ' + l + 'w').join(', ') : '');

/* Balise <img> : srcset + sizes + lazy + dimensions (aucun saut de mise en
   page, ce que les outils de performance appellent le CLS). */
function baliseImg(url, alt, opts) {
  const o = opts || {};
  const largeur = o.priorite ? 900 : 480;
  const ss = srcsetImg(url, o.largeurs);
  return '<img src="' + esc(urlImg(url, largeur)) + '"'
    + (ss ? ' srcset="' + ss + '"' : '')
    + (ss ? ' sizes="' + esc(o.sizes || '320px') + '"' : '')
    + ' alt="' + esc(alt || '') + '" width="' + largeur + '" height="' + Math.round((largeur * 4) / 3) + '"'
    + ' loading="' + (o.priorite ? 'eager' : 'lazy') + '" decoding="async"'
    + (o.priorite ? ' fetchpriority="high"' : '')
    + (o.cls ? ' class="' + o.cls + '"' : '')
    + (o.id ? ' id="' + o.id + '"' : '')
    + ' onerror="this.onerror=null;this.src=\'' + (o.repli || '/media/demo/robe-boheme.svg') + '\'" />';
}

/* ------------------------------------------------------------------ */
/* Mesure d'audience maison : six moments, aucun identifiant publicitaire, */
/* aucune donnée personnelle — les nombres restent dans la base de la       */
/* boutique. Sans ça, on ne sait pas où le parcours casse.                    */
/* ------------------------------------------------------------------ */
const Mesure = {
  file: [],
  seance() {
    let s = sessionStorage.getItem('fatoucha_seance');
    if (!s) { s = 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('fatoucha_seance', s); }
    return s;
  },
  envoyer(type, produitId, meta) {
    if (!type) return;
    this.file.push({ type, produit_id: produitId ? Number(produitId) || null : null, meta: meta ? String(meta).slice(0, 80) : null });
    if (this.file.length >= 8) this.vider();
    else { clearTimeout(this._t); this._t = setTimeout(() => this.vider(), 2500); }
  },
  async vider() {
    if (!this.file.length) return;
    const evenements = this.file.splice(0, 25);
    try {
      await fetch('/api/evenements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seance: this.seance(), evenements }),
        keepalive: true,
      });
    } catch { /* la mesure ne doit jamais bloquer une cliente */ }
  },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Mesure.vider(); });
window.addEventListener('pagehide', () => {
  if (!Mesure.file.length) return;
  const corps = JSON.stringify({ seance: Mesure.seance(), evenements: Mesure.file.splice(0, 25) });
  if (navigator.sendBeacon) navigator.sendBeacon('/api/evenements', new Blob([corps], { type: 'application/json' }));
  else fetch('/api/evenements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, keepalive: true }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* « Vu récemment » et favoris : localStorage, pas de compte.            */
/* ------------------------------------------------------------------ */
const Vu = {
  lus() { try { return JSON.parse(localStorage.getItem('fatoucha_vus') || '[]'); } catch { return []; } },
  noter(p) {
    if (!p || !p.id) return;
    const liste = [{ id: p.id, slug: p.slug || null, titre: p.titre, prix: p.prix, image: p.image, delai_jours: p.delai_jours, vu: Date.now() }, ...Vu.lus().filter((x) => x.id !== p.id)].slice(0, 12);
    localStorage.setItem('fatoucha_vus', JSON.stringify(liste));
  },
  vider() { localStorage.removeItem('fatoucha_vus'); },
};
const Favoris = {
  liste() { try { return JSON.parse(localStorage.getItem('fatoucha_favoris') || '[]'); } catch { return []; } },
  ids() { return Favoris.liste().map((f) => f.id); },
  contient(id) { return Favoris.ids().includes(Number(id)); },
  basculer(p) {
    const liste = Favoris.liste();
    const i = liste.findIndex((f) => f.id === Number(p.id));
    if (i >= 0) liste.splice(i, 1);
    else liste.unshift({ id: Number(p.id), slug: p.slug || null, titre: p.titre, prix: p.prix, image: p.image, delai_jours: p.delai_jours, mis: Date.now() });
    localStorage.setItem('fatoucha_favoris', JSON.stringify(liste.slice(0, 40)));
    return i < 0;
  },
  vider() { localStorage.removeItem('fatoucha_favoris'); },
};

/* ------------------------------------------------------------------ */
/* Jeton de session du panier : sert à retrouver un panier enregistré.    */
/* ------------------------------------------------------------------ */
function jetonPanier() {
  let j = localStorage.getItem('fatoucha_jeton');
  if (!j || !/^[a-z0-9-]{8,40}$/i.test(j)) {
    j = 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('fatoucha_jeton', j);
  }
  return j;
}

/* Markdown de poche pour les pages écrites depuis le back-office. */
function markdown(texte) {
  const lignes = String(texte || '').replace(/\r/g, '').split('\n');
  const out = [];
  let liste = false;
  const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  for (const l of lignes) {
    if (/^##\s+/.test(l)) { if (liste) { out.push('</ul>'); liste = false; } out.push('<h2>' + inline(l.replace(/^##\s+/, '')) + '</h2>'); }
    else if (/^[-*]\s+/.test(l)) { if (!liste) { out.push('<ul>'); liste = true; } out.push('<li>' + inline(l.replace(/^[-*]\s+/, '')) + '</li>'); }
    else if (!l.trim()) { if (liste) { out.push('</ul>'); liste = false; } }
    else { if (liste) { out.push('</ul>'); liste = false; } out.push('<p>' + inline(l) + '</p>'); }
  }
  if (liste) out.push('</ul>');
  return out.join('\n');
}

/* Étoiles : la note se lit d'un coup d'œil, sans image à charger. */
const etoiles = (note) => {
  const n = Math.max(0, Math.min(5, Math.round(Number(note) || 0)));
  return '<span class="etoiles" role="img" aria-label="' + n + ' étoile' + (n > 1 ? 's' : '') + ' sur 5"><i aria-hidden="true">'
    + '★'.repeat(n) + '☆'.repeat(5 - n) + '</i></span>';
};

/* Configuration boutique chargée une fois (nom, contact, zones, catégories). */
const Shop = {
  cfg: null,
  async load(force = false) {
    if (Shop.cfg && !force) return Shop.cfg;
    Shop.cfg = await API.get('/api/config');
    document.title = Shop.cfg.nom_boutique + ' — ' + (Shop.cfg.slogan || 'boutique en ligne');
    return Shop.cfg;
  },
  zone(id) { return (Shop.cfg?.zones || []).find((z) => z.id === Number(id)); },
  frais(zoneId, sousTotal) {
    const z = Shop.zone(zoneId);
    if (!z) return 0;
    const seuil = Number(Shop.cfg?.livraison_gratuite_a_partir || 0);
    if (seuil > 0 && sousTotal >= seuil) return 0;
    return z.frais;
  },
};
