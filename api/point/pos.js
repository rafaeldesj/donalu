import https from 'https';

function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = data ? JSON.stringify(data) : null;
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

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { token } = req.query;
      if (!token) return res.status(400).json({ success: false, message: 'Token é obrigatório.' });

      // O Mercado Pago pagina os caixas, mas geralmente traz os primeiros
      const response = await nativeRequest(`https://api.mercadopago.com/pos`, 'GET', {
        'Authorization': `Bearer ${token}`
      });

      if (!response.ok) {
        return res.status(400).json({ success: false, message: 'Erro ao buscar caixas (POS).', error: response.json });
      }

      return res.status(200).json({ success: true, pos: response.json.results || [] });
    }

    if (req.method === 'POST') {
      const { token, name, store_id, external_store_id, external_id } = req.body;
      if (!token || !name || !store_id || !external_store_id || !external_id) {
        return res.status(400).json({ success: false, message: 'Parâmetros obrigatórios ausentes para criar POS.' });
      }

      const payload = {
        name,
        fixed_amount: true,
        store_id: Number(store_id),
        external_store_id,
        external_id,
        category: 621102 // Restaurante / Fast Food
      };

      const response = await nativeRequest(`https://api.mercadopago.com/pos`, 'POST', {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }, payload);

      if (!response.ok) {
        return res.status(400).json({ success: false, message: 'Erro ao criar caixa (POS).', error: response.json });
      }

      return res.status(200).json({ success: true, pos: response.json });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (error) {
    console.error('Erro pos API:', error);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
}
