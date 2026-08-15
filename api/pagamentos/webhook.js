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
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr), 'Content-Type': 'application/json' } : {})
      }
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

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

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
    const body = req.body || {};
    const query = req.query || {};

    // Mercado Pago envia o ID no body (Webhook) ou na query (IPN)
    const resourceId = body.data?.id || query.id;
    const topic = body.type || query.topic;

    console.log(`[Webhook Mercado Pago] Recebido - ID: ${resourceId}, Tópico/Tipo: ${topic}`);

    if (!resourceId) {
      return res.status(200).json({ success: true, message: 'Notificação recebida, mas sem ID de recurso.' });
    }

    // Apenas nos interessam eventos de pagamento ("payment")
    if (topic === 'payment') {
      const token = await getMercadoPagoToken();
      
      if (!token || token === 'mock') {
        console.log('[Webhook] Rodando em modo MOCK ou sem credenciais de produção. Ignorando.');
        return res.status(200).json({ success: true, message: 'Modo mock ativado.' });
      }
      const mpAccessToken = await getMercadoPagoToken();
      if (!mpAccessToken || mpAccessToken === 'mock') {
        console.error('[Webhook] Access token do Mercado Pago não encontrado ou mockado.');
        return res.status(200).json({ success: true, message: 'Simulado/Ignorado.' });
      }

      if (!resourceId) {
        return res.status(400).json({ success: false, message: 'ID do pagamento não fornecido.' });
      }

      // Consulta a API do MP para confirmar o status atual e obter metadata
      const mpRes = await nativeRequest(`https://api.mercadopago.com/v1/payments/${resourceId}`, 'GET', {
        'Authorization': `Bearer ${mpAccessToken}`
      });

      if (!mpRes.ok) {
        console.error(`[Webhook] Erro ao buscar pagamento ${resourceId}:`, mpRes.json || mpRes.text);
        return res.status(200).json({ success: true, message: 'Pagamento não encontrado na API do MP, ignorando.' });
      }

      const payment = mpRes.json;
      const orderId = payment.external_reference;
      const paymentVerificationToken = payment.metadata?.payment_verification_token;
      const status = payment.status;

      console.log(`[Webhook] Detalhes Pagamento - OrderID: ${orderId}, Status: ${status}, Token: ${paymentVerificationToken}`);

      if (orderId && paymentVerificationToken && status === 'approved') {
        // Atualiza o Firestore usando a REST API com o token de verificação e insere na cozinha
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/orders/${orderId}?updateMask.fieldPaths=status&updateMask.fieldPaths=paymentVerificationToken&updateMask.fieldPaths=kitchenEnteredAt`;
        
        const updatePayload = {
          fields: {
            status: { stringValue: 'pending' },
            paymentVerificationToken: { stringValue: paymentVerificationToken },
            kitchenEnteredAt: { stringValue: new Date().toISOString() }
          }
        };

        const firestoreRes = await nativeRequest(firestoreUrl, 'PATCH', { 'Content-Type': 'application/json' }, updatePayload);

        if (!firestoreRes.ok) {
          console.error(`[Webhook] Falha ao atualizar pedido ${orderId} no Firestore:`, firestoreRes.json || firestoreRes.text);
          return res.status(500).json({ success: false, message: 'Erro ao atualizar pedido no banco de dados.' });
        }

        console.log(`[Webhook] Pedido ${orderId} atualizado com sucesso no Firestore para 'pending'!`);

        // Cria log de auditoria via REST API
        try {
          const auditUrl = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/audit_logs';
          const auditPayload = {
            fields: {
              actionType: { stringValue: 'PAYMENT_WEBHOOK' },
              title: { stringValue: 'Pagamento Confirmado (Webhook)' },
              description: { stringValue: `Pedido ${orderId} aprovado via webhook do Mercado Pago.` },
              createdAt: { stringValue: new Date().toISOString() },
              userId: { stringValue: 'system-webhook' },
              userRole: { stringValue: 'system' }
            }
          };
          await nativeRequest(auditUrl, 'POST', { 'Content-Type': 'application/json' }, auditPayload);
        } catch (auditErr) {
          console.error('[Webhook] Erro ao registrar log de auditoria:', auditErr);
        }
      }
    }

    // Mercado Pago exige resposta 200/201 para confirmar recebimento
    return res.status(200).json({ success: true, message: 'Notificação processada.' });

  } catch (err) {
    console.error('[Webhook Mercado Pago] Erro no handler:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no processamento do webhook.' });
  }
}
