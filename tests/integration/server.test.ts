/* eslint-disable @typescript-eslint/no-explicit-any */
// Testes de integração das funções de servidor contra os emuladores de Auth e Firestore:
//   npm run test:server
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
// @ts-expect-error módulos JS sem tipos
import authHandler from '../../api/auth/[action].js';
// @ts-expect-error módulos JS sem tipos
import aiHandler from '../../api/ai/chat.js';
// @ts-expect-error módulos JS sem tipos
import { adminAuth, adminDb } from '../../api/_lib/admin.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST!;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-donalu';

type Res = { code: number; body: any };
async function call(handler: any, action: string, body: any = {}, token?: string, ip = '10.0.0.1'): Promise<Res> {
  const out: Res = { code: 0, body: null };
  const res = {
    setHeader() {}, end() { return this; },
    status(c: number) { out.code = c; return this; },
    json(b: any) { out.body = b; return this; }
  };
  await handler({
    method: 'POST', query: { action }, body,
    headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, socket: {}
  }, res);
  return out;
}
const api = (action: string, body?: any, token?: string, ip?: string) => call(authHandler, action, body, token, ip);

async function idTokenFor(uid: string) {
  const custom = await adminAuth().createCustomToken(uid);
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  return (await r.json()).idToken as string;
}
async function emailLogin(email: string, password: string) {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  return r.ok;
}
async function seedUser(uid: string, role: string, extra: any = {}) {
  const email = extra.email ?? `${uid}@teste.local`;
  await adminAuth().createUser({ uid, email, password: extra.password ?? 'senha-forte-1', emailVerified: true });
  await adminDb().collection('users').doc(uid).set({
    uid, email, authEmail: email, name: uid, role, phoneNumber: extra.phoneNumber ?? '', createdAt: 'x', updatedAt: 'x'
  });
}
const noSecretInDb = async () => {
  const snap = await adminDb().collection('users').get();
  snap.forEach((d: any) => {
    expect('password' in d.data()).toBe(false);
    expect('tempPassword' in d.data()).toBe(false);
  });
};

beforeAll(() => { expect(AUTH_HOST && FS_HOST).toBeTruthy(); });

beforeEach(async () => {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await seedUser('dev1', 'developer');
  await seedUser('own1', 'owner');
  await seedUser('man1', 'manager');
  await seedUser('st1', 'staff');
  await seedUser('c1', 'client', { phoneNumber: '(21) 98888-7777', password: 'minha-senha-9' });
});

describe('login por telefone', () => {
  it('entra com telefone (qualquer formatação) e senha corretos', async () => {
    for (const phone of ['21988887777', '(21) 98888-7777', '+55 21 98888-7777']) {
      const r = await api('login-phone', { phone, password: 'minha-senha-9' });
      expect(r.code).toBe(200);
      expect(typeof r.body.token).toBe('string');
    }
  });
  it('senha errada e telefone inexistente dão a MESMA resposta (não revela se a conta existe)', async () => {
    const wrong = await api('login-phone', { phone: '21988887777', password: 'errada-123' }, undefined, '10.0.0.2');
    const unknown = await api('login-phone', { phone: '21977776666', password: 'errada-123' }, undefined, '10.0.0.3');
    expect(wrong.code).toBe(401);
    expect(unknown.code).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(JSON.stringify(wrong.body)).not.toMatch(/c1|encontrad|cadastrad|existe/i);
  });
  it('bloqueia após 5 tentativas erradas (inclusive para telefone inexistente) e depois nega até a senha certa', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await api('login-phone', { phone: '21988887777', password: `x${i}abcdef` }, undefined, '10.0.0.9')).code).toBe(401);
    }
    const locked = await api('login-phone', { phone: '21988887777', password: 'minha-senha-9' }, undefined, '10.0.0.9');
    expect(locked.code).toBe(429);
    for (let i = 0; i < 5; i++) await api('login-phone', { phone: '21900000000', password: `y${i}abcdef` }, undefined, '10.0.0.8');
    expect((await api('login-phone', { phone: '21900000000', password: 'z' }, undefined, '10.0.0.8')).code).toBe(429);
  });
  it('outro IP não é afetado pelo bloqueio de uma conta+IP', async () => {
    expect((await api('login-phone', { phone: '21988887777', password: 'minha-senha-9' }, undefined, '10.9.9.9')).code).toBe(200);
  });
  it('rejeita entrada malformada sem erro de servidor', async () => {
    expect((await api('login-phone', {})).code).toBe(401);
    expect((await api('login-phone', { phone: '123', password: 'x' })).code).toBe(401);
    expect((await api('login-phone', { phone: { $ne: 1 }, password: ['x'] })).code).toBe(401);
  });
  it('o token devolvido autentica o usuário certo', async () => {
    const r = await api('login-phone', { phone: '21988887777', password: 'minha-senha-9' });
    const decoded = await adminAuth().verifyIdToken(await (async () => {
      const x = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: r.body.token, returnSecureToken: true })
      });
      return (await x.json()).idToken;
    })());
    expect(decoded.uid).toBe('c1');
  });
});

describe('gestão de contas (cargos)', () => {
  const newUser = (role: string, over: any = {}) => ({
    email: `novo-${role}@teste.local`, password: 'inicial-123', name: `Novo ${role}`, role, phoneNumber: '21911112222', ...over
  });

  it('sem token ou com token inválido: 401', async () => {
    expect((await api('admin-create-user', newUser('staff'))).code).toBe(401);
    expect((await api('admin-create-user', newUser('staff'), 'lixo')).code).toBe(401);
  });
  it('cliente e staff não criam contas (403)', async () => {
    expect((await api('admin-create-user', newUser('staff'), await idTokenFor('c1'))).code).toBe(403);
    expect((await api('admin-create-user', newUser('client'), await idTokenFor('st1'))).code).toBe(403);
  });
  it('gerente cria staff e a conta entra por e-mail; senha NÃO vai ao Firestore', async () => {
    const r = await api('admin-create-user', newUser('staff'), await idTokenFor('man1'));
    expect(r.code).toBe(200);
    expect(await emailLogin('novo-staff@teste.local', 'inicial-123')).toBe(true);
    const doc = (await adminDb().collection('users').doc(r.body.uid).get()).data();
    expect(doc.role).toBe('staff');
    await noSecretInDb();
  });
  it('hierarquia: gerente não cria gerente/dono; dono cria gerente mas não dono; dev cria dono', async () => {
    const man = await idTokenFor('man1'), own = await idTokenFor('own1'), dev = await idTokenFor('dev1');
    expect((await api('admin-create-user', newUser('manager', { email: 'a@t.local' }), man)).code).toBe(403);
    expect((await api('admin-create-user', newUser('owner', { email: 'b@t.local' }), man)).code).toBe(403);
    expect((await api('admin-create-user', newUser('manager', { email: 'c@t.local' }), own)).code).toBe(200);
    expect((await api('admin-create-user', newUser('owner', { email: 'd@t.local' }), own)).code).toBe(403);
    expect((await api('admin-create-user', newUser('developer', { email: 'e@t.local' }), own)).code).toBe(403);
    expect((await api('admin-create-user', newUser('owner', { email: 'f@t.local' }), dev)).code).toBe(200);
  });
  it('e-mail duplicado e cargo inventado são recusados', async () => {
    const own = await idTokenFor('own1');
    expect((await api('admin-create-user', newUser('staff', { email: 'st1@teste.local' }), own)).code).toBe(409);
    expect((await api('admin-create-user', newUser('superuser'), own)).code).toBe(400);
    expect((await api('admin-create-user', newUser('staff', { password: '123' }), own)).code).toBe(400);
  });
  it('redefinir senha: gerente muda a de staff; não a de dono; nada vai ao Firestore', async () => {
    const man = await idTokenFor('man1');
    expect((await api('admin-set-password', { uid: 'st1', password: 'nova-senha-77' }, man)).code).toBe(200);
    expect(await emailLogin('st1@teste.local', 'nova-senha-77')).toBe(true);
    expect(await emailLogin('st1@teste.local', 'senha-forte-1')).toBe(false);
    expect((await api('admin-set-password', { uid: 'own1', password: 'nova-senha-77' }, man)).code).toBe(403);
    expect(await emailLogin('own1@teste.local', 'senha-forte-1')).toBe(true);
    await noSecretInDb();
  });
  it('redefinir senha de pré-cadastro sem conta no Auth cria a conta', async () => {
    await adminDb().collection('users').doc('PRE_REG_AUTO_ID_0001').set({
      uid: 'PRE_REG_AUTO_ID_0001', email: 'pre@teste.local', name: 'Pre', role: 'staff', createdAt: 'x', updatedAt: 'x'
    });
    const r = await api('admin-set-password', { uid: 'PRE_REG_AUTO_ID_0001', password: 'definida-123' }, await idTokenFor('man1'));
    expect(r.code).toBe(200);
    expect(await emailLogin('pre@teste.local', 'definida-123')).toBe(true);
  });
  it('alterar e-mail muda Auth e Firestore; gerente não mexe em superior', async () => {
    const man = await idTokenFor('man1');
    expect((await api('admin-update-email', { uid: 'st1', email: 'novo@teste.local' }, man)).code).toBe(200);
    expect(await emailLogin('novo@teste.local', 'senha-forte-1')).toBe(true);
    expect((await adminDb().collection('users').doc('st1').get()).data().email).toBe('novo@teste.local');
    expect((await api('admin-update-email', { uid: 'own1', email: 'x@teste.local' }, man)).code).toBe(403);
  });
  it('excluir conta: só dono/dev, nunca a si mesmo, remove Auth e perfil', async () => {
    expect((await api('admin-delete-user', { uid: 'c1' }, await idTokenFor('man1'))).code).toBe(403);
    expect((await api('admin-delete-user', { uid: 'own1' }, await idTokenFor('own1'))).code).toBe(400);
    expect((await api('admin-delete-user', { uid: 'dev1' }, await idTokenFor('own1'))).code).toBe(403);
    expect((await api('admin-delete-user', { uid: 'c1' }, await idTokenFor('own1'))).code).toBe(200);
    expect((await adminDb().collection('users').doc('c1').get()).exists).toBe(false);
    expect(await emailLogin('c1@teste.local', 'minha-senha-9')).toBe(false);
  });
  it('PDV: staff cadastra cliente com senha aleatória (sem senha fixa)', async () => {
    const r = await api('create-client', { name: 'Cliente Balcão', phoneNumber: '21922223333' }, await idTokenFor('st1'));
    expect(r.code).toBe(200);
    expect(await emailLogin(r.body.email, 'donalu')).toBe(false);
    expect((await adminDb().collection('users').doc(r.body.uid).get()).data().role).toBe('client');
    expect((await api('create-client', { name: 'X' }, await idTokenFor('c1'))).code).toBe(403);
    await noSecretInDb();
  });
});

describe('pré-cadastro (claim-profile)', () => {
  it('usuário com e-mail verificado assume pré-cadastro sem conta; senha legada não é copiada', async () => {
    await adminDb().collection('users').doc('PRE_REG_AUTO_ID_0002').set({
      uid: 'PRE_REG_AUTO_ID_0002', email: 'novo.func@teste.local', name: 'Func', role: 'staff', password: 'legada', createdAt: 'x', updatedAt: 'x'
    });
    await adminAuth().createUser({ uid: 'g1', email: 'novo.func@teste.local', emailVerified: true });
    const r = await api('claim-profile', {}, await idTokenFor('g1'));
    expect(r.body.claimed).toBe(true);
    const d = (await adminDb().collection('users').doc('g1').get()).data();
    expect(d.role).toBe('staff');
    expect('password' in d).toBe(false);
    expect((await adminDb().collection('users').doc('PRE_REG_AUTO_ID_0002').get()).exists).toBe(false);
  });
  it('e-mail NÃO verificado não assume o pré-cadastro (evita tomar o cargo de outra pessoa)', async () => {
    await adminDb().collection('users').doc('PRE_REG_AUTO_ID_0003').set({
      uid: 'PRE_REG_AUTO_ID_0003', email: 'alvo@teste.local', name: 'Alvo', role: 'manager', createdAt: 'x', updatedAt: 'x'
    });
    await adminAuth().createUser({ uid: 'atk', email: 'alvo@teste.local', emailVerified: false, password: 'qualquer-1' });
    const r = await api('claim-profile', {}, await idTokenFor('atk'));
    expect(r.body.claimed).toBe(false);
    expect((await adminDb().collection('users').doc('atk').get()).exists).toBe(false);
  });
});

describe('assistente (Gemini)', () => {
  it('sem GEMINI_API_KEY no servidor: responde vazio (cliente usa regras locais) e nunca devolve chave', async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await call(aiHandler, 'x', { message: 'oi' });
    expect(r.code).toBe(200);
    expect(r.body.text).toBe('');
    expect(JSON.stringify(r.body)).not.toMatch(/AIza|key/i);
  });
  it('rejeita mensagem vazia quando há chave configurada', async () => {
    process.env.GEMINI_API_KEY = 'chave-falsa-de-teste';
    const r = await call(aiHandler, 'x', { message: '   ' });
    expect(r.code).toBe(400);
    delete process.env.GEMINI_API_KEY;
  });
});
