#!/usr/bin/env node
// Cria no cardápio os produtos Inhoque (4) e Escondidinho de Aipim (5), com os grupos de opções.
//
//   Simulação (padrão, não altera nada):  node scripts/seed-inhoque-escondidinho.mjs --production --project=dona-lu-4242d
//   Aplicar:                              node scripts/seed-inhoque-escondidinho.mjs --apply --production --project=dona-lu-4242d
//
// - Produtos que já existem (mesmo nome na mesma categoria) NÃO são recriados nem têm preço/estoque alterados;
//   só recebem os grupos de opções, se ainda não tiverem.
// - Produtos novos nascem com preço 0, estoque 0 e "ocultar se zerar": o cliente não os vê até o gerente
//   informar preço e estoque no cardápio. Preço só é preenchido aqui se estiver na tabela PRICES abaixo.
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRODUCTION = args.includes('--production');
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const projectId = opt('project') || (process.env.FIRESTORE_EMULATOR_HOST ? 'demo-donalu' : '');
const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!projectId) { console.error('Informe --project=<id>.'); process.exit(1); }
if (!PRODUCTION && !usingEmulator) { console.error('Sem emulador: use --production.'); process.exit(1); }
if (PRODUCTION && APPLY && projectId !== 'dona-lu-4242d') { console.error('Em produção use --project=dona-lu-4242d.'); process.exit(1); }

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(usingEmulator ? { projectId } : {
  projectId,
  credential: raw ? cert(JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))) : applicationDefault()
});
const db = getFirestore();

const CAT_INHOQUE = 'Inhoque';
const CAT_ESCONDIDINHO = 'Escondidinho de Aipim';

const INHOQUE_GROUPS = [
  { id: 'passar_na', title: 'Passar na', required: true, options: ['Manteiga de garrafa', 'Pasta de Alho', 'Azeite', 'Nenhuma das opções acima'] },
  { id: 'molho', title: 'Molho', required: true, options: ['Carne Assada', 'Bolonhesa'] }
];

const PRODUCTS = [
  ...['Batata Inglesa', 'Batata Doce', 'Aipim', 'Espinafre'].map((s) => ({
    name: `Inhoque ${s}`, category: CAT_INHOQUE, optionGroups: INHOQUE_GROUPS,
    description: `Inhoque de ${s}. Escolha em que passar e o molho.`
  })),
  ...['Carne Seca', 'Calabresa', 'Carne Assada', 'Camarão', 'Carne Moída'].map((s) => ({
    name: `Escondidinho de ${s}`, category: CAT_ESCONDIDINHO, description: `Escondidinho de aipim com ${s.toLowerCase()}.`
  }))
];

// Preencha aqui quando souber: { "Inhoque Aipim": 18 }. Sem preço aqui => produto novo fica com 0 e oculto.
const PRICES = {};

const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const cats = (await db.doc('settings/menu_categories').get()).data()?.list || [];
for (const c of [CAT_INHOQUE, CAT_ESCONDIDINHO]) {
  if (!cats.includes(c)) console.log(`AVISO: categoria "${c}" não existe em settings/menu_categories (as abas do cardápio vêm de lá).`);
}

const snap = await db.collection('products').get();
const existing = snap.docs.map((d) => ({ ref: d.ref, ...d.data() }));
let baseId = Date.now();
let created = 0, updated = 0, kept = 0;

for (const p of PRODUCTS) {
  const found = existing.find((e) => norm(e.name) === norm(p.name) && e.category === p.category);
  if (found) {
    if (p.optionGroups && !found.optionGroups) {
      console.log(`ATUALIZAR  ${p.name}: adiciona grupos de opções (preço e estoque mantidos)`);
      if (APPLY) await found.ref.update({ optionGroups: p.optionGroups });
      updated++;
    } else {
      console.log(`MANTER     ${p.name}: já existe`);
      kept++;
    }
    continue;
  }
  const price = PRICES[p.name];
  const id = baseId++;
  const doc = {
    id, name: p.name, description: p.description, image: '', category: p.category,
    price: price ?? 0,
    ...(price === undefined ? { stock: 0, hideWhenOutOfStock: true } : {}),
    ...(p.optionGroups ? { optionGroups: p.optionGroups } : {})
  };
  console.log(`CRIAR      ${p.name}  [${p.category}]  preço ${doc.price}${price === undefined ? '  (oculto até definir preço/estoque)' : ''}`);
  if (APPLY) await db.collection('products').doc(String(id)).set(doc);
  created++;
}
console.log(`\n${APPLY ? 'APLICADO' : 'SIMULAÇÃO (nada alterado)'}: criar ${created}, atualizar ${updated}, manter ${kept}`);
