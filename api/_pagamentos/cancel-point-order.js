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
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: responseBody });
        }
      });
    });
    req.on('error', (err) => { reject(err); });
    if (body) { req.write(body); }
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { token, deviceId, intentId } = req.body || {};
    const devIdStr = deviceId ? String(deviceId) : '';
    const isMock = !token || token === 'mock' || !intentId || intentId.startsWith('INTENT_MOCK_');

    if (isMock) {
      console.log(`[Point Cancel] Cancelando MOCK: ${intentId}`);
      if (global.mockPointIntents && global.mockPointIntents[intentId]) {
        global.mockPointIntents[intentId].status = 'CANCELED';
      }
      return res.status(200).json({ success: true, message: 'Pagamento simulado cancelado.' });
    }

    // Step 1: Cancel order via v1/orders API
    let cancelOk = false;
    try {
      const cancelUrl = `https://api.mercadopago.com/v1/orders/${intentId}/cancel`;
      console.log(`[Point Cancel] Cancelando ${intentId} via v1/orders...`);
      const r = await nativeRequest(cancelUrl, 'POST', {
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': `cancel_${intentId}_${Date.now()}`,
        'x-allow-cancelable-status': 'at_terminal'
      });
      console.log(`[Point Cancel] v1/orders status=${r.status} body=${JSON.stringify(r.json || r.text)}`);
      cancelOk = r.status === 200 || r.ok;
    } catch (e) {
      console.error('[Point Cancel] Erro cancel:', e.message);
    }

    if (global.activePointIntents && global.activePointIntents[devIdStr] === intentId) {
      delete global.activePointIntents[devIdStr];
    }

    // Step 2: Force terminal screen clear via mode toggle STANDALONE -> PDV
    if (devIdStr) {
      try {
        const deviceUrl = `https://api.mercadopago.com/point/integration-api/devices/${devIdStr}`;
        console.log(`[Point Cancel] Toggle STANDALONE em ${devIdStr}...`);
        const r1 = await nativeRequest(deviceUrl, 'PATCH', {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }, { operating_mode: 'STANDALONE' });
        console.log(`[Point Cancel] STANDALONE: ${r1.status} ${JSON.stringify(r1.json || r1.text)}`);

        await new Promise(resolve => setTimeout(resolve, 800));

        console.log(`[Point Cancel] Toggle PDV em ${devIdStr}...`);
        const r2 = await nativeRequest(deviceUrl, 'PATCH', {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }, { operating_mode: 'PDV' });
        console.log(`[Point Cancel] PDV: ${r2.status} ${JSON.stringify(r2.json || r2.text)}`);
      } catch (clearErr) {
        console.error('[Point Cancel] Erro toggle:', clearErr.message);
      }
    }

    return res.status(200).json({ success: true, canceledOnServer: cancelOk, message: 'Pagamento cancelado.' });
  } catch (err) {
    console.error('[Point Cancel] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao cancelar pagamento.' });
  }
}
