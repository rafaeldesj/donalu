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

function detectIsMock(token) {
  if (!token) return true;
  if (typeof token !== 'string') return true;
  const t = token.trim();
  if (!t || t === 'mock' || t === 'null' || t === 'undefined') return true;
  if (t.includes('-MOCK-') || t.startsWith('TEST-')) return true;
  return false;
}

export default async function handler(req, res) {
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
    const { paymentId, token } = req.body;
    
    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'ID do pagamento não fornecido.' });
    }

    const isMock = detectIsMock(token);

    if (isMock || paymentId.includes('MOCK')) {
      console.log('[Stone Refund] Rodando em modo MOCK para o pedido:', paymentId);
      // Simular um atraso leve
      await new Promise(r => setTimeout(r, 800));
      return res.status(200).json({
        success: true,
        message: 'Estorno mockado efetuado com sucesso.',
        status: 'canceled',
        isMock: true
      });
    }

    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    };

    // 1. Fetch the order to get the charge_id
    const orderUrl = `https://api.pagar.me/core/v5/orders/${paymentId}`;
    const orderResponse = await nativeRequest(orderUrl, 'GET', headers, null);
    
    if (!orderResponse.ok) {
      console.error('[Stone Refund] Erro ao buscar pedido:', JSON.stringify(orderResponse.json || orderResponse.text, null, 2));
      return res.status(400).json({ success: false, message: 'Erro ao buscar pedido na Stone.' });
    }

    const orderData = orderResponse.json;
    if (!orderData.charges || orderData.charges.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma cobrança encontrada para este pedido na Stone.' });
    }

    const chargeId = orderData.charges[0].id;
    
    // 2. Cancel the charge (Refund)
    const stoneCancelUrl = `https://api.pagar.me/core/v5/charges/${chargeId}`;
    const response = await nativeRequest(stoneCancelUrl, 'DELETE', headers, null);

    if (!response.ok) {
      console.error('[Stone Refund] Erro ao estornar cobrança:', JSON.stringify(response.json || response.text, null, 2));
      return res.status(400).json({ success: false, message: response.json?.message || 'Erro ao processar estorno na Stone.' });
    }

    const r = response.json;

    return res.status(200).json({
      success: true,
      message: 'Pagamento estornado com sucesso na Stone.',
      status: r.status // typically 'canceled'
    });

  } catch (err) {
    console.error('[Stone Refund] Erro no middleware:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar estorno na Stone.' });
  }
}
