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
      res.on('data', chunk => { body += chunk; });
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const body = req.body || {};
    const eventType = body.type;
    const orderData = body.data;

    console.log(`[Webhook Stone] Recebido Evento: ${eventType}`);

    if (!eventType || !orderData) {
      return res.status(200).json({ success: true, message: 'Notificação recebida, payload inválido.' });
    }

    if (eventType === 'order.paid') {
      const orderId = orderData.metadata?.orderId;
      const paymentVerificationToken = orderData.metadata?.paymentVerificationToken;

      console.log(`[Webhook Stone] Detalhes Pagamento - OrderID: ${orderId}, Token: ${paymentVerificationToken}`);

      if (orderId) {
        // Atualiza o Firestore usando a REST API
        let firestoreUrl = `https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/orders/${orderId}?updateMask.fieldPaths=status&updateMask.fieldPaths=kitchenEnteredAt`;
        
        let updateFields = {
          status: { stringValue: 'pending' },
          kitchenEnteredAt: { stringValue: new Date().toISOString() }
        };

        if (paymentVerificationToken) {
          firestoreUrl += `&updateMask.fieldPaths=paymentVerificationToken`;
          updateFields.paymentVerificationToken = { stringValue: paymentVerificationToken };
        }

        const updatePayload = { fields: updateFields };

        const firestoreRes = await nativeRequest(firestoreUrl, 'PATCH', { 'Content-Type': 'application/json' }, updatePayload);

        if (!firestoreRes.ok) {
          console.error(`[Webhook Stone] Falha ao atualizar pedido ${orderId} no Firestore:`, firestoreRes.json || firestoreRes.text);
          return res.status(500).json({ success: false, message: 'Erro ao atualizar pedido no banco de dados.' });
        }

        console.log(`[Webhook Stone] Pedido ${orderId} atualizado com sucesso no Firestore para 'pending'!`);

        try {
          const auditUrl = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/audit_logs';
          const auditPayload = {
            fields: {
              actionType: { stringValue: 'PAYMENT_WEBHOOK' },
              title: { stringValue: 'Pagamento Confirmado na Stone' },
              description: { stringValue: `Pedido ${orderId} aprovado via webhook da Stone.` },
              createdAt: { stringValue: new Date().toISOString() },
              userId: { stringValue: 'system-webhook-stone' },
              userRole: { stringValue: 'system' }
            }
          };
          await nativeRequest(auditUrl, 'POST', { 'Content-Type': 'application/json' }, auditPayload);
        } catch (auditErr) {
          console.error('[Webhook Stone] Erro ao registrar log de auditoria:', auditErr);
        }
      }
    }

    // Retorna 200 para a Stone parar de reenviar
    return res.status(200).json({ success: true, message: 'Notificação processada com sucesso.' });

  } catch (err) {
    console.error('[Webhook Stone] Erro no handler:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no processamento.' });
  }
}
