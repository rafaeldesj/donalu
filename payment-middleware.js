import https from 'https';
import fs from 'fs';
import path from 'path';

// Função utilitária para gravar logs de depuração do Point no arquivo point-debug.log
function logToFile(message) {
  try {
    const logPath = path.join(process.cwd(), 'point-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (err) {
    console.error('Erro ao escrever no arquivo de log do Point:', err);
  }
}

// Função auxiliar para fazer requisições HTTP usando o módulo nativo 'https' para máxima compatibilidade no Node.js
// Aceita `data` como objeto (serializa em JSON) ou string (envia como-está, para form-encoded).
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


export const processPaymentMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const {
        encryptedCard,
        cpf,
        saveCard,
        orderTotal,
        clientName,
        clientEmail,
        useSavedCard,
        savedCustomerId,
        savedCardToken
      } = data;
      
      const pagbankToken = process.env.PAGBANK_TOKEN;
      const isMock = !pagbankToken || pagbankToken === 'mock';
      const amountCents = Math.round(orderTotal * 100);
      
      if (isMock) {
        console.warn('[PagBank Middleware] Rodando em modo MOCK. Nenhuma chamada externa à API foi feita.');
        // Simula latência de rede
        await new Promise(resolve => setTimeout(resolve, 1200));
        
        // Simulação de erro caso passe um cartão específico de teste
        if (encryptedCard === 'fail' || encryptedCard === 'invalid_card') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            message: 'Cartão recusado pelo emissor. Verifique os dados e tente novamente.'
          }));
        }
        
        const responseData = {
          success: true,
          chargeId: 'CHAR_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase()
        };
        
        if (!useSavedCard && saveCard) {
          responseData.card = {
            customer_id: savedCustomerId || 'CUST_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase(),
            card_token: 'CARD_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase(),
            brand: 'visa',
            last_digits: '4111'
          };
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(responseData));
      }
      
      // INTEGRAÇÃO REAL COM A API DO PAGBANK (SANDBOX / PRODUÇÃO)
      const headers = {
        'Authorization': `Bearer ${pagbankToken}`,
        'Content-Type': 'application/json'
      };
      
      const baseUrl = 'https://sandbox.api.pagseguro.com'; // Altere para 'https://api.pagseguro.com' se em Produção
      
      // 1. Processar Cobrança (POST /charges)
      const chargePayload = {
        reference_id: 'ORDER_' + Date.now(),
        description: 'Pedido Dona Lu Pastelaria',
        amount: {
          value: amountCents,
          currency: 'BRL'
        },
        payment_method: {
          type: 'CREDIT_CARD',
          installments: 1,
          capture: true,
          card: useSavedCard ? { id: savedCardToken } : { encrypted: encryptedCard }
        }
      };
      
      const chargeRes = await nativeRequest(`${baseUrl}/charges`, 'POST', headers, chargePayload);
      
      if (!chargeRes.ok || (chargeRes.json.status !== 'AUTHORIZED' && chargeRes.json.status !== 'PAID')) {
        const errMsg = chargeRes.json?.error_messages?.[0]?.description || 'Pagamento recusado pelo emissor do cartão.';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: errMsg }));
      }
      
      const responseData = {
        success: true,
        chargeId: chargeRes.json.id
      };
      
      // 2. Criar Cliente e Registrar Cartão no Cofre (se solicitado e não for uso de cartão salvo)
      if (!useSavedCard && saveCard) {
        let customerId = savedCustomerId;
        
        // Criar cliente se não possuir ID PagBank
        if (!customerId) {
          const customerPayload = {
            name: clientName,
            email: clientEmail,
            tax_id: cpf.replace(/\D/g, '')
          };
          
          const customerRes = await nativeRequest(`${baseUrl}/v1/customers`, 'POST', headers, customerPayload);
          if (customerRes.ok && customerRes.json.id) {
            customerId = customerRes.json.id;
          }
        }
        
        // Salvar cartão no cofre do cliente
        if (customerId) {
          const cardPayload = {
            encrypted: encryptedCard
          };
          
          const cardRes = await nativeRequest(`${baseUrl}/v1/customers/${customerId}/cards`, 'POST', headers, cardPayload);
          
          if (cardRes.ok && cardRes.json.id) {
            responseData.card = {
              customer_id: customerId,
              card_token: cardRes.json.id,
              brand: cardRes.json.brand || 'visa',
              last_digits: cardRes.json.last_digits || '9999'
            };
          }
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(responseData));
      
    } catch (error) {
      console.error('[PagBank Middleware] Erro no processamento de pagamento:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno do servidor ao processar o pagamento.' }));
    }
  });
};

// Detects placeholder/mock tokens including the APP_USR-MOCK- pattern from the old simulated OAuth flow
function detectIsMock(token) {
  if (!token) return true;
  if (typeof token !== 'string') return true;
  const t = token.trim();
  if (!t || t === 'mock' || t === 'null' || t === 'undefined') return true;
  if (t.startsWith('APP_USR-MOCK-') || t.includes('-MOCK-') || t.startsWith('TEST-')) return true;
  return false;
}

export const createPixMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { token, amount, email, name, cpf, devPercentage, orderId, paymentVerificationToken } = data;
      
      const isMock = detectIsMock(token);
      
      if (isMock) {
        console.log('[Mercado Pago Pix] Rodando em modo MOCK (token ausente ou fictício).');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const mockPaymentId = 'PAY_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
        
        if (!global.mockPayments) {
          global.mockPayments = {};
        }
        global.mockPayments[mockPaymentId] = {
          status: 'pending',
          createdAt: Date.now()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          paymentId: mockPaymentId,
          qrCode: '00020101021226870014br.gov.bcb.pix2565qr-mock-code-dona-lu-pastelaria-1234567890',
          qrCodeBase64: '',
          status: 'pending',
          isMock: true
        }));
      }
      
      // Chamada real ao Mercado Pago
      const mpUrl = 'https://api.mercadopago.com/v1/payments';
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'PIX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
      };
      
      const firstName = name.split(' ')[0] || 'Cliente';
      const lastName = name.split(' ').slice(1).join(' ') || 'Dona Lu';
      const transactionAmount = parseFloat(amount);

      // Constrói a URL do webhook dinamicamente com base no host do request
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || '';
      const notificationUrl = `${protocol}://${host}/api/pagamentos/webhook`;
      
      const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1') || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.');
      
      const cleanCpf = (cpf || '').replace(/\D/g, '');
      
      const payload = {
        transaction_amount: transactionAmount,
        description: 'Pedido Dona Lu Pastelaria',
        payment_method_id: 'pix',
        external_reference: orderId || undefined,
        notification_url: isLocalHost ? undefined : notificationUrl,
        metadata: {
          payment_verification_token: paymentVerificationToken || undefined
        },
        payer: {
          email: email || 'cliente@email.com',
          first_name: firstName,
          last_name: lastName,
          ...(cleanCpf ? {
            identification: {
              type: 'CPF',
              number: cleanCpf
            }
          } : {})
        }
      };

      // Split: add application_fee when devPercentage is configured
      if (devPercentage && devPercentage > 0) {
        const fee = parseFloat((transactionAmount * devPercentage / 100).toFixed(2));
        if (fee >= 0.01) {
          payload.application_fee = fee;
          console.log(`[Mercado Pago Pix] Split: application_fee = R$${fee.toFixed(2)} (${devPercentage}%)`);
        }
      }
      
      const response = await nativeRequest(mpUrl, 'POST', headers, payload);
      
      if (!response.ok) {
        console.error('[Mercado Pago Pix] Erro ao criar pagamento:', response.json);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: response.json?.message || 'Erro ao gerar Pix no Mercado Pago.' }));
      }
      
      const r = response.json;
      const qrCode = r.point_of_interaction?.transaction_data?.qr_code || '';
      const qrCodeBase64 = r.point_of_interaction?.transaction_data?.qr_code_base64 || '';
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        paymentId: r.id.toString(),
        qrCode,
        qrCodeBase64,
        status: r.status
      }));
      
    } catch (err) {
      console.error('[Mercado Pago Pix] Erro no middleware:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno ao criar Pix.' }));
    }
  });
};

export const checkPixMiddleware = async (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const paymentId = urlObj.searchParams.get('paymentId');
    const token = urlObj.searchParams.get('token');
    
    if (!paymentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'paymentId é obrigatório.' }));
    }
    
    const isMock = detectIsMock(token) || paymentId.startsWith('PAY_MOCK_');
    
    if (isMock) {
      const mockPay = global.mockPayments?.[paymentId];
      if (mockPay) {
        if (Date.now() - mockPay.createdAt > 5000) {
          mockPay.status = 'approved';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, status: mockPay.status }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, status: 'approved' }));
    }
    
    // Chamada real ao Mercado Pago
    const mpUrl = `https://api.mercadopago.com/v1/payments/${paymentId}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    
    const response = await nativeRequest(mpUrl, 'GET', headers);
    
    if (!response.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro ao verificar pagamento no Mercado Pago.' }));
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, status: response.json.status }));
    
  } catch (err) {
    console.error('[Mercado Pago Pix Status] Erro no middleware:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: 'Erro interno ao checar Pix.' }));
  }
};

// Middlewares adicionados para Maquininha Point
if (!global.mockPointIntents) {
  global.mockPointIntents = {};
}
if (!global.activePointIntents) {
  global.activePointIntents = {};
}

export const createPointOrderMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { token, deviceId, amount, paymentType, externalReference } = data || {};
      
      const devIdStr = deviceId ? String(deviceId) : '';
      const isMock = !token || token === 'mock' || token === '' || token === 'null' || token === 'undefined' || devIdStr.includes('MOCK') || devIdStr === 'mock';
      
      // Cancelar a ordem anterior se existir na memória global para este terminal (Orders API)
      const previousIntentId = global.activePointIntents[devIdStr];
      if (previousIntentId && !isMock) {
        console.log(`[Mercado Pago Point] Cancelando ordem anterior ${previousIntentId} para o dispositivo ${devIdStr} antes de criar uma nova... (Orders API)`);
        logToFile(`[Silent Cancel Request] Device: ${devIdStr}, IntentId: ${previousIntentId}`);
        try {
          const cancelUrl = `https://api.mercadopago.com/v1/orders/${previousIntentId}/cancel`;
          const cancelRes = await nativeRequest(cancelUrl, 'POST', {
            'Authorization': `Bearer ${token}`,
            'X-Idempotency-Key': `cancel_${previousIntentId}_${Date.now()}`
          });
          console.log(`[Mercado Pago Point] Resposta cancelamento anterior status: ${cancelRes.status}`);
          logToFile(`[Silent Cancel Response] Status: ${cancelRes.status}, Body: ${JSON.stringify(cancelRes.json || cancelRes.text || '')}`);
          delete global.activePointIntents[devIdStr];
        } catch (cancelErr) {
          console.error(`[Mercado Pago Point] Erro ao tentar cancelar ordem anterior:`, cancelErr);
          logToFile(`[Silent Cancel Error] Msg: ${cancelErr.message || cancelErr}`);
        }
      }

      if (isMock) {
        console.log(`[Mercado Pago Point Dev] Rodando em modo MOCK. Dispositivo: ${devIdStr}`);
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
            console.log(`[Mercado Pago Point Dev Mock] Pagamento ${mockIntentId} APROVADO via simulação.`);
          }
        }, 10000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          intentId: mockIntentId,
          status: 'OPEN',
          isMock: true
        }));
      }

      const numericAmount = parseFloat(amount);
      if (numericAmount < 1.00) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'O valor mínimo para pagamento na maquininha é de R$ 1,00.' }));
      }

      // Chamada real ao Mercado Pago Point (Orders API)
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
        total_amount: numericAmount,
        items: [
          {
            title: 'Pedido Dona Lu',
            unit_price: numericAmount,
            quantity: 1
          }
        ],
        point_of_interaction: {
          type: 'POINT',
          business_info: {
            device_id: devIdStr
          }
        }
      };

      console.log('[Mercado Pago Point v1/orders] URL:', mpUrl);
      console.log('[Mercado Pago Point v1/orders] Enviando Payload:', JSON.stringify(payload, null, 2));
      logToFile(`[Create Request] Device: ${devIdStr}, Amount: ${amount}, Payload: ${JSON.stringify(payload)}`);

      const response = await nativeRequest(mpUrl, 'POST', headers, payload);

      console.log('[Mercado Pago Point v1/orders] Resposta Status:', response.status);
      if (response.json) {
        console.log('[Mercado Pago Point v1/orders] Resposta JSON:', JSON.stringify(response.json, null, 2));
      } else if (response.text) {
        console.log('[Mercado Pago Point v1/orders] Resposta Texto:', response.text);
      }
      logToFile(`[Create Response] Status: ${response.status}, Body: ${JSON.stringify(response.json || response.text || '')}`);

      if (!response.ok) {
        console.error('[Mercado Pago Point Dev] Erro ao criar ordem de pagamento:', response.json);
        
        // Fallback para mock em desenvolvimento se der erro na API
        const mockIntentId = 'INTENT_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
        global.mockPointIntents[mockIntentId] = {
          status: 'OPEN',
          createdAt: Date.now(),
          amount: numericAmount,
          deviceId: devIdStr
        };
        setTimeout(() => {
          if (global.mockPointIntents[mockIntentId]) {
            global.mockPointIntents[mockIntentId].status = 'FINISHED';
          }
        }, 10000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          intentId: mockIntentId,
          status: 'OPEN',
          isMock: true,
          message: 'Modo de testes ativo (erro na API real).'
        }));
      }

      const r = response.json;
      if (r.id) {
        global.activePointIntents[devIdStr] = r.id;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        intentId: r.id,
        status: r.status || 'created',
        isMock: false
      }));

    } catch (err) {
      console.error('[Mercado Pago Point Dev] Erro no middleware:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno ao acionar maquininha.' }));
    }
  });
};

export const checkPointOrderMiddleware = async (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const intentId = urlObj.searchParams.get('intentId');
    const token = urlObj.searchParams.get('token');
    
    if (!intentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'intentId é obrigatório.' }));
    }
    
    const isMock = intentId.startsWith('INTENT_MOCK_') || !token || token === 'mock' || token === 'null' || token === 'undefined';
    
    if (isMock) {
      const mockIntent = global.mockPointIntents[intentId];
      if (!mockIntent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, status: 'CANCELED' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, status: mockIntent.status, isMock: true }));
    }

    // Consulta real ao Mercado Pago (Orders API)
    const mpUrl = `https://api.mercadopago.com/v1/orders/${intentId}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };

    const response = await nativeRequest(mpUrl, 'GET', headers);

    if (!response.ok) {
      console.error('[Mercado Pago Point Dev] Erro ao consultar ordem:', response.json);
      
      const mockIntent = global.mockPointIntents[intentId];
      if (mockIntent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, status: mockIntent.status, isMock: true }));
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro ao verificar maquininha no Mercado Pago.' }));
    }

    const r = response.json;
    
    // Mapeamento de status da Orders API
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, status: finalStatus, isMock: false }));

  } catch (err) {
    console.error('[Mercado Pago Point Status Dev] Erro no middleware:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: 'Erro interno ao checar maquininha.' }));
  }
};

export const cancelPointOrderMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { token, deviceId, intentId } = data || {};
      
      const devIdStr = deviceId ? String(deviceId) : '';
      const isMock = !token || token === 'mock' || !intentId || intentId.startsWith('INTENT_MOCK_');
      
      if (isMock) {
        console.log(`[Mercado Pago Point Cancel] MOCK cancelamento de ${intentId}`);
        if (global.mockPointIntents[intentId]) {
          global.mockPointIntents[intentId].status = 'CANCELED';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Pagamento simulado cancelado.' }));
      }
      
      const mpUrl = `https://api.mercadopago.com/v1/orders/${intentId}/cancel`;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': `cancel_${intentId}_${Date.now()}`
      };
      
      console.log(`[Mercado Pago Point Cancel] Cancelando ordem ${intentId} para o dispositivo ${devIdStr} (Orders API)...`);
      logToFile(`[Cancel Request] Device: ${devIdStr}, IntentId: ${intentId}`);
      
      const response = await nativeRequest(mpUrl, 'POST', headers);
      
      console.log(`[Mercado Pago Point Cancel] Status resposta: ${response.status}`);
      logToFile(`[Cancel Response] Status: ${response.status}, Body: ${JSON.stringify(response.json || response.text || '')}`);
      
      if (response.status === 200 || response.ok) {
        if (global.activePointIntents[devIdStr] === intentId) {
          delete global.activePointIntents[devIdStr];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Pagamento cancelado com sucesso.' }));
      }
      
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: response.json?.message || 'Erro ao cancelar pagamento na maquininha.' }));
      
    } catch (err) {
      console.error('[Mercado Pago Point Cancel] Erro no middleware:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno ao cancelar pagamento.' }));
    }
  });
};

/**
 * Middleware local para listar os dispositivos (maquininhas) Point associados à conta MP.
 * Espelha a lógica do serverless api/point/devices.js.
 * GET /api/point/devices?token=...
 */
export const listPointDevicesMiddleware = async (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const token = urlObj.searchParams.get('token');

    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'token é obrigatório.' }));
    }

    const isMock = detectIsMock(token);

    if (isMock) {
      console.log('[Point Devices Dev] Rodando em modo MOCK.');
      // Return simulated devices for local development
      const mockDevices = [
        { id: 'PAX_A910__SMARTPOS1234567890', external_id: 'PAX_A910__SMARTPOS1234567890', operating_mode: 'PDV', model: 'PAX_A910', serial_number: 'SN001', store_id: 'LOJA01', pos_id: 'CAIXA01', external_store_id: 'Dona Lu Pastelaria', external_pos_id: 'CAIXA_SMART2' },
        { id: 'PAX_A920__SMARTPOS9876543210', external_id: 'PAX_A920__SMARTPOS9876543210', operating_mode: 'STANDALONE', model: 'PAX_A920', serial_number: 'SN002', store_id: 'LOJA01', pos_id: 'CAIXA02', external_store_id: 'Dona Lu Pastelaria', external_pos_id: 'CAIXA_PRO3' },
        { id: 'INGENICO_MOVE5000__SN005', external_id: 'INGENICO_MOVE5000__SN005', operating_mode: 'STANDALONE', model: 'INGENICO_MOVE5000', serial_number: 'SN005', store_id: 'LOJA01', pos_id: 'CAIXA03', external_store_id: 'Dona Lu Pastelaria', external_pos_id: 'CAIXA_AIR2' },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, devices: mockDevices, isMock: true }));
    }

    // Chamada real — tenta nova API primeiro, fallback para legado
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    let devices = [];
    let apiUsed = 'terminals_v1';

    const newApiRes = await nativeRequest(
      'https://api.mercadopago.com/terminals/v1/list?limit=50&offset=0',
      'GET',
      headers
    );

    if (newApiRes.ok && Array.isArray(newApiRes.json?.terminals)) {
      devices = newApiRes.json.terminals.map(t => ({
        id: t.id,
        external_id: t.id,
        operating_mode: t.operating_mode || 'STANDALONE',
        model: t.model || 'Unknown',
        serial_number: t.serial_number || '',
        store_id: t.store_id || '',
        pos_id: t.pos_id || '',
        external_store_id: t.external_store_id || '',
        external_pos_id: t.external_pos_id || ''
      }));
    } else {
      apiUsed = 'point_integration_legacy';
      const legacyRes = await nativeRequest('https://api.mercadopago.com/point/integration-api/devices', 'GET', headers);
      if (!legacyRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: legacyRes.json?.message || 'Erro ao listar dispositivos. Verifique as permissões do token.' }));
      }
      const devList = legacyRes.json?.devices || legacyRes.json || [];
      devices = (Array.isArray(devList) ? devList : []).map(d => ({
        id: d.id,
        external_id: d.external_id || d.id,
        operating_mode: d.operating_mode || 'STANDALONE',
        model: d.model || 'Unknown',
        serial_number: d.serial_number || '',
        store_id: d.store_id || '',
        pos_id: d.pos_id || '',
        external_store_id: d.external_store_id || '',
        external_pos_id: d.external_pos_id || ''
      }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, devices, apiUsed }));

  } catch (err) {
    console.error('[Point Devices Dev] Erro interno:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: 'Erro interno ao listar dispositivos.' }));
  }
};

/**
 * Middleware local para alterar o modo de operação (PDV / STANDALONE) de uma maquininha Point.
 * Espelha a lógica do serverless api/point/set-mode.js.
 * PATCH /api/point/set-mode  Body: { token, deviceId, mode }
 */
export const setPointDeviceModeMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { token, deviceId, mode } = data;

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'token é obrigatório.' }));
      }
      if (!deviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'deviceId é obrigatório.' }));
      }
      if (!['PDV', 'STANDALONE'].includes(mode)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'mode deve ser "PDV" ou "STANDALONE".' }));
      }

      const isMock = detectIsMock(token) || deviceId.includes('MOCK') || deviceId.includes('__');

      if (isMock) {
        console.log(`[Point SetMode Dev] MOCK — Modo ${mode} simulado para dispositivo ${deviceId}`);
        await new Promise(resolve => setTimeout(resolve, 600));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          deviceId,
          mode,
          message: `Modo ${mode === 'PDV' ? 'PDV (Integrado)' : 'Autônomo'} ativado com sucesso. (simulação)`,
          isMock: true
        }));
      }

      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      // Legacy API (more widely supported for mode changes)
      const legacyRes = await nativeRequest(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}`,
        'PATCH',
        headers,
        { operating_mode: mode }
      );

      if (legacyRes.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, deviceId, mode, message: `Modo ${mode === 'PDV' ? 'PDV (Integrado)' : 'Autônomo'} ativado com sucesso.` }));
      }

      // Fallback: new terminals API
      const newApiRes = await nativeRequest(
        'https://api.mercadopago.com/terminals/v1/setup',
        'PATCH',
        headers,
        { terminal_id: deviceId, operating_mode: mode }
      );

      if (!newApiRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          message: newApiRes.json?.message || 'Erro ao alterar modo.',
          hint: 'Verifique se o token possui permissão write:pos e se a maquininha está conectada.',
          details: newApiRes.json
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, deviceId, mode, message: `Modo ${mode === 'PDV' ? 'PDV (Integrado)' : 'Autônomo'} ativado com sucesso.` }));

    } catch (err) {
      console.error('[Point SetMode Dev] Erro interno:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno ao alterar modo do dispositivo.' }));
    }
  });
};

/**
 * Middleware local para trocar o código OAuth do Mercado Pago por um access_token real.
 * Espelha a lógica do serverless api/mercadopago/exchange-token.js.
 * Em ambiente local, o MP_APP_SECRET deve estar no arquivo .env.local.
 */
export const mpOAuthExchangeMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { code, clientId, redirectUri } = data;

      const clientSecret = process.env.MP_APP_SECRET || process.env.VITE_MP_APP_SECRET;

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'code OAuth é obrigatório.' }));
      }
      if (!clientId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'clientId é obrigatório.' }));
      }
      if (!clientSecret) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          message: 'MP_APP_SECRET não está configurado. Adicione MP_APP_SECRET no arquivo .env.local para desenvolvimento local.'
        }));
      }

      const formBody = [
        'grant_type=authorization_code',
        `client_id=${encodeURIComponent(clientId)}`,
        `client_secret=${encodeURIComponent(clientSecret)}`,
        `code=${encodeURIComponent(code)}`,
        `redirect_uri=${encodeURIComponent(redirectUri || '')}`
      ].join('&');

      const tokenRes = await nativeRequest(
        'https://api.mercadopago.com/oauth/token',
        'POST',
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(formBody).toString()
        },
        formBody
      );

      if (!tokenRes.ok) {
        console.error('[MP OAuth Local] Falha na troca de código:', tokenRes.json || tokenRes.text);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          message: tokenRes.json?.message || tokenRes.json?.error_description || 'Erro ao trocar código por token.',
          details: tokenRes.json
        }));
      }

      const { access_token, refresh_token, user_id, scope } = tokenRes.json;

      let email = '', nickname = '';
      try {
        const userRes = await nativeRequest(
          `https://api.mercadopago.com/users/${user_id}`,
          'GET',
          { 'Authorization': `Bearer ${access_token}`, 'Accept': 'application/json' }
        );
        if (userRes.ok) {
          email = userRes.json?.email || '';
          nickname = userRes.json?.nickname || userRes.json?.first_name || '';
        }
      } catch { /* non-fatal */ }

      console.log(`[MP OAuth Local] Token trocado com sucesso para userId: ${user_id} (${email})`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        accessToken: access_token,
        refreshToken: refresh_token,
        userId: user_id,
        scope,
        email,
        nickname
      }));

    } catch (err) {
      console.error('[MP OAuth Local] Erro interno:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno ao trocar código por token.' }));
    }
  });
};
export const processMPCardOrderMiddleware = async (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { accessToken, orderPayload, deviceSessionId } = data;
      const https = await import('https');
      const options = {
        hostname: 'api.mercadopago.com',
        port: 443,
        path: '/v1/payments',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.trim()}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': 'DONALU_CARD_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
        }
      };
      if (deviceSessionId) options.headers['X-Melidata-Session-Id'] = deviceSessionId;
      const mpReq = https.request(options, (mpRes) => {
        let responseBody = '';
        mpRes.on('data', chunk => responseBody += chunk);
        mpRes.on('end', () => {
          console.log('[MP /v1/payments] Response:', responseBody);
          res.writeHead(mpRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(responseBody);
        });
      });
      mpReq.on('error', (e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: e.message }));
      });
      console.log('[MP /v1/payments] Request Payload:', JSON.stringify(orderPayload, null, 2));
      mpReq.write(JSON.stringify(orderPayload));
      mpReq.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: err.message }));
    }
  });
};

async function getMercadoPagoToken() {
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/settings/store_config';
    const res = await nativeRequest(url, 'GET', {});
    if (res.ok && res.json && res.json.fields) {
      const fields = res.json.fields;
      const token = fields.storeOwnerAccessToken?.stringValue || fields.devAccessToken?.stringValue || 'mock';
      if (token && token !== 'null' && token !== 'undefined') {
        return token;
      }
    }
  } catch (err) {
    console.error('[Webhook] Erro ao obter token do Firestore:', err);
  }
  return 'mock';
}

export const webhookMiddleware = async (req, res) => {
  let bodyStr = '';
  req.on('data', chunk => { bodyStr += chunk.toString(); });
  req.on('end', async () => {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const query = Object.fromEntries(urlObj.searchParams.entries());
      const body = bodyStr ? JSON.parse(bodyStr) : {};

      const resourceId = body.data?.id || query.id;
      const topic = body.type || query.topic;

      console.log(`[Local Webhook Mercado Pago] Recebido - ID: ${resourceId}, Tópico/Tipo: ${topic}`);

      if (!resourceId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Notificação recebida, mas sem ID de recurso.' }));
      }

      if (topic === 'payment') {
        const token = await getMercadoPagoToken();
        
        if (!token || token === 'mock') {
          console.log('[Local Webhook] Rodando em modo MOCK ou sem credenciais de produção. Ignorando.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: 'Modo mock ativado.' }));
        }

        const mpUrl = `https://api.mercadopago.com/v1/payments/${resourceId}`;
        const mpRes = await nativeRequest(mpUrl, 'GET', { 'Authorization': `Bearer ${token}` });

        if (!mpRes.ok) {
          console.error(`[Local Webhook] Erro ao obter detalhes do pagamento ${resourceId} no Mercado Pago:`, mpRes.json || mpRes.text);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Erro ao validar pagamento no Mercado Pago.' }));
        }

        const payment = mpRes.json;
        const orderId = payment.external_reference;
        const paymentVerificationToken = payment.metadata?.payment_verification_token;
        const status = payment.status;

        console.log(`[Local Webhook] Detalhes Pagamento - OrderID: ${orderId}, Status: ${status}, Token: ${paymentVerificationToken}`);

        if (orderId && paymentVerificationToken && status === 'approved') {
          const firestoreUrl = `https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/orders/${orderId}?updateMask.fieldPaths=status&updateMask.fieldPaths=paymentVerificationToken`;
          
          const updatePayload = {
            fields: {
              status: { stringValue: 'pending' },
              paymentVerificationToken: { stringValue: paymentVerificationToken }
            }
          };

          const firestoreRes = await nativeRequest(firestoreUrl, 'PATCH', {}, updatePayload);

          if (!firestoreRes.ok) {
            console.error(`[Local Webhook] Falha ao atualizar pedido ${orderId} no Firestore:`, firestoreRes.json || firestoreRes.text);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Erro ao atualizar pedido no banco de dados.' }));
          }

          console.log(`[Local Webhook] Pedido ${orderId} atualizado com sucesso no Firestore para 'pending'!`);

          try {
            const auditUrl = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/audit_logs';
            const auditPayload = {
              fields: {
                actionType: { stringValue: 'PAYMENT_WEBHOOK' },
                title: { stringValue: 'Pagamento Confirmado (Local Webhook)' },
                description: { stringValue: `Pedido ${orderId} aprovado via webhook do Mercado Pago.` },
                createdAt: { stringValue: new Date().toISOString() },
                userId: { stringValue: 'system-webhook' },
                userRole: { stringValue: 'system' }
              }
            };
            await nativeRequest(auditUrl, 'POST', {}, auditPayload);
          } catch (auditErr) {
            console.error('[Local Webhook] Erro ao registrar log de auditoria:', auditErr);
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Notificação processada.' }));

    } catch (err) {
      console.error('[Local Webhook Mercado Pago] Erro no handler:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Erro interno no processamento do webhook.' }));
    }
  });
};
