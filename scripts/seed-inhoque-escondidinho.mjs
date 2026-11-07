#!/usr/bin/env node
// Cria no cardápio os produtos Inhoque (4) e Escondidinho de Aipim (5), com os grupos de opções.
//
//   Simulação (padrão, não altera nada):  node scripts/seed-inhoque-escondidinho.mjs --production --project=dona-lu-4242d
//   Aplicar:                              node scripts/seed-inhoque-escondidinho.mjs --apply --production --project=dona-lu-4242d
//
// - Produtos que já existem (mesmo nome na mesma categoria) NÃO são recriados; só recebem o que falta
//   (grupos de opções, foto e preço, se estiverem vazios). Preço e estoque já definidos nunca são sobrescritos.
// - Sem --liberar-estoque, produtos novos nascem com estoque 0 e "ocultar se zerar" (o cliente não os vê).
//   Com --liberar-estoque, produtos sem estoque passam a ter ESTOQUE_INICIAL e ficam visíveis. Só use depois que o
//   site com as opções (checkbox) estiver publicado, senão o site antigo vende Inhoque sem pedir o molho.
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRODUCTION = args.includes('--production');
const LIBERAR = args.includes('--liberar-estoque');
const ESTOQUE_INICIAL = 20;
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

const mk = (name, category, image, extra = {}) => ({ name, category, image, ...extra });
const PRODUCTS = [
  ...[
    ['Batata Inglesa', 'inhoque_batata_inglesa'], ['Batata Doce', 'inhoque_batata_doce'],
    ['Aipim', 'inhoque_aipim'], ['Espinafre', 'inhoque_espinafre']
  ].map(([s, img]) => mk(`Inhoque ${s}`, CAT_INHOQUE, `/assets/${img}.jpg`, {
    optionGroups: INHOQUE_GROUPS, description: `Inhoque de ${s}. Escolha em que passar e o molho.`
  })),
  ...[
    ['Carne Seca', 'escondidinho_carne_seca'], ['Calabresa', 'escondidinho_calabresa'], ['Carne Assada', 'escondidinho_carne_assada'],
    ['Camarão', 'escondidinho_camarao'], ['Carne Moída', 'escondidinho_carne_moida']
  ].map(([s, img]) => mk(`Escondidinho de ${s}`, CAT_ESCONDIDINHO, `/assets/${img}.jpg`, {
    description: `Escondidinho de aipim com ${s.toLowerCase()}.`
  }))
];

const PRICES = { [CAT_INHOQUE]: 18, [CAT_ESCONDIDINHO]: 15 }; // por categoria

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
  const price = PRICES[p.category];
  const found = existing.find((e) => norm(e.name) === norm(p.name) && e.category === p.category);
  if (found) {
    const patch = {};
    if (p.optionGroups && !found.optionGroups) patch.optionGroups = p.optionGroups;
    if (!found.image) patch.image = p.image;
    if (!found.price) patch.price = price;
    if (LIBERAR && !(found.stock > 0)) { patch.stock = ESTOQUE_INICIAL; patch.hideWhenOutOfStock = false; }
    if (Object.keys(patch).length) {
      console.log(`ATUALIZAR  ${p.name}: ${Object.keys(patch).join(', ')}`);
      if (APPLY) await found.ref.update(patch);
      updated++;
    } else { console.log(`MANTER     ${p.name}: nada a alterar`); kept++; }
    continue;
  }
  const id = baseId++;
  const doc = {
    id, name: p.name, description: p.description, image: p.image, category: p.category, price,
    ...(LIBERAR ? { stock: ESTOQUE_INICIAL, hideWhenOutOfStock: false } : { stock: 0, hideWhenOutOfStock: true }),
    ...(p.optionGroups ? { optionGroups: p.optionGroups } : {})
  };
  console.log(`CRIAR      ${p.name}  [${p.category}]  R$ ${price}  ${LIBERAR ? `estoque ${ESTOQUE_INICIAL}` : '(oculto)'}`);
  if (APPLY) await db.collection('products').doc(String(id)).set(doc);
  created++;
}
console.log(`
${APPLY ? 'APLICADO' : 'SIMULAÇÃO (nada alterado)'}: criar ${created}, atualizar ${updated}, manter ${kept}`);
