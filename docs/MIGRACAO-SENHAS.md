# Migração de senhas (Firestore → Firebase Authentication)

Este guia é para **depois** que o código novo estiver aprovado. Nada aqui roda sozinho: cada passo
de produção precisa da sua confirmação.

## O que a migração faz

Para cada documento da coleção `users`:

| Situação | O que o script faz |
|---|---|
| Já tem conta no Firebase Auth e a senha confere | Só apaga `password`/`tempPassword` do Firestore. |
| Não tem conta no Auth e tinha senha com 6+ caracteres | Cria a conta **com a senha que a pessoa já usava** (o login continua igual). Apaga os campos. |
| Não tem conta no Auth e a senha era curta/ausente | Cria a conta com senha aleatória. A pessoa usa **"Esqueceu a senha?"**. Apaga os campos. |
| Tinha `tempPassword` (senha provisória do gerente) | A provisória vira a senha no Auth. Apaga os campos. |
| Conta no Auth com senha **diferente** da gravada | **Não altera o Auth** (pode ser uma senha mais nova). Apaga os campos. A pessoa usa "Esqueceu a senha?". |
| Sem e-mail válido, ou e-mail já pertence a outra conta | **Não migra e não apaga nada.** Aparece no relatório para você resolver na mão. |

O script **nunca imprime** senhas, e-mails ou telefones. O relatório (`migration-report.*.local.json`,
ignorado pelo Git) tem só IDs de documento.

## Quem não puder ser migrado / como redefinir a senha

- **Cliente com e-mail real:** na tela de login, "Esqueceu a senha?" → recebe o link do Firebase.
- **Cliente que só entra por telefone (e-mail gerado `@donalu.com`):** o e-mail não existe de verdade.
  Um gerente define uma senha nova em *Usuários → Redefinir senha* e passa para a pessoa.
- **Equipe:** o gerente/dono redefine em *Usuários → Redefinir senha*.

## Passo a passo

### 1. Ensaio no emulador (já feito; repita quando quiser)
```
npm run test:server      # inclui testes da migração com dados fictícios
```

### 2. Simulação contra a produção (só leitura)
Exige uma credencial de conta de serviço do Firebase (variável `FIREBASE_SERVICE_ACCOUNT` ou
`GOOGLE_APPLICATION_CREDENTIALS`), **fora do repositório**.
```
node scripts/migrate-passwords.mjs --production --project=dona-lu-4242d
```
Sem `--apply` nada é alterado. Leia a contagem e o relatório.

### 3. BACKUP (obrigatório antes de aplicar)
1. **Firestore** (precisa de um bucket do Cloud Storage; `gcloud` instalado e logado):
   ```
   gcloud firestore export gs://SEU-BUCKET/backup-AAAA-MM-DD --project=dona-lu-4242d
   ```
   Alternativa pelo console: Firebase Console → Firestore → *Importar/Exportar*.
2. **Contas do Authentication:**
   ```
   firebase auth:export auth-backup.local.json --project dona-lu-4242d
   ```
   Esse arquivo tem hashes de senha: guarde-o em local privado e **não** o envie ao Git
   (`*.local` já é ignorado).
3. Confirme que o backup existe (liste o bucket / abra o arquivo) **antes** de seguir.

### 4. Aplicar (somente após sua confirmação explícita)
```
node scripts/migrate-passwords.mjs --apply --production --project=dona-lu-4242d --confirm-backup
```
O script é idempotente: pode rodar de novo sem efeito colateral.

### 5. Depois
- Teste login de cada cargo.
- Trate os IDs de `unmigratable`, `divergent` e `authCreatedNeedsReset` do relatório.
- Apague os arquivos `*.local.json` de relatório e de backup do Auth quando não precisar mais.

## Como voltar atrás
O backup do Firestore restaura os campos (`gcloud firestore import ...`). Contas criadas no Auth podem
ser removidas pelos IDs do relatório. Por isso o backup vem **antes**.
