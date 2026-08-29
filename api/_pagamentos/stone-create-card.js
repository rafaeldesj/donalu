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
      token, cardToken, rawCard, amount, email, name, cpf, phone, address,
      installments, orderId, stoneRecipientId, devPercentage, paymentVerificationToken
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
    const hasValidCpf = cleanCpf.length === 11;

    // Format phone
    let phoneArea = "21";
    let phoneNumber = "999999999";
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        phoneArea = cleanPhone.substring(0, 2);
        phoneNumber = cleanPhone.substring(2);
      }
    }

    const stoneUrl = 'https://api.pagar.me/core/v5/orders';
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Idempotency-key': 'CARD_STONE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
    };

    // Build address objects — antifraude requer customer.address + billing + shipping
    // Para pedidos de retirada, usa o endereço da loja como fallback
    const STORE_ADDRESS = {
      line_1: 'Rua Jicara, 239',
      zip_code: '23092000',
      city: 'Campo Grande',
      state: 'RJ',
      country: 'BR'
    };

    const customerAddress = address?.street ? {
      line_1: `${address.street}, ${address.number || 'S/N'}`,
      zip_code: (address.zipCode || '23092000').replace(/\D/g, ''),
      city: address.city || 'Campo Grande',
      state: address.state || 'RJ',
      country: 'BR'
    } : STORE_ADDRESS;

    let creditCardData = {
      installments: parseInt(installments || 1),
      statement_descriptor: 'DONA LU'
    };

    if (cardToken) {
      creditCardData.card_token = cardToken;
    } else if (rawCard) {
      creditCardData.card = {
        number: rawCard.cardNumber,
        holder_name: rawCard.cardHolder,
        exp_month: parseInt(rawCard.cardExpiryMonth),
        exp_year: parseInt(rawCard.cardExpiryYear),
        cvv: rawCard.cardCvv,
        billing_address: customerAddress // Restaura billing_address no cartão como em 30004df
      };
    }

    // Use cardholder name for better AVS matching
    const customerName = (rawCard?.cardHolder || name || 'Cliente Dona Lu');

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
        name: customerName,
        email: email || 'cliente@pastelaria.com',
        type: 'individual',
        ...(hasValidCpf ? { document: cleanCpf, document_type: 'CPF' } : {}),
        // address obrigatório para antifraude (docs.pagar.me v5)
        address: customerAddress,
        ...(phone && phone.replace(/\D/g, '').length >= 10 ? {
          phones: {
            mobile_phone: {
              country_code: "55",
              area_code: phoneArea,
              number: phoneNumber
            }
          }
        } : {})
      },
      // billing obrigatório no nível do pedido quando antifraude está ativo
      billing: {
        name: customerName,
        address: customerAddress
      },
      // shipping obrigatório no nível do pedido quando antifraude está ativo
      shipping: {
        amount: 0,
        description: 'Retirada ou Entrega',
        recipient_name: customerName,
        recipient_phone: phoneNumber,
        address: customerAddress
      },
      payments: [
        {
          payment_method: 'credit_card',
          credit_card: creditCardData,
          antifraud_enabled: false
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

    const orderRes = await nativeRequest(stoneUrl, 'POST', headers, payload);

    if (!orderRes.ok) {
      console.error('[Stone Card Order] Erro:', JSON.stringify(orderRes.json, null, 2) || orderRes.text);
      const errMsg = orderRes.json?.message || 'Erro ao processar pagamento na Stone.';
      return res.status(400).json({ success: false, message: errMsg, details: orderRes.json });
    }

    const order = orderRes.json;
    const paymentStatus = order.status; // pending, paid, failed, canceled
    
    let acquirerMessage = '';
    if (paymentStatus === 'failed' || paymentStatus !== 'paid') {
      const charge = order.charges?.[0];
      const lastTx = charge?.last_transaction;
      const antifraudRecommendation = charge?.antifraud_response?.recommendation;
      const antifraudScore = charge?.antifraud_response?.score;
      const antifraudStatus = charge?.antifraud_response?.status;
      
      console.log('[Stone Card] Status:', paymentStatus);
      console.log('[Stone Card] Antifraude - Status:', antifraudStatus, '| Score:', antifraudScore, '| Recomendacao:', antifraudRecommendation);
      console.log('[Stone Card] Mensagem adquirente:', lastTx?.acquirer_message);
      console.log('[Stone Card] Gateway errors:', JSON.stringify(lastTx?.gateway_response?.errors));
      console.log('[Stone Card] Resposta completa:', JSON.stringify(order, null, 2));
      
      if (antifraudStatus === 'refused' || antifraudRecommendation === 'refuse') {
        acquirerMessage = `Transacao negada pelo sistema antifraude (Score: ${antifraudScore || 'N/A'}).`;
      } else {
        try {
          acquirerMessage = lastTx?.acquirer_message ||
                            lastTx?.gateway_response?.errors?.[0]?.message ||
                            'Pagamento recusado pela operadora.';
        } catch (e) {
          acquirerMessage = 'Pagamento recusado pela operadora.';
        }
      }
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      status: paymentStatus,
      approved: paymentStatus === 'paid',
      acquirerMessage: acquirerMessage,
      // Full raw charge for diagnosis — REMOVE IN PRODUCTION
      _diag: {
        orderStatus: order.status,
        rawCharge: order.charges?.[0] ? {
          id: order.charges[0].id,
          status: order.charges[0].status,
          code: order.charges[0].code,
          amount: order.charges[0].amount,
          paid_amount: order.charges[0].paid_amount,
          antifraud_response: order.charges[0].antifraud_response,
          last_transaction: order.charges[0].last_transaction ? {
            id: order.charges[0].last_transaction.id,
            status: order.charges[0].last_transaction.status,
            amount: order.charges[0].last_transaction.amount,
            acquirer_id: order.charges[0].last_transaction.acquirer_id,
            acquirer_name: order.charges[0].last_transaction.acquirer_name,
            acquirer_message: order.charges[0].last_transaction.acquirer_message,
            acquirer_return_code: order.charges[0].last_transaction.acquirer_return_code,
            installments: order.charges[0].last_transaction.installments,
            operation_type: order.charges[0].last_transaction.operation_type,
            gateway_response: order.charges[0].last_transaction.gateway_response,
            three_d_secure: order.charges[0].last_transaction.three_d_secure
          } : null
        } : null
      }
    });

  } catch (err) {
    console.error('[Stone Card Order] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao processar pagamento na Stone.' });
  }
}
