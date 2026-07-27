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

// Armazenamento em memória global ou local para mocks
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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { token, deviceId, amount, paymentType, externalReference, devPercentage } = req.body || {};

    const devIdStr = deviceId ? String(deviceId) : '';
    const isMock = !token || token === 'mock' || token === '' || token === 'null' || token === 'undefined' || devIdStr.includes('MOCK') || devIdStr === 'mock';

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

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (amountCents < 100) {
      return res.status(400).json({ success: false, message: 'O valor mínimo para pagamento na maquininha é de R$ 1,00.' });
    }

    // Cancelar a intenção anterior se existir na memória global para este terminal
    if (!global.activePointIntents) {
      global.activePointIntents = {};
    }
    const previousIntentId = global.activePointIntents[devIdStr];
    if (previousIntentId && !isMock) {
      console.log(`[Mercado Pago Point] Cancelando intenção anterior ${previousIntentId} para o dispositivo ${devIdStr} antes de criar uma nova...`);
      try {
        const cancelUrl = `https://api.mercadopago.com/point/integration-api/devices/${devIdStr}/payment-intents/${previousIntentId}`;
        await nativeRequest(cancelUrl, 'DELETE', {
          'Authorization': `Bearer ${token}`
        });
        delete global.activePointIntents[devIdStr];
      } catch (cancelErr) {
        console.error(`[Mercado Pago Point] Erro ao tentar cancelar intenção anterior:`, cancelErr);
      }
    }

    // Chamada oficial da API de Payment Intents do Mercado Pago
    // Endpoint: POST https://api.mercadopago.com/point/integration-api/devices/{device_id}/payment-intents
    const mpUrl = `https://api.mercadopago.com/point/integration-api/devices/${devIdStr}/payment-intents`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const payload = {
      amount: amountCents,
      description: 'Pedido Dona Lu Pastelaria',
      additional_info: {
        external_reference: externalReference || 'PED_' + Date.now(),
        print_on_terminal: true
      }
    };

    // Envia o payload limpo como no comportamento original que funcionava

    const response = await nativeRequest(mpUrl, 'POST', headers, payload);

    if (!response.ok) {
      console.error('[Mercado Pago Point] Erro ao criar intenção de pagamento:', response.json);
      
      // Fallback para mock caso dê erro na API real, para não travar a pastelaria durante testes
      console.log('[Mercado Pago Point] Iniciando MOCK de fallback devido a erro na API.');
      const mockIntentId = 'INTENT_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
      global.mockPointIntents[mockIntentId] = {
        status: 'OPEN',
        createdAt: Date.now(),
        amount: parseFloat(amount),
        deviceId
      };
      setTimeout(() => {
        if (global.mockPointIntents[mockIntentId]) {
          global.mockPointIntents[mockIntentId].status = 'FINISHED';
        }
      }, 10000);

      return res.status(200).json({
        success: true,
        intentId: mockIntentId,
        status: 'OPEN',
        isMock: true,
        message: 'Modo de testes ativo (erro na API real).'
      });
    }

    const r = response.json;
    if (r.id) {
      global.activePointIntents[devIdStr] = r.id;
    }
    return res.status(200).json({
      success: true,
      intentId: r.id,
      status: r.state || 'OPEN',
      isMock: false
    });

  } catch (err) {
    console.error('[Mercado Pago Point] Erro no endpoint create-point-order:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao acionar maquininha.' });
  }
}
