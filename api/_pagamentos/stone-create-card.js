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
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: JSON.parse(body) });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function detectIsMock(token) {
  if (!token) return true;
  const t = String(token).trim();
  if (!t || t === 'mock' || t === 'null' || t === 'undefined') return true;
  if (t.includes('-MOCK-') || t.startsWith('TEST-')) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const {
      token, cardToken, rawCard, amount, email, name, cpf,
      installments, orderId, stoneRecipientId, devPercentage
    } = req.body;

    const isMock = detectIsMock(token);
    
    if (isMock || !token?.startsWith('sk_')) {
      console.log('[Stone Card] Rodando em modo MOCK');
      return res.status(200).json({
        success: true,
        orderId: 'MOCK_ORD_' + Math.random().toString(36).substring(2, 11).toUpperCase(),
        status: 'paid',
        approved: true,
        isMock: true
      });
    }

    if (!cardToken && !rawCard) {
      return res.status(400).json({ success: false, message: 'Token do cartao ou dados do cartao nao fornecidos.' });
    }

    const transactionAmountCents = Math.round(parseFloat(amount) * 100);
    const cleanCpf = (cpf || '').replace(/\D/g, '');
    const finalCpf = cleanCpf.length === 11 ? cleanCpf : '00000000000';

    const stoneUrl = 'https://api.pagar.me/core/v5/orders';
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Idempotency-key': 'CARD_STONE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
    };

    let creditCardData = {
      installments: parseInt(installments || 1),
      statement_descriptor: 'DONA LU',
      billing_address: {
        line_1: "Rua Jicara, 239",
        zip_code: "23092000",
        city: "Rio de Janeiro",
        state: "RJ",
        country: "BR"
      }
    };

    if (cardToken) {
      creditCardData.card_token = cardToken;
    } else if (rawCard) {
      creditCardData.card = {
        number: rawCard.cardNumber,
        holder_name: rawCard.cardHolder,
        exp_month: parseInt(rawCard.cardExpiryMonth),
        exp_year: parseInt(rawCard.cardExpiryYear),
        cvv: rawCard.cardCvv
      };
    }

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
        document: finalCpf,
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
          payment_method: 'credit_card',
          credit_card: creditCardData
        }
      ],
      closed: true,
      metadata: {
        orderId: orderId
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

    const orderRes = await nativeRequest(stoneUrl, 'POST', headers, payload);

    if (!orderRes.ok) {
      console.error('[Stone Card Order] Erro:', JSON.stringify(orderRes.json, null, 2) || orderRes.text);
      const errMsg = orderRes.json?.message || 'Erro ao processar pagamento na Stone.';
      return res.status(400).json({ success: false, message: errMsg, details: orderRes.json });
    }

    const order = orderRes.json;
    const paymentStatus = order.status; // pending, paid, failed, canceled
    
    let acquirerMessage = '';
    if (paymentStatus === 'failed') {
      try {
        acquirerMessage = order.charges?.[0]?.last_transaction?.acquirer_message || 
                          order.charges?.[0]?.last_transaction?.gateway_response?.errors?.[0]?.message || 
                          'Pagamento recusado pela operadora.';
      } catch (e) {
        acquirerMessage = 'Pagamento recusado pela operadora.';
      }
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      status: paymentStatus,
      approved: paymentStatus === 'paid',
      acquirerMessage: acquirerMessage
    });

  } catch (err) {
    console.error('[Stone Card Order] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar pagamento na Stone.' });
  }
}
