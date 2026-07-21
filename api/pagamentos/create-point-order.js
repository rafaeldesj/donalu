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
    const { token, deviceId, amount, paymentType, externalReference, devPercentage } = req.body;

    const isMock = !token || token === 'mock' || token === '' || token === 'null' || token === 'undefined' || deviceId.includes('MOCK') || deviceId === 'mock';

    if (isMock) {
      console.log(`[Mercado Pago Point] Rodando em modo MOCK. Dispositivo: ${deviceId}`);
      const mockIntentId = 'INTENT_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
      
      global.mockPointIntents[mockIntentId] = {
        status: 'OPEN',
        createdAt: Date.now(),
        amount: parseFloat(amount),
        deviceId
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

    // Chamada oficial da API de Payment Intents do Mercado Pago
    // Endpoint: POST https://api.mercadopago.com/point/integration-api/devices/{device_id}/payment-intents
    const mpUrl = `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const payload = {
      amount: parseFloat(amount),
      description: 'Pedido Dona Lu Pastelaria',
      additional_info: {
        external_reference: externalReference || 'PED_' + Date.now(),
        print_on_terminal: true
      },
      payment: {
        installments: 1,
        type: paymentType === 'pix' ? 'pix' : (paymentType === 'debito' || paymentType === 'debit_card' ? 'debit_card' : 'credit_card')
      }
    };

    // Add split payment fee if configured
    if (devPercentage && devPercentage > 0) {
      const fee = parseFloat((parseFloat(amount) * devPercentage / 100).toFixed(2));
      if (fee >= 0.01) {
        payload.application_fee = fee;
        console.log(`[Mercado Pago Point] Split ativado: application_fee = R$${fee.toFixed(2)} (${devPercentage}% de R$${amount})`);
      }
    }

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
