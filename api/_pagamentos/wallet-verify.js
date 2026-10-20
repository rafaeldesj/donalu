import https from 'https';

const PROJECT_ID = 'dona-lu-4242d';
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAzR9UQyV0xIwYgU9xoTuiEfqwhIiDvIrU';
const MAX_IDS = 40;

function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = data ? JSON.stringify(data) : '';
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        ...headers,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr), 'Content-Type': 'application/json' } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: JSON.parse(body) });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Confirma que o chamador é proprietário (ou desenvolvedor) lendo o próprio perfil com o ID token dele.
async function assertOwner(idToken) {
  const lookup = await nativeRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    'POST', {}, { idToken }
  );
  const uid = lookup.json?.users?.[0]?.localId;
  if (!lookup.ok || !uid) return false;

  const userDoc = await nativeRequest(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`,
    'GET', { Authorization: `Bearer ${idToken}` }
  );
  const role = userDoc.json?.fields?.role?.stringValue;
  return role === 'owner' || role === 'developer';
}

async function getMercadoPagoToken() {
  const res = await nativeRequest(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/store_config`,
    'GET', {}
  );
  const fields = res.json?.fields;
  const token = fields?.storeOwnerAccessToken?.stringValue || fields?.devAccessToken?.stringValue;
  return token && token !== 'null' && token !== 'undefined' ? token : null;
}

// Aceita ID de pagamento (numérico) ou ID de order (Point / API Orders) e devolve o pagamento do MP.
async function fetchPayment(rawId, headers) {
  let paymentId = rawId;

  if (isNaN(Number(rawId))) {
    const orderRes = await nativeRequest(`https://api.mercadopago.com/v1/orders/${rawId}`, 'GET', headers);
    if (!orderRes.ok) return { notFound: true };
    const o = orderRes.json;
    paymentId =
      o?.payments?.[0]?.id ||
      o?.transactions?.payments?.[0]?.id ||
      o?.transactions?.[0]?.payments?.[0]?.id ||
      o?.transactions?.[0]?.transaction_id ||
      o?.payment?.id;
    if (!paymentId) {
      const search = await nativeRequest(`https://api.mercadopago.com/v1/payments/search?order.id=${rawId}`, 'GET', headers);
      paymentId = search.json?.results?.[0]?.id;
    }
    if (!paymentId) return { notFound: true };
  }

  const payRes = await nativeRequest(`https://api.mercadopago.com/v1/payments/${paymentId}`, 'GET', headers);
  if (!payRes.ok) return { notFound: true };
  return { payment: payRes.json };
}

function summarize(payment) {
  const fees = (payment.fee_details || []).reduce((acc, f) => acc + (f.amount || 0), 0);
  const gross = payment.transaction_amount || 0;
  const net = payment.transaction_details?.net_received_amount ?? (gross - fees);
  const refundedAmount = payment.transaction_amount_refunded || 0;
  const refunded = payment.status === 'refunded' || payment.status === 'charged_back' || (gross > 0 && refundedAmount >= gross);
  const releaseDate = payment.money_release_date || null;
  const released = payment.money_release_status === 'released' || (!!releaseDate && new Date(releaseDate).getTime() <= Date.now());

  return {
    paymentId: String(payment.id),
    mpStatus: payment.status,
    statusDetail: payment.status_detail || null,
    gross,
    fee: fees,
    net,
    refunded,
    refundedAmount,
    releaseDate,
    released,
    approvedAt: payment.date_approved || null,
    method: payment.payment_type_id || null
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { idToken, ids } = req.body || {};
    if (!idToken || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'idToken e ids são obrigatórios.' });
    }
    if (ids.length > MAX_IDS) {
      return res.status(400).json({ success: false, message: `Máximo de ${MAX_IDS} IDs por chamada.` });
    }

    if (!(await assertOwner(idToken))) {
      return res.status(403).json({ success: false, message: 'Acesso restrito ao proprietário.' });
    }

    const token = await getMercadoPagoToken();
    if (!token) {
      return res.status(500).json({ success: false, message: 'Token do Mercado Pago não configurado.' });
    }
    const headers = { Authorization: `Bearer ${token}` };

    const results = {};
    await Promise.all(ids.map(async (rawId) => {
      const id = String(rawId);
      try {
        const found = await fetchPayment(id, headers);
        results[id] = found.notFound ? { notFound: true } : summarize(found.payment);
      } catch (err) {
        results[id] = { error: true };
      }
    }));

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('[Wallet Verify] Erro:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao conferir pagamentos.' });
  }
}
