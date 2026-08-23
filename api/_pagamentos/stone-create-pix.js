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

const mockPayments = {};

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
    const { token, amount, email, name, cpf, orderId, paymentVerificationToken, stoneRecipientId, devPercentage } = req.body;
    
    // Na Stone (Pagar.me), o token usado aqui será a Secret Key (sk_...)
    const isMock = detectIsMock(token);

    if (isMock || !token.startsWith('sk_')) {
      console.log('[Stone Pix] Rodando em modo MOCK (token ausente ou inválido).');
      const mockPaymentId = 'or_MOCK_' + Math.random().toString(36).substring(2, 11);
      mockPayments[mockPaymentId] = { status: 'pending', createdAt: Date.now() };

      return res.status(200).json({
        success: true,
        paymentId: mockPaymentId,
        qrCode: '00020101021226870014br.gov.bcb.pix2565qr-mock-code-stone-1234567890',
        qrCodeUrl: '',
        status: 'pending',
        isMock: true
      });
    }

    const stoneUrl = 'https://api.pagar.me/core/v5/orders';
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Idempotency-key': 'PIX_STONE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
    };

    const transactionAmountCents = Math.round(parseFloat(amount) * 100);
    const cleanCpf = (cpf || '').replace(/\D/g, '');

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || '';
    const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');

    const payload = {
      items: [
        {
          amount: transactionAmountCents,
          description: 'Pedido Dona Lu Pastelaria',
          quantity: 1,
          code: orderId || '1'
        }
      ],
      customer: {
        name: name || 'Cliente Dona Lu',
        email: email || 'cliente@pastelaria.com',
        type: 'individual',
        document: cleanCpf || '00000000000',
        phones: {
          mobile_phone: {
            country_code: "55",
            area_code: "21",
            number: "999999999"
          }
        }
      },
      payments: [
        {
          payment_method: 'pix',
          pix: {
            expires_in: 3600
          }
        }
      ],
      closed: true,
      metadata: {
        orderId: orderId,
        paymentVerificationToken: paymentVerificationToken
      }
    };

    if (stoneRecipientId && devPercentage && devPercentage > 0) {
      payload.payments[0].split = [
        {
          amount: Math.round(transactionAmountCents * ((100 - devPercentage) / 100)),
          recipient_id: stoneRecipientId,
          type: 'flat', // Amount in cents
          options: {
            charge_processing_fee: true,
            charge_remainder_fee: true,
            liable: true
          }
        }
      ];
    }

    const response = await nativeRequest(stoneUrl, 'POST', headers, payload);

    if (!response.ok) {
      console.error('[Stone Pix] Erro ao criar pagamento:', JSON.stringify(response.json, null, 2));
      return res.status(400).json({ success: false, message: response.json?.message || 'Erro ao gerar Pix na Stone.' });
    }

    const r = response.json;
    
    // A API V5 retorna a chave qr_code no last_transaction do charge
    const charge = r.charges && r.charges.length > 0 ? r.charges[0] : null;
    const qrCode = charge?.last_transaction?.qr_code || '';
    const qrCodeUrl = charge?.last_transaction?.qr_code_url || '';

    return res.status(200).json({
      success: true,
      paymentId: r.id, // Formato or_xxxxx
      qrCode,
      qrCodeUrl, // URL da imagem do QRCode fornecida pela Pagar.me
      status: r.status // pending, paid, etc
    });

  } catch (err) {
    console.error('[Stone Pix] Erro no middleware:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao criar Pix na Stone.' });
  }
}
