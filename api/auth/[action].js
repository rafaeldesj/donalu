// Funções de servidor de autenticação e gestão de contas.
// O Firebase Authentication é o ÚNICO responsável por validar senhas. Nenhuma senha é lida
// ou gravada no Firestore por este código.
import {
  adminAuth, adminDb, FieldValue, ROLE_RANK, VALID_ROLES,
  setCors, clientIp, checkRateLimit, registerFailure, clearFailures,
  requireCaller, randomPassword, fail
} from '../_lib/admin.js';

const GENERIC_LOGIN_ERROR = 'Usuário ou senha incorretos.';
const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
const SENSITIVE_FIELDS = ['password', 'tempPassword'];

// ---------- helpers ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });
const digits = (s) => String(s || '').replace(/\D/g, '');

function phoneVariants(raw) {
  let d = digits(raw);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  const out = new Set([d]);
  if (d.length === 11) out.add(`(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`);
  if (d.length === 10) out.add(`(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);
  return [...out];
}

async function verifyPasswordWithFirebase(email, password) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${apiKey || 'fake-api-key'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  return r.ok;
}

function assertRole(role) {
  if (!VALID_ROLES.includes(role)) throw httpError(400, 'Cargo inválido.');
}

/** Quem pode criar/alterar quem: developer pode tudo; os demais só mexem em cargos abaixo do seu. */
function assertCanAssign(callerRole, targetRole) {
  if (callerRole === 'developer') return;
  if (!((ROLE_RANK[callerRole] ?? -1) > (ROLE_RANK[targetRole] ?? 99))) throw httpError(403, 'Sem permissão para este cargo.');
}

function validPassword(p) {
  if (typeof p !== 'string' || p.length < 6 || p.length > 128) throw httpError(400, 'A senha deve ter entre 6 e 128 caracteres.');
}

function validEmail(e) {
  if (typeof e !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw httpError(400, 'E-mail inválido.');
  return e.trim().toLowerCase();
}

// ---------- ações ----------

const MAX_CANDIDATES = 10;

function nameVariants(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  const lower = t.toLowerCase();
  const title = lower.replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
  return [...new Set([t, lower, title, t.toUpperCase()])];
}

/** Contas candidatas para um identificador (celular ou nome). E-mail é tratado direto no Firebase Auth. */
async function findCandidates(identifier) {
  const col = adminDb().collection('users');
  const found = new Map();
  const digitsOnly = digits(identifier);
  const looksLikePhone = /^[\d\s()+-]+$/.test(identifier) && digitsOnly.length >= 8;
  const queries = looksLikePhone
    ? phoneVariants(identifier).map((v) => col.where('phoneNumber', '==', v))
    : nameVariants(identifier).map((v) => col.where('name', '==', v));
  for (const q of queries) {
    const snap = await q.limit(MAX_CANDIDATES).get();
    snap.forEach((d) => found.set(d.id, d.data()));
  }
  return [...found].slice(0, MAX_CANDIDATES);
}

/**
 * Login por celular ou nome: valida a senha no Firebase Auth e devolve um custom token.
 * Se vários cadastros tiverem o mesmo celular/nome, entra aquele cuja senha confere.
 */
async function loginIdentifier(req, res) {
  const body = req.body || {};
  const identifier = String(body.identifier ?? body.phone ?? '').trim();
  const password = body.password;
  const key = identifier.toLowerCase().replace(/\s+/g, ' ');
  if (identifier.length < 2 || identifier.length > 120 || typeof password !== 'string' || !password || password.length > 128) {
    return res.status(401).json({ success: false, message: GENERIC_LOGIN_ERROR });
  }

  const ip = clientIp(req);
  // Dois contadores: por identificador+IP (força bruta numa conta) e por IP (varredura de várias contas).
  const byAccount = await checkRateLimit(`login:${key}:${ip}`, { max: 5, windowMs: 15 * 60e3, lockMs: 15 * 60e3 });
  const byIp = await checkRateLimit(`login-ip:${ip}`, { max: 30, windowMs: 15 * 60e3, lockMs: 15 * 60e3 });
  if (!byAccount.allowed || !byIp.allowed) return res.status(429).json({ success: false, message: TOO_MANY });

  let uid = null;
  try {
    for (const [id, data] of await findCandidates(identifier)) {
      const email = data.authEmail || data.email;
      if (email && (await verifyPasswordWithFirebase(email, password))) { uid = id; break; }
    }
  } catch (err) {
    console.error('[login] erro:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível entrar agora. Tente novamente.' });
  }

  if (!uid) {
    await Promise.all([registerFailure(byAccount), registerFailure(byIp)]);
    return res.status(401).json({ success: false, message: GENERIC_LOGIN_ERROR });
  }
  await clearFailures(byAccount);
  const token = await adminAuth().createCustomToken(uid);
  return res.status(200).json({ success: true, token });
}

/** Usuário logado (ex.: Google) assume um pré-cadastro feito por um gerente com o mesmo e-mail verificado. */
async function claimProfile(req, res) {
  const caller = await requireCaller(req);
  const { uid, token } = caller;
  const ref = adminDb().collection('users').doc(uid);
  if ((await ref.get()).exists) return res.status(200).json({ success: true, claimed: false });
  if (!token.email || token.email_verified !== true) return res.status(200).json({ success: true, claimed: false });

  const email = token.email.toLowerCase();
  const snap = await adminDb().collection('users').where('email', '==', email).limit(5).get();
  for (const d of snap.docs) {
    if (d.id === uid) continue;
    // só assume pré-cadastros sem conta própria no Auth
    const hasAuth = await adminAuth().getUser(d.id).then(() => true).catch(() => false);
    if (hasAuth) continue;
    const data = { ...d.data(), uid, updatedAt: new Date().toISOString() };
    SENSITIVE_FIELDS.forEach((f) => delete data[f]);
    await ref.set(data);
    await d.ref.delete();
    return res.status(200).json({ success: true, claimed: true });
  }
  return res.status(200).json({ success: true, claimed: false });
}

/** Gerente/dono/dev cria uma conta (equipe ou cliente). A senha vai direto ao Firebase Auth. */
async function adminCreateUser(req, res) {
  const caller = await requireCaller(req, { minRole: 'manager' });
  const { email, password, name, role, phoneNumber, staffFunctions } = req.body || {};
  const safeEmail = validEmail(email);
  validPassword(password);
  assertRole(role);
  assertCanAssign(caller.role, role);
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw httpError(400, 'Nome inválido.');

  let userRecord;
  try {
    userRecord = await adminAuth().createUser({ email: safeEmail, password, displayName: name.trim() });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw httpError(409, 'Este e-mail já está cadastrado. Utilize outro e-mail.');
    throw e;
  }

  const now = new Date().toISOString();
  const doc = {
    uid: userRecord.uid,
    email: safeEmail,
    authEmail: safeEmail,
    name: name.trim(),
    role,
    phoneNumber: String(phoneNumber || '').trim(),
    createdAt: now,
    updatedAt: now,
    ...(role === 'staff' && staffFunctions ? { staffFunctions } : {})
  };
  await adminDb().collection('users').doc(userRecord.uid).set(doc);
  return res.status(200).json({ success: true, uid: userRecord.uid });
}

/** Define uma nova senha para uma conta de nível inferior. Nada é gravado no Firestore. */
async function adminSetPassword(req, res) {
  const caller = await requireCaller(req, { minRole: 'manager' });
  const { uid, password } = req.body || {};
  validPassword(password);
  if (typeof uid !== 'string' || !uid) throw httpError(400, 'Usuário inválido.');

  const snap = await adminDb().collection('users').doc(uid).get();
  if (!snap.exists) throw httpError(404, 'Usuário não encontrado.');
  const target = snap.data();
  if (uid !== caller.uid) assertCanAssign(caller.role, target.role);

  try {
    await adminAuth().updateUser(uid, { password });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    // Pré-cadastro antigo sem conta de login: cria a conta com o mesmo identificador do documento.
    const email = validEmail(target.authEmail || target.email);
    await adminAuth().createUser({ uid, email, password, displayName: target.name });
  }
  await adminAuth().revokeRefreshTokens(uid);
  // limpeza defensiva de resquícios do modelo antigo
  await adminDb().collection('users').doc(uid).update({
    password: FieldValue.delete(), tempPassword: FieldValue.delete(), updatedAt: new Date().toISOString()
  });
  return res.status(200).json({ success: true });
}

/** Altera o e-mail de login (Auth) e o do perfil (Firestore) juntos. */
async function adminUpdateEmail(req, res) {
  const caller = await requireCaller(req, { minRole: 'manager' });
  const { uid } = req.body || {};
  const email = validEmail(req.body?.email);
  const snap = await adminDb().collection('users').doc(String(uid)).get();
  if (!snap.exists) throw httpError(404, 'Usuário não encontrado.');
  if (uid !== caller.uid) assertCanAssign(caller.role, snap.data().role);
  try {
    await adminAuth().updateUser(uid, { email });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw httpError(409, 'Este e-mail já está em uso.');
    if (e.code !== 'auth/user-not-found') throw e; // pré-cadastro sem conta: só o Firestore muda
  }
  await snap.ref.update({ email, authEmail: email, updatedAt: new Date().toISOString() });
  return res.status(200).json({ success: true });
}

/** Exclui a conta (Auth + perfil). Somente dono/desenvolvedor, e nunca a si mesmo. */
async function adminDeleteUser(req, res) {
  const caller = await requireCaller(req, { minRole: 'owner' });
  const { uid } = req.body || {};
  if (typeof uid !== 'string' || !uid || uid === caller.uid) throw httpError(400, 'Usuário inválido.');
  const snap = await adminDb().collection('users').doc(uid).get();
  if (snap.exists) assertCanAssign(caller.role, snap.data().role);
  await adminAuth().deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e; });
  await adminDb().collection('users').doc(uid).delete();
  return res.status(200).json({ success: true });
}

/** Cadastro rápido de cliente no PDV: conta com senha aleatória (o cliente usa "Esqueci a senha"). */
async function createClient(req, res) {
  await requireCaller(req, { minRole: 'staff' });
  const { name, phoneNumber } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw httpError(400, 'Nome inválido.');
  const email = `cliente_${Date.now()}_${Math.floor(Math.random() * 1e4)}@donalu.com`;
  const rec = await adminAuth().createUser({ email, password: randomPassword(), displayName: name.trim() });
  const now = new Date().toISOString();
  await adminDb().collection('users').doc(rec.uid).set({
    uid: rec.uid, email, authEmail: email, name: name.trim(), phoneNumber: String(phoneNumber || '').trim(),
    role: 'client', createdAt: now, updatedAt: now
  });
  return res.status(200).json({ success: true, uid: rec.uid, email });
}

const routes = {
  'login': loginIdentifier,
  'login-phone': loginIdentifier,
  'claim-profile': claimProfile,
  'admin-create-user': adminCreateUser,
  'admin-set-password': adminSetPassword,
  'admin-update-email': adminUpdateEmail,
  'admin-delete-user': adminDeleteUser,
  'create-client': createClient
};

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  const fn = routes[req.query.action];
  if (!fn) return res.status(404).json({ success: false, message: 'Route not found' });
  try {
    return await fn(req, res);
  } catch (err) {
    return fail(res, err);
  }
}
