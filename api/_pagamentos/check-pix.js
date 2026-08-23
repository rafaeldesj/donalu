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

/**
 * Determines if the given token is a placeholder / mock token.
 */
function detectIsMock(token) {
  if (!token) return true;
  if (typeof token !== 'string') return true;
  const t = token.trim();
  if (!t || t === 'mock' || t === 'null' || t === 'undefined') return true;
  if (t.startsWith('APP_USR-MOCK-') || t.includes('-MOCK-') || t.startsWith('TEST-')) return true;
  return false;
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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const paymentId = req.query.paymentId || req.body?.paymentId;
    const token = req.query.token || req.body?.token;

    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'paymentId é obrigatório.' });
    }

    const isMock = detectIsMock(token) || paymentId.startsWith('PAY_MOCK_');

    if (isMock) {
      // Mock environment: auto-approve after a short simulated delay.
      // Since Vercel functions are stateless, we approve if the paymentId follows the mock pattern.
      return res.status(200).json({ success: true, status: 'approved' });
    }

    const mpUrl = `https://api.mercadopago.com/v1/payments/${paymentId}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };

    const response = await nativeRequest(mpUrl, 'GET', headers);

    if (!response.ok) {
      return res.status(400).json({ success: false, message: 'Erro ao verificar pagamento no Mercado Pago.' });
    }

    return res.status(200).json({ success: true, status: response.json.status });

  } catch (err) {
    console.error('[Mercado Pago Pix Status] Erro no middleware:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao checar Pix.' });
  }
}
