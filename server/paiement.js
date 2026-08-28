/* ------------------------------------------------------------------ */
/* Paiement Wave / Orange Money — deux modes                           */
/*                                                                     */
/*  1. AUTO (recommandé, comme dans le reste du dépôt) : CinetPay,     */
/*     agrégateur sénégalais. `POST /v2/payment/init` renvoie une      */
/*     `payment_url` : le client appuie sur « Payer » → la page de     */
/*     paiement s'ouvre → il choisit Wave ou Orange Money → push de     */
/*     confirmation sur son téléphone → il tape son code PIN.          */
/*     Le webhook `/api/paiement/notify` vérifie auprès de            */
/*     `/payment/check` et valide la commande automatiquement.        */
/*                                                                     */
/*  2. MANUEL (aucune clé requise, marche tout de suite) : on affiche  */
/*     le numéro Wave / Orange Money de la boutique, le client envoie   */
/*     l'argent puis sa commande passe « en attente de validation » ;  */
/*     Fatou valide depuis son espace admin.                            */
/*                                                                     */
/*  PAYEMENT_MODE=auto|manuel|hybride (défaut : auto, sinon manuel)    */
/* ------------------------------------------------------------------ */
const express = require('express');
const { db, getSetting, addLog } = require('./db');

const router = express.Router();

const CINETPAY_API = 'https://api.cinetpay.com/v2';

function cfg() {
  return {
    key: getSetting('cinetpay_api_key', ''),
    site: getSetting('cinetpay_site_id', ''),
  };
}

function cinetpayActif() {
  const c = cfg();
  return Boolean(c.key && c.site);
}

function mode() {
  const force = (getSetting('mode_paiement', '') || process.env.PAYEMENT_MODE || 'auto').toLowerCase();
  if (force === 'manuel') return 'manuel';
  if (force === 'auto') return cinetpayActif() ? 'cinetpay' : 'manuel';
  return cinetpayActif() ? 'cinetpay' : 'manuel'; // hybride
}

const METHODES = {
  wave: { libelle: 'Wave', cinetpay: 'wave', couleur: '#1dc9ff' },
  orange: { libelle: 'Orange Money', cinetpay: 'orange_money', couleur: '#ff7a00' },
  especes: { libelle: 'Paiement à la livraison', cinetpay: null, couleur: '#2e7d32' },
};

function methodeValide(m) {
  return METHODES[m] ? m : 'wave';
}

function montantValide(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 100 && v <= 5_000_000 ? v : null;
}

function commandeParReference(ref) {
  return db.prepare('SELECT * FROM commandes WHERE reference = ?').get(String(ref || '').trim().toUpperCase());
}

/* Marque une commande payée + déverrouille la préparation. */
function validerCommande(commandeId, { transactionId = null, source = 'manuel' } = {}) {
  const c = db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
  if (!c) return null;
  db.prepare(
    `UPDATE commandes
        SET statut_paiement = 'paye', prestataire = ?, transaction_id = COALESCE(?, transaction_id),
            payee_le = COALESCE(payee_le, ?), statut = CASE WHEN statut = 'nouvelle' THEN 'payee' ELSE statut END
      WHERE id = ?`
  ).run(source, transactionId, new Date().toISOString(), commandeId);
  addLog('commande_payee', { source, ref: c.reference, details: transactionId });
  return db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
}

/* Utilitaire : le client veut juste ouvrir l'app Wave/OM avec le bon numéro. */
function lienApplication(meth, montant, telBoutique, reference) {
  const brut = String(telBoutique || '').replace(/[^\d+]/g, '');
  const chiffres = brut.replace(/\D/g, '');
  // Wave/OM attendent un numéro formaté ; on ajoute l'indicatif 221 si absent.
  const num = /^221\d{9}$/.test(chiffres) ? chiffres : /^\d{9}$/.test(chiffres) ? '221' + chiffres : brut;
  const msg = reference
    ? (getSetting('nom_boutique', 'Fatoucha') + ' — commande ' + reference).slice(0, 80)
    : getSetting('nom_boutique', 'Fatoucha');
  if (meth === 'orange') {
    return {
      app: 'orange',
      deeplink: `https://pay.optmo.cloud/web/index.html#/pay?msisdn=${num}&amount=${montant}&text=${encodeURIComponent(msg)}`,
      fallback_ussd: `#155*3*1*1*${num}*${montant}#`,
      message: `Compose *155*3*1# (Orange Money) puis saisis le numéro ${telBoutique} et le montant ${montant} F.`,
    };
  }
  return {
    app: 'wave',
    deeplink: `https://web.wave.com/pay?amount=${montant}&currency=XOF&to=${num}&note=${encodeURIComponent(msg)}`,
    fallback_ussd: null,
    message: `Ouvre l’app Wave, envoie ${montant} F à ${telBoutique} et mets la référence en commentaire.`,
  };
}

/* ------------------------------------------------------------------ */
/* Le client appuie sur « Payer maintenant ».                          */
/* POST /api/paiement/checkout { reference, methode, telephone }      */
/* ------------------------------------------------------------------ */
router.post('/checkout', async (req, res) => {
  const { reference, methode, telephone } = req.body || {};
  const c = commandeParReference(reference);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  if (c.statut_paiement === 'paye') {
    return res.json({ deja_paye: true, statut: c.statut, reference: c.reference });
  }
  if (String(telephone || '').replace(/\D/g, '').slice(-9) !== String(c.telephone).replace(/\D/g, '').slice(-9)) {
    return res.status(403).json({ error: 'Le numéro ne correspond pas à cette commande.' });
  }
  const meth = methodeValide(methode || c.paiement);
  if (meth === 'especes') {
    db.prepare("UPDATE commandes SET paiement = 'especes', statut = 'nouvelle' WHERE id = ?").run(c.id);
    return res.json({
      mode: 'especes',
      message: 'Commande notée : tu paies à la livraison. Garde la monnaie, le livreur n’en a pas toujours.',
      reference: c.reference,
      total: c.total,
    });
  }

  const montant = montantValide(c.total);
  if (!montant) return res.status(400).json({ error: 'Montant de commande invalide.' });

  /* Mode manuel / aucun agrégateur : on renvoie les coordonnées + lien d'app. */
  if (mode() !== 'cinetpay') {
    const tel = getSetting(meth === 'orange' ? 'orange_numero' : 'wave_numero', '');
    const app = lienApplication(meth, montant, tel, c.reference);
    db.prepare('UPDATE commandes SET paiement = ? WHERE id = ?').run(meth, c.id);
    addLog('paiement_declare', { source: 'client', ref: c.reference, details: meth });
    return res.json({
      mode: 'manuel',
      methode: meth,
      numero: tel,
      nom_titulaire: getSetting(meth === 'orange' ? 'orange_nom' : 'wave_nom', ''),
      montant,
      reference: c.reference,
      message: `Envoie ${montant.toLocaleString('fr-FR')} F ${METHODES[meth].libelle} à ${tel || '(numéro à configurer par la boutique)'}, référence ${c.reference}. Dès réception, ta commande passe en préparation.`,
      ...app,
    });
  }

  /* Mode CinetPay : on crée la session et on renvoie l'URL du paiement. */
  const cp = cfg();
  const base = `${req.protocol}://${req.get('host')}`;
  try {
    const r = await fetch(`${CINETPAY_API}/payment/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: cp.key,
        site_id: cp.site,
        transaction_name: `CHEZ FATOUCHA ${c.reference}`,
        description: `Commande ${c.reference} — ${montant} FCFA`,
        amount: montant,
        currency: 'XOF',
        payment_method: METHODES[meth].cinetpay,
        customer: { last_name: c.client, phone_number: c.telephone },
        channels: 'WAVE,ORANGE_MONEY',
        return_url: `${base}/api/paiement/retour?reference=${c.reference}`,
        cancel_url: `${base}/#/panier?pay=annule`,
        notify_url: `${base}/api/paiement/notify`,
        metadata: { reference: c.reference },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (data?.code !== '200' || !data?.data?.payment_url) {
      addLog('cinetpay_erreur', { source: 'system', ref: c.reference, details: JSON.stringify(data).slice(0, 300) });
      return res.status(502).json({
        error: data?.message || 'Le prestataire de paiement ne répond pas. Choisis le paiement direct Wave/Orange Money.',
        fallback: 'manuel',
        numero: getSetting(meth === 'orange' ? 'orange_numero' : 'wave_numero', ''),
      });
    }
    db.prepare("UPDATE commandes SET paiement = ?, prestataire = 'cinetpay', transaction_id = COALESCE(transaction_id, ?) WHERE id = ?").run(
      meth,
      data.data.payment_token || null,
      c.id
    );
    return res.json({
      mode: 'cinetpay',
      url: data.data.payment_url,
      token: data.data.payment_token || null,
      reference: c.reference,
      montant,
      message: 'La page de paiement Wave / Orange Money souvre…',
    });
  } catch (e) {
    return res.status(502).json({ error: 'Connexion au prestataire impossible, réessaie.', fallback: 'manuel' });
  }
});

/* Vérification côté serveur d'un paiement CinetPay. */
async function verifierCinetpay({ token = null, transactionName = null } = {}) {
  const cp = cfg();
  if (!cp.key || !cp.site) return { ok: false, error: 'non_config' };
  try {
    const r = await fetch(`${CINETPAY_API}/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: cp.key, site_id: cp.site, ...(token ? { payment_token: token } : { transaction_name: transactionName }) }),
    });
    const data = await r.json().catch(() => ({}));
    const d = data?.data || {};
    const ok = data?.code === '200' && d.status === 'COMPLETED';
    return {
      ok,
      statut: d.status || null,
      amount: Number(d.amount || 0),
      transaction_id: d.transaction_id || d.payment_token || null,
      reference: d.metadata?.reference || transactionName || null,
      raw: data,
    };
  } catch (e) {
    return { ok: false, error: 'reseau' };
  }
}

/* Webhook CinetPay : jamais bloquant, répond toujours 200. */
router.post('/notify', express.json({ limit: '200kb' }), async (req, res) => {
  try {
    const d = req.body?.data || req.body || {};
    const token = d.payment_token || d.transaction_id;
    if (!token) return res.json({ ok: false, error: 'token_manquant' });
    const check = await verifierCinetpay({ token });
    if (!check.ok) return res.json({ ok: false, statut: check.statut });
    if (Number(check.amount) && Number(check.amount) < Number(d.amount || 0)) {
      // paiement partiel : on ne valide pas
      return res.json({ ok: false, error: 'montant_inferieur' });
    }
    let c = check.reference ? commandeParReference(check.reference) : null;
    if (!c && d.transaction_name) c = commandeParReference(String(d.transaction_name).split(' ').pop());
    if (!c) c = db.prepare("SELECT * FROM commandes WHERE transaction_id = ? OR reference = ?").get(token, token);
    if (c) validerCommande(c.id, { transactionId: String(check.transaction_id || token), source: 'cinetpay' });
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

/* Retour navigateur après paiement : filet de sécurité (le webhook peut échouer). */
router.get('/retour', async (req, res) => {
  const ref = String(req.query.reference || req.query.transaction_name || '').toUpperCase();
  const token = req.query.token || req.query.payment_token || null;
  let c = commandeParReference(ref);
  if (c && c.statut_paiement !== 'paye') {
    const check = await verifierCinetpay({ token, transactionName: ref ? `CHEZ FATOUCHA ${ref}` : null });
    if (check.ok) c = validerCommande(c.id, { transactionId: String(check.transaction_id || token || ''), source: 'cinetpay' });
  }
  const q = new URLSearchParams({ ref: c?.reference || ref || '', statut: c?.statut_paiement || 'en_attente' });
  return res.redirect(`/#/commande/${encodeURIComponent(c?.reference || ref || '')}?${q.toString()}`);
});

/* Le front demande « c'est bon, payé ? » (utile si le webhook est lent). */
router.get('/statut/:reference', async (req, res) => {
  const c = commandeParReference(req.params.reference);
  if (!c) return res.status(404).json({ error: 'Commande introuvable.' });
  if (c.statut_paiement !== 'paye' && mode() === 'cinetpay') {
    const check = await verifierCinetpay({ token: c.transaction_id, transactionName: `CHEZ FATOUCHA ${c.reference}` });
    if (check.ok) validerCommande(c.id, { transactionId: String(check.transaction_id || c.transaction_id || ''), source: 'cinetpay' });
  }
  const fresh = commandeParReference(req.params.reference);
  return res.json({ reference: fresh.reference, statut_paiement: fresh.statut_paiement, statut: fresh.statut });
});

module.exports = {
  router,
  mode,
  cinetpayActif,
  validerCommande,
  commandeParReference,
  methodeValide,
  montantValide,
  METHODES,
  lienApplication,
};
