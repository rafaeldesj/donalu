// Testa scripts/migrate-passwords.mjs no emulador (dados 100% fictícios).
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
// @ts-expect-error módulos JS sem tipos
import { adminAuth, adminDb } from '../../api/_lib/admin.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST!;
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-donalu';
const REPORT_DRY = 'migration-report.emulator.dryrun.local.json';
const REPORT_APPLY = 'migration-report.emulator.apply.local.json';

const emailLogin = async (email: string, password: string) =>
  (await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
  })).ok;

const run = (...a: string[]) => execFileSync('node', ['scripts/migrate-passwords.mjs', ...a], { env: process.env, encoding: 'utf8' });
const doc = async (id: string) => (await adminDb().collection('users').doc(id).get()).data();

// Conexões reaproveitadas podem cair depois de um processo filho síncrono: tenta de novo.
async function del(url: string) {
  for (let i = 0; i < 4; i++) {
    try { return await fetch(url, { method: 'DELETE', headers: { Connection: 'close' } }); } catch (e) { if (i === 3) throw e; }
  }
}

beforeEach(async () => {
  await del(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`);
  await del(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
  const u = (id: string, extra: any) => adminDb().collection('users').doc(id).set({ uid: id, name: id, role: 'client', ...extra });

  await adminAuth().createUser({ uid: 'A', email: 'a@t.local', password: 'abcdef1' });
  await u('A', { email: 'a@t.local', password: 'abcdef1' });                                  // já ok
  await u('B', { email: 'b@t.local', password: 'oldpass1' });                                 // sem conta
  await u('C', { email: 'c@t.local', tempPassword: 'tmp12345' });                             // sem conta + provisória
  await u('D', { email: 'd@t.local', password: '123' });                                      // senha curta
  await adminAuth().createUser({ uid: 'E', email: 'e@t.local', password: 'senha-nova-1' });
  await u('E', { email: 'e@t.local', password: 'senha-velha-1' });                            // divergente
  await u('F', { name: 'sem email', password: 'qualquer1' });                                 // sem e-mail
  await adminAuth().createUser({ uid: 'OUTRO', email: 'g@t.local', password: 'zzzzzz1' });
  await u('G', { email: 'g@t.local', password: 'conflito1' });                                // e-mail de outra conta
  await adminAuth().createUser({ uid: 'H', email: 'h@t.local', password: 'antiga-h-1' });
  await u('H', { email: 'h@t.local', password: 'antiga-h-1', tempPassword: 'provisoria-h' }); // provisória vence
  await u('I', { email: 'i@t.local' });                                                       // sem senha nenhuma (Google)
  await adminAuth().createUser({ uid: 'I', email: 'i@t.local' });
});

describe('migração de senhas (emulador)', () => {
  it('simulação não altera nada e classifica corretamente', async () => {
    const out = run();
    expect(out).toContain('DRY-RUN');
    expect(out).toContain('Nada foi alterado');
    expect((await doc('B'))!.password).toBe('oldpass1');
    await expect(adminAuth().getUser('B')).rejects.toThrow();
    const r = JSON.parse(readFileSync(REPORT_DRY, 'utf8'));
    expect(r.authCreatedWithOldPassword.sort()).toEqual(['B', 'C']);
    expect(r.authCreatedNeedsReset).toEqual(['D']);
    expect(r.divergent).toEqual(['E']);
    expect(r.tempPasswordApplied).toEqual(['H']);
    expect(r.unmigratable.map((x: any) => x.id).sort()).toEqual(['F', 'G']);
    // o relatório não contém senhas nem e-mails
    expect(JSON.stringify(r)).not.toMatch(/oldpass1|tmp12345|senha-velha|@t\.local/);
    rmSync(REPORT_DRY, { force: true });
  });

  it('aplicar: cria contas, mantém logins, remove senhas e preserva quem não migrou', async () => {
    run('--apply');
    // contas criadas mantendo a senha que o usuário já conhecia
    expect(await emailLogin('b@t.local', 'oldpass1')).toBe(true);
    expect(await emailLogin('c@t.local', 'tmp12345')).toBe(true);
    // senha curta: conta criada mas a senha antiga NÃO funciona (precisa redefinir)
    expect(await emailLogin('d@t.local', '123')).toBe(false);
    await expect(adminAuth().getUser('D')).resolves.toBeTruthy();
    // provisória do gerente passa a valer; divergente não é sobrescrita
    expect(await emailLogin('h@t.local', 'provisoria-h')).toBe(true);
    expect(await emailLogin('e@t.local', 'senha-nova-1')).toBe(true);
    // campos removidos de quem migrou
    for (const id of ['A', 'B', 'C', 'D', 'E', 'H']) {
      const d = await doc(id);
      expect('password' in d!).toBe(false);
      expect('tempPassword' in d!).toBe(false);
    }
    // quem não pôde migrar não teve nada apagado
    expect((await doc('F'))!.password).toBe('qualquer1');
    expect((await doc('G'))!.password).toBe('conflito1');
    rmSync(REPORT_APPLY, { force: true });
  });

  it('é idempotente (segunda execução não muda nada)', async () => {
    run('--apply');
    run('--apply');
    const r = JSON.parse(readFileSync(REPORT_APPLY, 'utf8'));
    expect(r.fieldsRemoved).toEqual([]);
    expect(r.authCreatedWithOldPassword).toEqual([]);
    rmSync(REPORT_APPLY, { force: true });
  });

  it('travas: produção exige --confirm-backup, --project correto e proíbe emulador ativo', () => {
    const t = (...a: string[]) => spawnSync('node', ['scripts/migrate-passwords.mjs', ...a], { env: process.env, encoding: 'utf8' });
    expect(t('--apply', '--production').status).toBe(1);           // emulador ativo + produção
    const noEmu = { ...process.env } as Record<string, string | undefined>;
    delete noEmu.FIRESTORE_EMULATOR_HOST; delete noEmu.FIREBASE_AUTH_EMULATOR_HOST;
    const s = (...a: string[]) => spawnSync('node', ['scripts/migrate-passwords.mjs', ...a], { env: noEmu, encoding: 'utf8' });
    expect(s('--apply', '--production', '--project=dona-lu-4242d').stderr).toContain('--confirm-backup');
    expect(s('--apply', '--production', '--confirm-backup', '--project=outro').stderr).toContain('--project=dona-lu-4242d');
    expect(s().stderr).toContain('Nenhum emulador');                // sem emulador e sem --production
  });
});
