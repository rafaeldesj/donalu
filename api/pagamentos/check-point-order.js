import https from 'https';

function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

if (!global.mockPointIntents) {
  global.mockPointIntents = {};
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { intentId, token } = req.query;

    if (!intentId) {
      return res.status(400).json({ success: false, message: 'Falta o parâmetro intentId.' });
    }

    const isMock = intentId.startsWith('INTENT_MOCK_') || !token || token === 'mock' || token === 'null' || token === 'undefined';

    if (isMock) {
      const mockIntent = global.mockPointIntents[intentId];
      if (!mockIntent) {
        return res.status(200).json({
          success: true,
          status: 'CANCELED',
          message: 'Transação mockada não encontrada. Assumindo cancelada.'
        });
      }

      return res.status(200).json({
        success: true,
        status: mockIntent.status, // OPEN, FINISHED, CANCELED
        isMock: true
      });
    }

    // Consulta real à API de Payment Intents do Mercado Pago
    // Endpoint: GET https://api.mercadopago.com/point/integration-api/payment-intents/{payment_intent_id}
    const mpUrl = `https://api.mercadopago.com/point/integration-api/payment-intents/${intentId}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };

    const response = await nativeRequest(mpUrl, 'GET', headers);

    if (!response.ok) {
      console.error('[Mercado Pago Point] Erro ao consultar intenção:', response.json);
      
      // Fallback para mock caso dê erro na API real durante a consulta (ex: o ID era mock de fallback)
      const mockIntent = global.mockPointIntents[intentId];
      if (mockIntent) {
        return res.status(200).json({
          success: true,
          status: mockIntent.status,
          isMock: true
        });
      }

      return res.status(400).json({ success: false, message: 'Erro ao consultar status da maquininha no Mercado Pago.' });
    }

    const r = response.json;
    // Os estados retornados pelo Mercado Pago Point são: 'OPEN', 'FINISHED', 'CANCELED', 'ERROR', etc.
    return res.status(200).json({
      success: true,
      status: r.state || 'OPEN',
      isMock: false
    });

  } catch (err) {
    console.error('[Mercado Pago Point] Erro no endpoint check-point-order:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao consultar maquininha.' });
  }
}
