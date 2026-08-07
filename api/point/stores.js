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
      const { token, user_id } = req.query;
      if (!token || !user_id) return res.status(400).json({ success: false, message: 'Token e user_id são obrigatórios.' });

      const response = await nativeRequest(`https://api.mercadopago.com/users/${user_id}/stores/search`, 'GET', {
        'Authorization': `Bearer ${token}`
      });

      if (!response.ok) {
        return res.status(400).json({ success: false, message: 'Erro ao buscar lojas.', error: response.json });
      }

      return res.status(200).json({ success: true, stores: response.json.results || [] });
    }

    if (req.method === 'POST') {
      const { token, user_id, name, location } = req.body;
      if (!token || !user_id || !name) return res.status(400).json({ success: false, message: 'Token, user_id e name são obrigatórios.' });

      const payload = {
        name,
        location: location || {
          street_number: "239",
          street_name: "Rua Jicara",
          city_name: "Rio de Janeiro",
          state_name: "Rio de Janeiro",
          latitude: -22.9035,
          longitude: -43.2096,
          reference: "Dona Lu Pastelaria"
        }
      };

      const response = await nativeRequest(`https://api.mercadopago.com/users/${user_id}/stores`, 'POST', {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }, payload);

      if (!response.ok) {
        return res.status(400).json({ success: false, message: 'Erro ao criar loja.', error: response.json });
      }

      return res.status(200).json({ success: true, store: response.json });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (error) {
    console.error('Erro stores API:', error);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
}
