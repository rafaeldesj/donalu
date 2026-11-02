#!/usr/bin/env node
// Migração: garante que cada usuário da coleção `users` tenha conta no Firebase Authentication
// e remove os campos `password` e `tempPassword` do Firestore.
//
// USO (leia docs/MIGRACAO-SENHAS.md antes):
//   Simulação (padrão, não altera nada):  node scripts/migrate-passwords.mjs
//   Aplicar no EMULADOR:                  node scripts/migrate-passwords.mjs --apply
//   Aplicar em PRODUÇÃO:                  node scripts/migrate-passwords.mjs --apply --production \
//                                           --project=dona-lu-4242d --confirm-backup
//
// O script NUNCA imprime senhas, e-mails ou telefones. O relatório mostra só contagens e IDs de documento.
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];

const APPLY = flag('apply');
const PRODUCTION = flag('production');
const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = opt('project') || process.env.FIREBASE_PROJECT_ID || (usingEmulator ? 'demo-donalu' : '');

function abort(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

// ---- travas de segurança ----
if (PRODUCTION && usingEmulator) abort('--production não pode ser usado com FIRESTORE_EMULATOR_HOST definido.');
if (!PRODUCTION && !usingEmulator) {
  abort('Nenhum emulador detectado (FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST). Para produção use --production.');
}
if (PRODUCTION && APPLY) {
  if (!flag('confirm-backup')) abort('Aplicar em produção exige --confirm-backup (backup feito e confirmado por você).');
  if (projectId !== 'dona-lu-4242d') abort('Aplicar em produção exige --project=dona-lu-4242d.');
}
if (!projectId) abort('Informe --project=<id>.');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(
  usingEmulator
    ? { projectId }
    : { projectId, credential: raw ? cert(JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))) : applicationDefault() }
);
const auth = getAuth();
const db = getFirestore();

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const randomPassword = () => crypto.randomBytes(18).toString('base64url');

async function passwordMatches(email, password) {
  const key = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'fake-api-key';
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  return r.ok;
}

const report = {
  mode: APPLY ? 'APPLY' : 'DRY-RUN', target: PRODUCTION ? 'PRODUCTION' : 'EMULATOR', projectId,
  totals: { users: 0, withLegacySecret: 0 },
  authAlreadyOk: [],        // tem conta no Auth (senha mantida)
  authCreatedWithOldPassword: [],  // sem conta: criada com a senha que o usuário já conhecia
  authCreatedNeedsReset: [],       // sem conta e senha antiga inutilizável (<6): criada com senha aleatória
  tempPasswordApplied: [],  // senha provisória do gerente passou a valer no Auth
  divergent: [],            // conta no Auth com senha diferente da gravada: NÃO alterada, precisa redefinir
  unmigratable: [],         // {id, reason}: sem e-mail válido ou e-mail em uso por outra conta
  fieldsRemoved: []
};

const snap = await db.collection('users').get();
report.totals.users = snap.size;

for (const d of snap.docs) {
  const data = d.data();
  const hasSecret = 'password' in data || 'tempPassword' in data;
  if (hasSecret) report.totals.withLegacySecret++;

  const email = (data.authEmail || data.email || '').trim().toLowerCase();
  const temp = typeof data.tempPassword === 'string' && data.tempPassword ? data.tempPassword : null;
  const pass = typeof data.password === 'string' && data.password ? data.password : null;
  const known = temp || pass; // a senha provisória tinha prioridade no login antigo

  let canClean = true;
  let existing = null;
  try { existing = await auth.getUser(d.id); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }

  if (existing) {
    if (temp && existing.email) {
      // Gerente definiu senha provisória: ela passa a valer no Auth (como o usuário foi orientado).
      if (APPLY) await auth.updateUser(d.id, { password: temp });
      report.tempPasswordApplied.push(d.id);
    } else if (pass && existing.email) {
      const ok = await passwordMatches(existing.email, pass).catch(() => false);
      (ok ? report.authAlreadyOk : report.divergent).push(d.id);
    } else {
      report.authAlreadyOk.push(d.id);
    }
  } else if (!emailOk(email)) {
    report.unmigratable.push({ id: d.id, reason: 'sem e-mail válido' });
    canClean = false;
  } else {
    // sem conta: precisa criar. E-mail já usado por OUTRO uid = conflito.
    const other = await auth.getUserByEmail(email).catch((e) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e)));
    if (other) {
      report.unmigratable.push({ id: d.id, reason: 'e-mail já pertence a outra conta no Auth' });
      canClean = false;
    } else {
      const usable = known && known.length >= 6;
      if (APPLY) await auth.createUser({ uid: d.id, email, password: usable ? known : randomPassword(), displayName: data.name || undefined });
      (usable ? report.authCreatedWithOldPassword : report.authCreatedNeedsReset).push(d.id);
    }
  }

  // Só apaga os campos de senha se a pessoa tem (ou passou a ter) conta no Auth.
  if (hasSecret && canClean) {
    if (APPLY) await d.ref.update({ password: FieldValue.delete(), tempPassword: FieldValue.delete() });
    report.fieldsRemoved.push(d.id);
  }
}

const out = `migration-report.${report.target.toLowerCase()}.${APPLY ? 'apply' : 'dryrun'}.local.json`; // *.local é ignorado pelo git
writeFileSync(out, JSON.stringify(report, null, 2));

const n = (a) => a.length;
console.log(`\n=== ${report.mode} em ${report.target} (projeto ${projectId}) ===`);
console.log(`Usuários: ${report.totals.users} | com senha legada no Firestore: ${report.totals.withLegacySecret}`);
console.log(`Já tinham conta no Auth (senha confere): ${n(report.authAlreadyOk)}`);
console.log(`Conta criada mantendo a senha que já conheciam: ${n(report.authCreatedWithOldPassword)}`);
console.log(`Conta criada com senha aleatória (precisam redefinir): ${n(report.authCreatedNeedsReset)}`);
console.log(`Senha provisória aplicada no Auth: ${n(report.tempPasswordApplied)}`);
console.log(`Senha divergente (NÃO alterada; precisam redefinir): ${n(report.divergent)}`);
console.log(`NÃO migráveis (nada apagado neles): ${n(report.unmigratable)}`);
console.log(`Campos de senha ${APPLY ? 'removidos' : 'que seriam removidos'}: ${n(report.fieldsRemoved)}`);
console.log(`Relatório (somente IDs): ${out}\n`);
if (!APPLY) console.log('Nada foi alterado (simulação). Use --apply para executar.\n');
