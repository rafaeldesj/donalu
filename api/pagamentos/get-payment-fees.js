import https from 'https';

function nativeRequest(url, method, headers) {
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

    req.on('error', reject);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { transactionId, token } = req.query;

    if (!transactionId || !token) {
      return res.status(400).json({ success: false, message: 'Parâmetros transactionId e token são obrigatórios.' });
    }

    if (token === 'mock' || token === 'null' || token === 'undefined' || transactionId.includes('MOCK')) {
       return res.status(200).json({
          success: true,
          fees: {
            mpFee: 0,
            devFee: 0,
            netAmount: 0,
            grossAmount: 0
          }
       });
    }

    let paymentId = transactionId;
    const headers = { 'Authorization': `Bearer ${token}` };

    // Se o transactionId parece um OrderID do Point (geralmente começa com letras, ex: ORD...)
    if (isNaN(Number(transactionId))) {
      const orderRes = await nativeRequest(`https://api.mercadopago.com/v1/orders/${transactionId}`, 'GET', headers);
      if (orderRes.ok) {
        let foundPaymentId = null;
        if (orderRes.json?.payments?.length > 0) {
          foundPaymentId = orderRes.json.payments[0].id;
        } else if (orderRes.json?.transactions?.length > 0) {
          if (orderRes.json.transactions[0].payments?.length > 0) {
            foundPaymentId = orderRes.json.transactions[0].payments[0].id;
          } else if (orderRes.json.transactions[0].transaction_id) {
            foundPaymentId = orderRes.json.transactions[0].transaction_id;
          } else if (orderRes.json.transactions[0].id) {
            foundPaymentId = orderRes.json.transactions[0].id;
          }
        } else if (orderRes.json?.payment?.id) {
          foundPaymentId = orderRes.json.payment.id;
        }

        if (foundPaymentId) {
          paymentId = foundPaymentId;
        } else {
          // Fallback: Tenta buscar os pagamentos associados a essa ordem pela API de busca de pagamentos
          const searchRes = await nativeRequest(`https://api.mercadopago.com/v1/payments/search?order.id=${transactionId}`, 'GET', headers);
          if (searchRes.ok && searchRes.json?.results?.length > 0) {
            paymentId = searchRes.json.results[0].id;
          } else {
            return res.status(404).json({ success: false, message: 'Nenhum pagamento atrelado a essa ordem no Mercado Pago.', details: orderRes.json });
          }
        }
      } else {
        return res.status(404).json({ success: false, message: 'Ordem não encontrada no Mercado Pago.', details: orderRes.json });
      }
    }

    // Consulta o pagamento
    const payRes = await nativeRequest(`https://api.mercadopago.com/v1/payments/${paymentId}`, 'GET', headers);
    
    if (!payRes.ok) {
      return res.status(payRes.status).json({ success: false, message: 'Erro ao consultar pagamento no Mercado Pago.', details: payRes.json });
    }

    const paymentData = payRes.json;
    
    let mpFee = 0;
    let devFee = 0;

    if (paymentData.fee_details && Array.isArray(paymentData.fee_details)) {
      paymentData.fee_details.forEach(fee => {
        if (fee.type === 'mercadopago_fee') mpFee += fee.amount;
        else if (fee.type === 'application_fee') devFee += fee.amount;
        else mpFee += fee.amount; // outras taxas cobradas do lojista
      });
    } else {
       // fallback if fee_details missing
       mpFee = paymentData.fee_details?.amount || 0;
    }

    const grossAmount = paymentData.transaction_amount || 0;
    const netAmount = paymentData.transaction_details?.net_received_amount || (grossAmount - mpFee - devFee);

    return res.status(200).json({
      success: true,
      fees: {
        mpFee,
        devFee,
        netAmount,
        grossAmount
      }
    });

  } catch (err) {
    console.error('[MP Get Fees] Erro:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao consultar taxas.' });
  }
}
