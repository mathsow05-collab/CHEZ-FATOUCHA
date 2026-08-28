/* Sécurité : mêmes briques que le reste du dépôt (scrypt natif + JWT HS256 maison). */
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt') return false;
    const check = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), check);
  } catch {
    return false;
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getSecret() {
  return process.env.JWT_SECRET || 'fatoucha-dev-secret-a-changer';
}

function signToken(payload, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', getSecret()).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(`${h}.${p}`).digest();
  let given;
  try {
    given = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* Référence de commande lisible et non devinable : CMD-8K2M-QF4T */
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateReference(prefix = 'CMD') {
  let core = '';
  for (let i = 0; i < 8; i++) core += ALPHA[crypto.randomInt(ALPHA.length)];
  return `${prefix}-${core.slice(0, 4)}-${core.slice(4)}`;
}

/* Anti brute-force (IP + identifiant), fenêtre glissante. */
function rateLimiter({ max, windowMs, message }) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const key = `${req.ip || 'unknown'}|${String(req.headers.authorization || '').slice(0, 40)}`;
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.reset < now) {
      rec = { count: 0, reset: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      return res.status(429).json({ code: 'RATE_LIMIT', error: message || 'Trop de tentatives, patiente un peu.' });
    }
    return next();
  };
}

/* Numéro sénégalais : on garde 7 chiffres + indicatif, Format: 77 123 45 67 */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('221')) return digits.slice(3);
  if (digits.length === 12 && digits.startsWith('221')) return digits.slice(3);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith('00221')) return digits.slice(5);
  return digits.length >= 7 && digits.length <= 12 ? digits.slice(-9) : digits;
}

function isValidSenegalPhone(phone) {
  const p = normalizePhone(phone);
  return /^7[0,6,7,8,21]\d{7}$/.test(p) || /^7\d{8}$/.test(p);
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  generateReference,
  rateLimiter,
  normalizePhone,
  isValidSenegalPhone,
};
