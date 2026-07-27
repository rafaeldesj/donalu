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

    // Consulta real à Orders API do Mercado Pago
    // Endpoint: GET https://api.mercadopago.com/v1/orders/{order_id}
    const mpUrl = `https://api.mercadopago.com/v1/orders/${intentId}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };

    const response = await nativeRequest(mpUrl, 'GET', headers);

    if (!response.ok) {
      console.error('[Mercado Pago Point] Erro ao consultar ordem:', response.json);
      
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
    
    // Mapeamento de status da Orders API para o formato esperado pelo frontend
    let finalStatus = 'OPEN';
    if (r.status === 'processed' || r.status === 'paid') {
      finalStatus = 'FINISHED';
    } else if (r.status === 'canceled' || r.status === 'expired') {
      finalStatus = 'CANCELED';
    } else if (r.status === 'created' || r.status === 'action_required') {
      finalStatus = 'OPEN';
    } else {
      finalStatus = 'ERROR';
    }

    return res.status(200).json({
      success: true,
      status: finalStatus,
      isMock: false
    });

  } catch (err) {
    console.error('[Mercado Pago Point] Erro no endpoint check-point-order:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao consultar maquininha.' });
  }
}
