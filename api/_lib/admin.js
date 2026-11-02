// Utilidades compartilhadas das funções de servidor que usam o Firebase Admin SDK.
// A pasta começa com "_" para que a Vercel não a exponha como rota.
import crypto from 'crypto';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const ROLE_RANK = { client: 0, staff: 1, manager: 2, owner: 3, developer: 4 };
export const VALID_ROLES = Object.keys(ROLE_RANK);

function loadCredential() {
  // FIREBASE_SERVICE_ACCOUNT: JSON da conta de serviço (texto puro ou base64).
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return cert(JSON.parse(text));
  }
  // Emulador ou ambiente com credenciais padrão do Google.
  return applicationDefault();
}

export function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'dona-lu-4242d';
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
  return initializeApp(usingEmulator ? { projectId } : { credential: loadCredential(), projectId });
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());
export { FieldValue };

export function setCors(req, res, methods = 'POST,OPTIONS') {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length === 0) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Limite de tentativas persistido no Firestore (coleção "_rate_limits", acessível só pelo servidor).
 * Janela deslizante simples: `max` falhas em `windowMs` bloqueiam por `lockMs`.
 */
export async function checkRateLimit(key, { max, windowMs, lockMs }) {
  const ref = adminDb().collection('_rate_limits').doc(sha(key));
  const snap = await ref.get();
  const now = Date.now();
  const d = snap.exists ? snap.data() : null;
  if (d?.lockedUntil && d.lockedUntil > now) return { allowed: false, retryAfterMs: d.lockedUntil - now };
  return { allowed: true, ref, data: d, now, max, windowMs, lockMs };
}

export async function registerFailure(state) {
  if (!state?.ref) return;
  const { ref, now, max, windowMs, lockMs } = state;
  await adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let d = s.exists ? s.data() : { count: 0, windowStart: now };
    if (now - d.windowStart > windowMs) d = { count: 0, windowStart: now };
    d.count += 1;
    if (d.count >= max) {
      d.lockedUntil = now + lockMs;
      d.count = 0;
      d.windowStart = now;
    }
    tx.set(ref, d);
  });
}

export async function clearFailures(state) {
  if (state?.ref) await state.ref.delete().catch(() => {});
}

export function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Valida o ID token do Firebase e devolve { uid, email, role, token }. Lança erro com .status em caso de falha. */
export async function requireCaller(req, { minRole } = {}) {
  const idToken = bearerToken(req);
  if (!idToken) throw Object.assign(new Error('Não autenticado.'), { status: 401 });
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true);
  } catch {
    throw Object.assign(new Error('Sessão inválida.'), { status: 401 });
  }
  const snap = await adminDb().collection('users').doc(decoded.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (minRole && !((ROLE_RANK[role] ?? -1) >= ROLE_RANK[minRole])) {
    throw Object.assign(new Error('Sem permissão.'), { status: 403 });
  }
  return { uid: decoded.uid, email: decoded.email || null, role, token: decoded };
}

export function randomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

export function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[api] erro interno:', err.message);
  return res.status(status).json({ success: false, message: status >= 500 ? 'Erro interno.' : err.message });
}
