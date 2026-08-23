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
    } = req.body;

    const pagbankToken = process.env.PAGBANK_TOKEN;
    const isMock = !pagbankToken || pagbankToken === 'mock';
    const amountCents = Math.round(orderTotal * 100);

    if (isMock) {
      console.warn('[PagBank Middleware] Rodando em modo MOCK.');
      if (encryptedCard === 'fail' || encryptedCard === 'invalid_card') {
        return res.status(400).json({
          success: false,
          message: 'Cartão recusado pelo emissor. Verifique os dados e tente novamente.'
        });
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

      return res.status(200).json(responseData);
    }

    const headers = {
      'Authorization': `Bearer ${pagbankToken}`,
      'Content-Type': 'application/json'
    };

    const baseUrl = 'https://sandbox.api.pagseguro.com'; // Altere para 'https://api.pagseguro.com' se em Produção

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
      return res.status(400).json({ success: false, message: errMsg });
    }

    const responseData = {
      success: true,
      chargeId: chargeRes.json.id
    };

    if (!useSavedCard && saveCard) {
      let customerId = savedCustomerId;

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

    return res.status(200).json(responseData);

  } catch (error) {
    console.error('[PagBank Middleware] Erro no processamento de pagamento:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar o pagamento.' });
  }
}
