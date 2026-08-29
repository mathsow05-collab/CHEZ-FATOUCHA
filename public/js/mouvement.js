/* ------------------------------------------------------------------------
   mouvement.js — la couche d'animation de la boutique
   ------------------------------------------------------------------------
   Quatre effets, un tiroir, un point qui vole. Tout est :
     - déclenché à la demande (Mouvement.appliquer() après chaque rendu),
     - désactivé si l'utilisateur demande « moins de mouvement »,
     - absent côté Node/jsdom : chaque API navigateur est testée avant usage,
       donc aucune erreur JavaScript n'est possible sur un environnement maigre.
   Aucune dépendance externe : les mêmes effets que les bibliothèques d'UI
   (spotlight qui suit la souris, reflet sur les cartes, bouton aimanté,
   révélation au défilement, étincelle au clic) tiennent en CSS + ce fichier. */
(function (globalThis_) {
  'use strict';

  const d = globalThis_.document;
  const w = globalThis_.window;
  if (!d || !d.documentElement) return;

  const réduit = () => !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fin = (el, props) => new Promise((res) => {
    if (!el || !el.animate) return res();
    try { el.animate(props, { duration: 420, easing: 'cubic-bezier(.22,.9,.24,1)' }).finished.then(res, res); }
    catch (e) { res(); }
  });

  /* ---------- 1. spotlight : la lumière suit le curseur ---------- */
  function spotlight(racine) {
    if (réduit()) return;
    for (const el of (racine || d).querySelectorAll('.spot')) {
      if (el.__spot) continue;
      el.__spot = true;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--sx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--sy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      }, { passive: true });
      el.addEventListener('pointerleave', () => { el.style.setProperty('--sx', '50%'); el.style.setProperty('--sy', '26%'); });
    }
  }

  /* ---------- 2. bouton aimanté : le CTA vient vers le doigt ---------- */
  function aimants(racine) {
    if (réduit()) return;
    for (const el of (racine || d).querySelectorAll('[data-aimant]')) {
      if (el.__aimant) continue;
      el.__aimant = true;
      const force = Number(el.getAttribute('data-aimant')) || 7;
      el.classList.add('magnet');
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1) * force + '');
        el.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1) * (force * .6) + '');
      }, { passive: true });
      el.addEventListener('pointerleave', () => { el.style.setProperty('--mx', '0'); el.style.setProperty('--my', '0'); });
    }
  }

  /* ---------- 3. révélation au défilement ---------- */
  let obs = null;
  const montrer = (els) => { for (const el of els) el.classList.add('vu'); };
  function reveler(racine) {
    const cibles = [...(racine || d).querySelectorAll('[data-reveal]:not(.vu)')];
    if (!cibles.length) return;
    if (!('IntersectionObserver' in w) || réduit()) { montrer(cibles); return; }
    if (!obs) {
      obs = new w.IntersectionObserver((vus) => {
        for (const v of vus) if (v.isIntersecting) { v.target.classList.add('vu'); obs.unobserve(v.target); }
      }, { rootMargin: '0px 0px 12% 0px', threshold: .01 });
    }
    const dansVue = (el) => {
      const r = el.getBoundingClientRect();
      const h = w.innerHeight || 800;
      /* on révèle avec une marge d'un écran : à l'usage, rien n'apparaît
         « pendant » qu'on fait défiler, et les grilles sont pleines dès le bord. */
      return r.top < h * 1.9 && r.bottom > -h * .4;
    };
    cibles.slice(0, 90).forEach((el, i) => {
      el.style.setProperty('--i', String(i % 8));   /* une chaîne : setProperty n'accepte pas un nombre */
      /* Ce qui est déjà devant les yeux n'a rien à attendre d'un observateur :
         la première grille doit être pleine à la première image. */
      if (dansVue(el)) { el.classList.add('vu'); return; }
      obs.observe(el);
    });
    /* filet de sécurité : si l'observateur ne prévient pas (page masquée,
       navigateur capricieux), on montre tout après un battement. Rien ne doit
       rester invisible à cause d'une animation. */
    w.clearTimeout(reveler.__t);
    reveler.__t = w.setTimeout(() => montrer([...d.querySelectorAll('[data-reveal]:not(.vu)')]), 1400);
  }

  /* ---------- 4. étincelle au clic (un mini canvas posé sur la page) ---------- */
  let canevas = null, ctx = null, particules = [], boucle = null;
  function etincelle(x, y) {
    if (réduit() || !w.requestAnimationFrame) return;
    if (!canevas) {
      canevas = d.createElement('canvas');
      canevas.id = 'etincelle';
      canevas.setAttribute('aria-hidden', 'true');
      d.body.appendChild(canevas);
      ctx = canevas.getContext && canevas.getContext('2d');
      if (!ctx) { canevas.remove(); canevas = null; return; }
      dimensionner();
      w.addEventListener('resize', dimensionner, { passive: true });
    }
    const couleurs = ['#d9b968', '#b8912f', '#6d1f46', '#fffdfa'];
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI * 2 * i) / 9 + Math.random() * .5;
      particules.push({ x, y, vx: Math.cos(a) * (1.6 + Math.random() * 2.2), vy: Math.sin(a) * (1.6 + Math.random() * 2.2) - 1.1, vie: 1, c: couleurs[i % couleurs.length], r: 1 + Math.random() * 1.7 });
    }
    if (!boucle) dessiner();
  }
  function dimensionner() {
    if (!canevas) return;
    const dpr = Math.min(2, w.devicePixelRatio || 1);
    canevas.width = d.documentElement.clientWidth * dpr;
    canevas.height = d.documentElement.clientHeight * dpr;
    canevas.style.width = d.documentElement.clientWidth + 'px';
    canevas.style.height = d.documentElement.clientHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function dessiner() {
    boucle = w.requestAnimationFrame(dessiner);
    ctx.clearRect(0, 0, canevas.width, canevas.height);
    particules = particules.filter((p) => p.vie > 0);
    if (!particules.length) { w.cancelAnimationFrame(boucle); boucle = null; return; }
    for (const p of particules) {
      p.x += p.vx; p.y += p.vy; p.vy += .13; p.vie -= .045;
      const alpha = Math.max(0, p.vie);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      /* un rayon négatif ferait tomber tout le canvas (et l'effet avec) :
         la particule meurt en douceur, jamais en dessous de zéro */
      ctx.arc(p.x, p.y, Math.max(.01, p.r * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function brancherEtincelle() {
    if (réduit() || d.__etincelle) return;
    d.__etincelle = true;
    d.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const cible = e.target && e.target.closest ? e.target.closest('.btn, .icon-btn, .chip, .cœur, [data-aimant]') : null;
      if (cible) etincelle(e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ---------- 5. le point qui vole vers le panier ---------- */
  async function voler(depuis, vers) {
    if (réduit() || !depuis || !vers || !d.body || !d.body.animate) return;
    const a = depuis.getBoundingClientRect(), b = vers.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const dot = d.createElement('span');
    dot.className = 'vol';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.left = (a.left + a.width / 2 - 8) + 'px';
    dot.style.top = (a.top + a.height / 2 - 8) + 'px';
    dot.style.setProperty('--dx', (b.left + b.width / 2 - a.left - a.width / 2) + 'px');
    dot.style.setProperty('--dy', (b.top + b.height / 2 - a.top - a.height / 2) + 'px');
    d.body.appendChild(dot);
    await fin(dot, [{ transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }, { opacity: 1, offset: .6 }, { transform: 'translate3d(var(--dx),var(--dy),0) scale(.3)', opacity: 0 }]);
    dot.remove();
    if (vers.animate) { try { vers.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.22,.9,.24,1)' }); } catch (e) { /* rien de grave */ } }
  }

  /* ---------- 6. tiroir de navigation mobile ---------- */
  function ouvrirTiroir(ouvert) {
    const t = d.getElementById('tiroir');
    if (!t) return;
    d.body.classList.toggle('tiroir-ouvert', !!ouvert);
    for (const b of d.querySelectorAll('[data-tiroir]')) b.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    if (ouvert) {
      const premier = t.querySelector('a, button');
      if (premier && premier.focus) premier.focus();
    } else if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
  }
  function brancherTiroir() {
    if (d.__tiroir) return;
    d.__tiroir = true;
    d.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-tiroir],[data-tiroir-x],[data-tiroir-fond]') : null;
      if (!b) return;
      ouvrirTiroir(b.hasAttribute('data-tiroir') ? !d.body.classList.contains('tiroir-ouvert') : false);
    });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') ouvrirTiroir(false); });
    /* un lien du tiroir = on le referme tout de suite (sinon on reste sous le voile) */
    d.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('#tiroir a')) ouvrirTiroir(false);
    });
  }

  /* ---------- 7. rails : les flèches + « on est arrivé au bout » ---------- */
  function rails(racine) {
    for (const rang of (racine || d).querySelectorAll('.rang')) {
      /* les Shorts ont leur propre rail (tuiles 9:16) : mêmes flèches, même état « au bout » */
      const lignes = rang.querySelector('.rang-lignes, .short-rail');
      if (!lignes || rang.__rail) continue;
      rang.__rail = true;
      const maj = () => {
        rang.classList.toggle('fin', lignes.scrollLeft + lignes.clientWidth >= lignes.scrollWidth - 4);
        rang.dataset.debut = lignes.scrollLeft < 4 ? '1' : '0';
      };
      lignes.addEventListener('scroll', maj, { passive: true });
      maj();
      for (const b of rang.querySelectorAll('[data-rail]')) {
        b.addEventListener('click', () => {
          const pas = Math.max(200, lignes.clientWidth * .78) * (b.dataset.rail === 'gauche' ? -1 : 1);
          if (lignes.scrollBy) lignes.scrollBy({ left: pas, behavior: réduit() ? 'auto' : 'smooth' });
        });
      }
    }
  }

  /* ---------- 8. jauge de lecture ---------- */
  function jauge() {
    let barre = d.querySelector('.jauge');
    if (!barre) { barre = d.createElement('div'); barre.className = 'jauge'; barre.setAttribute('aria-hidden', 'true'); d.body.appendChild(barre); }
    const maj = () => {
      const h = d.documentElement.scrollHeight - w.innerHeight;
      barre.style.setProperty('--p', h > 60 ? Math.min(1, Math.max(0, w.scrollY / h)).toFixed(3) : '0');
    };
    w.addEventListener('scroll', maj, { passive: true });
    w.addEventListener('resize', maj, { passive: true });
    maj();
  }

  /* ---------- 9. les cartes se soulèvent sous le doigt (retour visuel) ---------- */
  function tactile(racine) {
    for (const el of (racine || d).querySelectorAll('.card')) {
      if (el.__tap) continue;
      el.__tap = true;
      el.addEventListener('pointerdown', () => el.classList.add('touche'), { passive: true });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => el.classList.remove('touche'), { passive: true });
    }
  }

  /* ---------- point d'entrée ---------- */
  /* --- les photos : on les montre quand elles sont vraiment là ---
     Une image qui met deux secondes à arriver laisse aujourd'hui un cadre vide,
     et on croit que « l'image ne vient pas ». On garde donc la place (ratio 3/4)
     avec un voile clair, et la photo apparaît en fondu. */
  function photos(racine) {
    const posee = (el) => el.complete || el.naturalWidth > 0;   /* decodé, même si `complete` traîne */
    const img = (racine || d).querySelectorAll('img');
    for (const el of img) {
      if (posee(el)) { el.classList.add('vue'); continue; }
      if (el.__vue) continue;
      el.__vue = true;
      const finir = () => el.classList.add('vue');
      el.addEventListener('load', finir, { once: true });
      el.addEventListener('error', finir, { once: true });   /* même cassée : on sort du voile */
    }
    /* trois filet : un décodage lent (ou un événement manqué sur un AVIF) ne doit
       jamais laisser un cadre vide — au bout d'un instant, on montre tout. */
    w.clearTimeout(photos.__t);
    photos.__t = w.setTimeout(() => montrer([...d.querySelectorAll('img:not(.vue)')]), 1200);
    w.setTimeout(() => { for (const el of d.querySelectorAll('img')) if (posee(el)) el.classList.add('vue'); }, 300);
  }

  /* chaque étape est isolée : une lubie de navigateur sur l'effet le plus
     décoratif ne doit pas empêcher les suivants — ni, surtout, la page. */
  function appliquer(racine) {
    for (const f of [photos, spotlight, aimants, reveler, rails, tactile]) {
      try { f(racine); } catch (e) { /* silencieux : purement décoratif */ }
    }
    d.documentElement.classList.add('mouv');
  }

  brancherTiroir();
  brancherEtincelle();
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => { jauge(); }, { once: true });
  else jauge();

  globalThis_.Mouvement = {
    appliquer, voler, reveler, rails, ouvrirTiroir, etincelle, réduit,
  };
})(typeof window !== 'undefined' ? window : globalThis);
