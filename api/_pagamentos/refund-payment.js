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
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr), 'Content-Type': 'application/json' } : {})
      }
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

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { paymentId, token, devToken } = req.body || {};

    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'paymentId é obrigatório.' });
    }

    const isMock = detectIsMock(token) || String(paymentId).startsWith('PAY_MOCK_');

    if (isMock) {
      return res.status(200).json({ success: true, message: 'Pagamento estornado com sucesso (MOCK).' });
    }

    const mpUrl = `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`;
    
    const headers = {
      'Authorization': `Bearer ${token.trim()}`,
      'X-Idempotency-Key': 'DONALU_REFUND_' + paymentId + '_' + Date.now()
    };

    let response = await nativeRequest(mpUrl, 'POST', headers, null);

    if (!response.ok) {
      console.error('[Refund Error] Response:', response.json || response.text);
      let originalMsg = response.json?.message || response.text || 'Erro desconhecido';
      let errMsg = `Erro ao processar estorno: ${originalMsg}`;
      if (response.status === 401 || response.status === 403 || errMsg.includes('UNAUTHORIZED')) {
        errMsg = `Não autorizado (Split/Permissão). Erro do MP: ${originalMsg}. Verifique os Tokens.`;
        return res.status(400).json({ success: false, message: errMsg, requiresManualRefund: true });
      }
      return res.status(400).json({ success: false, message: errMsg });
    }

    return res.status(200).json({ success: true, message: 'Pagamento estornado com sucesso!' });

  } catch (err) {
    console.error('[Mercado Pago Refund] Erro no handler:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar estorno.' });
  }
}
