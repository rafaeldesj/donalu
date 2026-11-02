// Testes das regras do Firestore. Rodam no Firebase Emulator (nunca no banco de produção):
//   npm run test:rules
import { readFileSync } from 'node:fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, limit, addDoc, deleteField
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const seed = (role: string, extra: Record<string, unknown> = {}) => ({
  uid: '', email: `${role}@teste.local`, name: role, role, phoneNumber: '21999990000',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', ...extra
});

const USERS: Record<string, Record<string, unknown>> = {
  dev1: seed('developer'),
  own1: seed('owner'),
  man1: seed('manager'),
  man2: seed('manager'),
  st1: seed('staff'),
  c1: seed('client'),
  c2: seed('client', { password: 'legado-que-deve-poder-ser-removido' })
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-donalu',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, data] of Object.entries(USERS)) await setDoc(doc(db, 'users', id), { ...data, uid: id });
    await setDoc(doc(db, 'settings', 'store_config'), { storeName: 'Dona Lu' });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('users: sem login', () => {
  it('não lê documento de usuário', async () => { await assertFails(getDoc(doc(anon(), 'users', 'c1'))); });
  it('não lista usuários', async () => { await assertFails(getDocs(collection(anon(), 'users'))); });
  it('não consulta com limit(1) (brecha antiga)', async () => {
    await assertFails(getDocs(query(collection(anon(), 'users'), limit(1))));
    await assertFails(getDocs(query(collection(anon(), 'users'), where('phoneNumber', '==', '21999990000'), limit(1))));
    await assertFails(getDocs(query(collection(anon(), 'users'), where('email', '==', 'client@teste.local'), limit(1))));
  });
  it('não cria nem altera nem apaga', async () => {
    await assertFails(setDoc(doc(anon(), 'users', 'novo'), seed('client')));
    await assertFails(updateDoc(doc(anon(), 'users', 'c1'), { name: 'x' }));
    await assertFails(deleteDoc(doc(anon(), 'users', 'c1')));
  });
});

describe('users: cliente logado', () => {
  it('lê o próprio documento', async () => { await assertSucceeds(getDoc(doc(as('c1'), 'users', 'c1'))); });
  it('não lê o documento de outro cliente', async () => { await assertFails(getDoc(doc(as('c1'), 'users', 'c2'))); });
  it('não lê documento de administrador', async () => { await assertFails(getDoc(doc(as('c1'), 'users', 'own1'))); });
  it('não lista usuários', async () => {
    await assertFails(getDocs(collection(as('c1'), 'users')));
    await assertFails(getDocs(query(collection(as('c1'), 'users'), limit(1))));
  });
  it('edita o próprio perfil', async () => { await assertSucceeds(updateDoc(doc(as('c1'), 'users', 'c1'), { name: 'Novo Nome' })); });
  it('não edita outro cliente', async () => { await assertFails(updateDoc(doc(as('c1'), 'users', 'c2'), { name: 'x' })); });
  it('não altera o próprio cargo', async () => {
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { role: 'developer' }));
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { role: 'staff' }));
  });
  it('não grava senha no Firestore', async () => {
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { password: '123456' }));
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { tempPassword: '123456' }));
  });
  it('pode remover senha legada do próprio documento', async () => {
    await assertSucceeds(updateDoc(doc(as('c2'), 'users', 'c2'), { password: deleteField() }));
  });
  it('não troca a identidade (authEmail/uid)', async () => {
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { authEmail: 'outro@x.com' }));
    await assertFails(updateDoc(doc(as('c1'), 'users', 'c1'), { uid: 'c2' }));
  });
  it('cria o próprio perfil só como client', async () => {
    await assertSucceeds(setDoc(doc(as('novo1'), 'users', 'novo1'), { ...seed('client'), uid: 'novo1' }));
    await assertFails(setDoc(doc(as('novo2'), 'users', 'novo2'), { ...seed('owner'), uid: 'novo2' }));
    await assertFails(setDoc(doc(as('novo3'), 'users', 'novo3'), { ...seed('client'), uid: 'novo3', password: 'x12345' }));
  });
  it('não cria perfil para outro uid', async () => {
    await assertFails(setDoc(doc(as('c1'), 'users', 'outro'), { ...seed('client'), uid: 'outro' }));
  });
  it('não apaga conta', async () => { await assertFails(deleteDoc(doc(as('c1'), 'users', 'c1'))); });
});

describe('users: equipe (staff)', () => {
  it('lê e lista usuários', async () => {
    await assertSucceeds(getDoc(doc(as('st1'), 'users', 'c1')));
    await assertSucceeds(getDocs(collection(as('st1'), 'users')));
  });
  it('atualiza dados operacionais de cliente (ex.: fidelidade)', async () => {
    await assertSucceeds(updateDoc(doc(as('st1'), 'users', 'c1'), { loyaltyPoints: 10 }));
  });
  it('não muda cargo, e-mail ou identidade de cliente', async () => {
    await assertFails(updateDoc(doc(as('st1'), 'users', 'c1'), { role: 'manager' }));
    await assertFails(updateDoc(doc(as('st1'), 'users', 'c1'), { email: 'x@x.com' }));
  });
  it('não altera administradores nem o próprio cargo', async () => {
    await assertFails(updateDoc(doc(as('st1'), 'users', 'own1'), { name: 'x' }));
    await assertFails(updateDoc(doc(as('st1'), 'users', 'st1'), { role: 'manager' }));
  });
  it('atualiza o próprio perfil (sem cargo)', async () => {
    await assertSucceeds(updateDoc(doc(as('st1'), 'users', 'st1'), { latitude: 1 }));
  });
});

describe('users: administradores', () => {
  it('gerente edita equipe e cliente', async () => {
    await assertSucceeds(updateDoc(doc(as('man1'), 'users', 'st1'), { name: 'Novo' }));
    await assertSucceeds(updateDoc(doc(as('man1'), 'users', 'c1'), { name: 'Novo' }));
  });
  it('gerente não promove ninguém nem altera superiores', async () => {
    await assertFails(updateDoc(doc(as('man1'), 'users', 'st1'), { role: 'manager' }));
    await assertFails(updateDoc(doc(as('man1'), 'users', 'c1'), { role: 'staff' }));
    await assertFails(updateDoc(doc(as('man1'), 'users', 'own1'), { name: 'x' }));
    await assertFails(updateDoc(doc(as('man1'), 'users', 'man2'), { name: 'x' }));
  });
  it('ninguém altera o próprio cargo (nem dono, gerente ou desenvolvedor)', async () => {
    await assertFails(updateDoc(doc(as('man1'), 'users', 'man1'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('own1'), 'users', 'own1'), { role: 'developer' }));
    await assertFails(updateDoc(doc(as('dev1'), 'users', 'dev1'), { role: 'client' }));
  });
  it('dono promove equipe a gerente, mas não a dono/desenvolvedor', async () => {
    await assertSucceeds(updateDoc(doc(as('own1'), 'users', 'st1'), { role: 'manager' }));
    await assertFails(updateDoc(doc(as('own1'), 'users', 'c1'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('own1'), 'users', 'c1'), { role: 'developer' }));
  });
  it('dono não altera desenvolvedor', async () => {
    await assertFails(updateDoc(doc(as('own1'), 'users', 'dev1'), { name: 'x' }));
  });
  it('desenvolvedor pode alterar o cargo de outras contas', async () => {
    await assertSucceeds(updateDoc(doc(as('dev1'), 'users', 'st1'), { role: 'owner' }));
  });
  it('administradores não gravam senha', async () => {
    await assertFails(updateDoc(doc(as('own1'), 'users', 'st1'), { tempPassword: 'abc123' }));
    await assertFails(updateDoc(doc(as('dev1'), 'users', 'st1'), { password: 'abc123' }));
  });
  it('administradores não criam contas direto no banco nem apagam (servidor faz)', async () => {
    await assertFails(setDoc(doc(as('own1'), 'users', 'x1'), { ...seed('manager'), uid: 'x1' }));
    await assertFails(deleteDoc(doc(as('dev1'), 'users', 'c1')));
  });
});

describe('outras coleções tocadas', () => {
  it('audit_logs: sem login não grava; logado grava; ninguém edita/apaga; só admin lê', async () => {
    await assertFails(addDoc(collection(anon(), 'audit_logs'), { a: 1 }));
    await assertSucceeds(addDoc(collection(as('st1'), 'audit_logs'), { a: 1 }));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'audit_logs', 'l1'), { a: 1 }); });
    await assertFails(updateDoc(doc(as('dev1'), 'audit_logs', 'l1'), { a: 2 }));
    await assertFails(deleteDoc(doc(as('dev1'), 'audit_logs', 'l1')));
    await assertFails(getDoc(doc(anon(), 'audit_logs', 'l1')));
    await assertFails(getDoc(doc(as('c1'), 'audit_logs', 'l1')));
    await assertSucceeds(getDoc(doc(as('man1'), 'audit_logs', 'l1')));
  });
  it('coleção de limite de tentativas é inacessível ao navegador', async () => {
    await assertFails(getDoc(doc(as('dev1'), '_rate_limits', 'x')));
    await assertFails(setDoc(doc(as('dev1'), '_rate_limits', 'x'), { count: 0 }));
  });
  it('settings continua legível (cardápio público)', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'store_config')));
  });
});
