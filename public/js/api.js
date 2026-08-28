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

/* ---------------- Panier (localStorage, partagé avec l'espace admin) ---------------- */
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
