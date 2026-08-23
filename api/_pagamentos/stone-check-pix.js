import https from 'https';

function nativeRequest(url, method, headers) {
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

    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { paymentId, token } = req.query;

    if (!paymentId || !token) {
      return res.status(400).json({ success: false, message: 'Parâmetros inválidos.' });
    }

    if (paymentId.startsWith('STONE_PIX_MOCK_')) {
      return res.status(200).json({ success: true, status: 'pending' }); // Mock never automatically pays in this flow, you can simulate otherwise
    }

    const stoneUrl = \https://api.pagar.me/core/v5/orders/\\;
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    };

    const response = await nativeRequest(stoneUrl, 'GET', headers);

    if (!response.ok) {
      return res.status(400).json({ success: false, message: 'Erro ao verificar pagamento na Stone.' });
    }

    const order = response.json;
    
    // Status in pagar.me can be paid, pending, canceled, failed
    let mappedStatus = 'pending';
    if (order.status === 'paid') {
      mappedStatus = 'approved';
    } else if (order.status === 'failed' || order.status === 'canceled') {
      mappedStatus = 'rejected';
    }

    return res.status(200).json({
      success: true,
      status: mappedStatus
    });

  } catch (err) {
    console.error('[Stone Check Pix] Erro:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao verificar Pix na Stone.' });
  }
}

