import https from 'https';

function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null;
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {})
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: responseBody });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
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
    const { token, deviceId, intentId } = req.body || {};

    const devIdStr = deviceId ? String(deviceId) : '';
    const isMock = !token || token === 'mock' || !intentId || intentId.startsWith('INTENT_MOCK_');

    if (isMock) {
      console.log(`[Mercado Pago Point] Cancelando intent MOCK: ${intentId}`);
      if (global.mockPointIntents && global.mockPointIntents[intentId]) {
        global.mockPointIntents[intentId].status = 'CANCELED';
      }
      return res.status(200).json({ success: true, message: 'Pagamento simulado cancelado.' });
    }

    // Nova v1/orders API (Point Devices)
    const mpUrl = `https://api.mercadopago.com/v1/orders/${intentId}/cancel`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Idempotency-Key': `cancel_${intentId}_${Date.now()}`,
      'x-allow-cancelable-status': 'at_terminal'
    };

    console.log(`[Mercado Pago Point] Cancelando ordem real ${intentId} para o dispositivo ${devIdStr} (v1/orders API)...`);
    const response = await nativeRequest(mpUrl, 'POST', headers);
    console.log(`[Mercado Pago Point] Resposta cancelamento status: ${response.status}`);

    if (response.status === 200 || response.ok) {
      if (global.activePointIntents && global.activePointIntents[devIdStr] === intentId) {
        delete global.activePointIntents[devIdStr];
      }
      
      // Workaround: A Orders API às vezes demora para limpar a tela da máquina no cancelamento.
      // Forçamos a limpeza alterando o modo de operação para STANDALONE e depois de volta para PDV.
      try {
        console.log(`[Mercado Pago Point] Limpando tela da maquininha ${devIdStr} (Toggle Mode)...`);
        const clearUrl = `https://api.mercadopago.com/point/integration-api/devices/${devIdStr}`;
        // 1. Muda pra Standalone
        await nativeRequest(clearUrl, 'PATCH', {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }, { operating_mode: 'STANDALONE' });
        
        // 2. Volta pra PDV
        await nativeRequest(clearUrl, 'PATCH', {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }, { operating_mode: 'PDV' });
      } catch (clearErr) {
        console.error('[Mercado Pago Point] Erro silencioso ao limpar tela da maquininha:', clearErr);
      }

      return res.status(200).json({ success: true, message: 'Pagamento cancelado com sucesso.' });
    }

    return res.status(400).json({ success: false, message: response.json?.message || 'Erro ao cancelar pagamento na maquininha.' });

  } catch (err) {
    console.error('[Mercado Pago Point] Erro no endpoint cancel-point-order:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao cancelar pagamento.' });
  }
}
