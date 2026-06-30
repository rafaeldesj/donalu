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

// Em memória temporária na Vercel (para fins de mock)
const mockPayments = {};

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
    const { token, amount, email, name, cpf } = req.body;

    const isMock = !token || token === 'mock' || token === '' || token === 'null' || token === 'undefined';

    if (isMock) {
      console.log('[Mercado Pago Pix] Rodando em modo MOCK.');
      const mockPaymentId = 'PAY_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
      mockPayments[mockPaymentId] = {
        status: 'pending',
        createdAt: Date.now()
      };

      return res.status(200).json({
        success: true,
        paymentId: mockPaymentId,
        qrCode: '00020101021226870014br.gov.bcb.pix2565qr-mock-code-dona-lu-pastelaria-1234567890',
        qrCodeBase64: '',
        status: 'pending'
      });
    }

    const mpUrl = 'https://api.mercadopago.com/v1/payments';
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'PIX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
    };

    const firstName = name.split(' ')[0] || 'Cliente';
    const lastName = name.split(' ').slice(1).join(' ') || 'Dona Lu';

    const payload = {
      transaction_amount: parseFloat(amount),
      description: 'Pedido Dona Lu Pastelaria',
      payment_method_id: 'pix',
      payer: {
        email: email || 'cliente@email.com',
        first_name: firstName,
        last_name: lastName,
        identification: {
          type: 'CPF',
          number: cpf.replace(/\D/g, '') || '45678912364'
        }
      }
    };

    const response = await nativeRequest(mpUrl, 'POST', headers, payload);

    if (!response.ok) {
      console.error('[Mercado Pago Pix] Erro ao criar pagamento:', response.json);
      return res.status(400).json({ success: false, message: response.json?.message || 'Erro ao gerar Pix no Mercado Pago.' });
    }

    const r = response.json;
    const qrCode = r.point_of_interaction?.transaction_data?.qr_code || '';
    const qrCodeBase64 = r.point_of_interaction?.transaction_data?.qr_code_base64 || '';

    return res.status(200).json({
      success: true,
      paymentId: r.id.toString(),
      qrCode,
      qrCodeBase64,
      status: r.status
    });

  } catch (err) {
    console.error('[Mercado Pago Pix] Erro no middleware:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao criar Pix.' });
  }
}
