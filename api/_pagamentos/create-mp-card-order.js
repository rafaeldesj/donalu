import https from 'https';

function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = data ? JSON.stringify(data) : '';
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        ...headers,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
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

function detectIsMock(token) {
  if (!token) return true;
  const t = String(token).trim();
  if (!t || t === 'mock' || t === 'null' || t === 'undefined') return true;
  if (t.startsWith('APP_USR-MOCK-') || t.includes('-MOCK-') || t.startsWith('TEST-')) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const {
      token: bodyToken, cardToken, amount, email, name, cpf,
      installments, deviceSessionId, items, devPercentage
    } = req.body;

    const token = (bodyToken && bodyToken !== 'mock' && bodyToken !== 'null' && bodyToken !== 'undefined') ? bodyToken : process.env.MP_ACCESS_TOKEN;
    const isMock = detectIsMock(token);
    if (isMock) {
      return res.status(200).json({
        success: true,
        orderId: 'MOCK_ORD_' + Math.random().toString(36).substring(2, 11).toUpperCase(),
        status: 'processed',
        isMock: true
      });
    }

    if (!cardToken) {
      return res.status(400).json({ success: false, message: 'Token do cartao nao fornecido.' });
    }

    const totalAmount = parseFloat(amount).toFixed(2);
    const firstName = (name || 'Cliente').split(' ')[0];
    const lastName = (name || 'Cliente').split(' ').slice(1).join(' ') || 'Dona Lu';

    const paymentPayload = {
      transaction_amount: parseFloat(totalAmount),
      token: cardToken,
      description: 'Pedido Dona Lu Pastelaria',
      installments: parseInt(installments || 1),
      payer: {
        email: email || 'cliente@email.com',
        first_name: firstName,
        last_name: lastName,
        identification: {
          type: 'CPF',
          number: (cpf || '').replace(/\D/g, '') || '80288053702'
        }
      }
    };

    if (devPercentage && devPercentage > 0) {
      const fee = parseFloat((parseFloat(totalAmount) * devPercentage / 100).toFixed(2));
      if (fee >= 0.01) {
        paymentPayload.application_fee = fee;
        if (process.env.VITE_MP_SPONSOR_ID) {
          paymentPayload.sponsor_id = Number(process.env.VITE_MP_SPONSOR_ID);
        }
      }
    }

    const mpHeaders = {
      'Authorization': `Bearer ${token.trim()}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'DONALU_CARD_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      'x-integrator-id': 'dev_392b160994e811f1b905e222616df356'
    };

    if (deviceSessionId) {
      mpHeaders['X-Melidata-Session-Id'] = deviceSessionId;
    }

    const orderRes = await nativeRequest('https://api.mercadopago.com/v1/payments', 'POST', mpHeaders, paymentPayload);

    if (!orderRes.ok) {
      console.error('[MP Card Order] Erro:', orderRes.json || orderRes.text);
      const errMsg = orderRes.json?.errors?.[0]?.message || orderRes.json?.message || 'Erro ao processar pagamento.';
      return res.status(400).json({ success: false, message: errMsg, details: orderRes.json });
    }

    const order = orderRes.json;
    const paymentStatus = order.transactions?.payments?.[0]?.status || order.status;

    return res.status(200).json({
      success: true,
      orderId: order.id,
      status: paymentStatus,
      approved: paymentStatus === 'processed' || paymentStatus === 'approved'
    });

  } catch (err) {
    console.error('[MP Card Order] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar pagamento.' });
  }
}
