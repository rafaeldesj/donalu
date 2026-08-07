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

if (!global.mockPointIntents) {
  global.mockPointIntents = {};
}
if (!global.activePointIntents) {
  global.activePointIntents = {};
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
    const { token, deviceId, posId, amount, paymentType, externalReference } = req.body || {};

    const devIdStr = deviceId ? String(deviceId) : '';
    // terminal_id para a Orders API é o ID do dispositivo (ex: NEWLAND_N950__N950NCC603892853)
    const terminalId = devIdStr;
    const isMock = !token || token === 'mock' || token === '' || token === 'null' || token === 'undefined' || devIdStr.includes('MOCK') || devIdStr === 'mock';

    // Cancelar a ordem anterior se existir na memória global para este terminal
    const previousIntentId = global.activePointIntents[devIdStr];
    if (previousIntentId && !isMock) {
      console.log(`[Mercado Pago Point] Cancelando ordem anterior ${previousIntentId} para o dispositivo ${devIdStr}...`);
      try {
        const cancelUrl = `https://api.mercadopago.com/v1/orders/${previousIntentId}/cancel`;
        await nativeRequest(cancelUrl, 'POST', {
          'Authorization': `Bearer ${token}`,
          'X-Idempotency-Key': `cancel_${previousIntentId}_${Date.now()}`,
          'x-allow-cancelable-status': 'at_terminal'
        });
        delete global.activePointIntents[devIdStr];
      } catch (cancelErr) {
        console.error(`[Mercado Pago Point] Erro ao tentar cancelar ordem anterior:`, cancelErr);
      }
    }

    if (isMock) {
      console.log(`[Mercado Pago Point] Rodando em modo MOCK. Dispositivo: ${devIdStr}`);
      const mockIntentId = 'INTENT_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
      
      global.mockPointIntents[mockIntentId] = {
        status: 'OPEN',
        createdAt: Date.now(),
        amount: parseFloat(amount),
        deviceId: devIdStr
      };

      // Simular aprovação automática após 10 segundos
      setTimeout(() => {
        if (global.mockPointIntents[mockIntentId]) {
          global.mockPointIntents[mockIntentId].status = 'FINISHED';
          global.mockPointIntents[mockIntentId].approvedAt = Date.now();
          console.log(`[Mercado Pago Point Mock] Pagamento ${mockIntentId} APROVADO via simulação.`);
        }
      }, 10000);

      return res.status(200).json({
        success: true,
        intentId: mockIntentId,
        status: 'OPEN',
        isMock: true
      });
    }

    const numericAmount = parseFloat(amount);
    if (numericAmount < 1.00) {
      return res.status(400).json({ success: false, message: 'O valor mínimo para pagamento na maquininha é de R$ 1,00.' });
    }

    // Nova Orders API — suporta TODOS os meios: crédito, débito e Pix na maquininha
    // O terminal em modo PDV "puxa" a ordem e apresenta as opções ao cliente na tela
    const mpUrl = `https://api.mercadopago.com/v1/orders`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `create_${devIdStr}_${Date.now()}`
    };

    const payload = {
      type: 'point',
      external_reference: externalReference || 'PED_' + Date.now(),
      description: 'Pedido Dona Lu Pastelaria',
      transactions: {
        payments: [
          {
            amount: numericAmount.toFixed(2)
          }
        ]
      },
      config: {
        point: {
          terminal_id: terminalId,
          print_on_terminal: 'no_ticket'
        }
      }
    };

    console.log('[Mercado Pago Point Orders API] URL:', mpUrl);
    console.log('[Mercado Pago Point Orders API] terminal_id:', terminalId, '| deviceId:', devIdStr);
    console.log('[Mercado Pago Point Orders API] Payload:', JSON.stringify(payload, null, 2));

    const response = await nativeRequest(mpUrl, 'POST', headers, payload);

    console.log('[Mercado Pago Point Orders API] Resposta Status:', response.status);
    console.log('[Mercado Pago Point Orders API] Resposta JSON:', JSON.stringify(response.json, null, 2));

    if (!response.ok) {
      console.error('[Mercado Pago Point] Erro ao criar ordem:', response.json);
      const errMsg = (response.json?.errors || []).map(e => e.message).join(', ') || response.json?.message || 'Verifique se o ID do terminal está correto e em modo PDV.';
      return res.status(500).json({
        success: false,
        message: 'Erro ao enviar pagamento para a maquininha: ' + errMsg
      });
    }

    const r = response.json;
    if (r.id) {
      global.activePointIntents[devIdStr] = r.id;
    }
    
    return res.status(200).json({
      success: true,
      intentId: r.id,
      status: r.status || 'open',
      isMock: false
    });

  } catch (err) {
    console.error('[Mercado Pago Point] Erro no endpoint create-point-order:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao acionar maquininha.' });
  }
}
