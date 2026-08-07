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

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const token = req.query.token || req.body?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token é obrigatório.' });
  }

  try {
    if (action === 'user') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
      const response = await nativeRequest('https://api.mercadopago.com/users/me', 'GET', { 'Authorization': `Bearer ${token}` });
      if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao buscar dados do usuário.', error: response.json });
      return res.status(200).json({ success: true, user: response.json });
    }

    if (action === 'pos') {
      if (req.method === 'GET') {
        const response = await nativeRequest(`https://api.mercadopago.com/pos`, 'GET', { 'Authorization': `Bearer ${token}` });
        if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao buscar caixas (POS).', error: response.json });
        return res.status(200).json({ success: true, pos: response.json.results || [] });
      }
      if (req.method === 'POST') {
        const { name, store_id, external_store_id, external_id } = req.body || {};
        if (!name || !store_id || !external_store_id || !external_id) {
          return res.status(400).json({ success: false, message: 'Parâmetros obrigatórios ausentes para criar POS.' });
        }
        const payload = { name, fixed_amount: true, store_id: Number(store_id), external_store_id, external_id, category: 621102 };
        const response = await nativeRequest(`https://api.mercadopago.com/pos`, 'POST', { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, payload);
        if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao criar caixa (POS).', error: response.json });
        return res.status(200).json({ success: true, pos: response.json });
      }
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    if (action === 'stores') {
      if (req.method === 'GET') {
        const userId = req.query.userId || req.query.user_id;
        if (!userId) return res.status(400).json({ success: false, message: 'User ID obrigatório' });
        const response = await nativeRequest(`https://api.mercadopago.com/users/${userId}/stores/search`, 'GET', { 'Authorization': `Bearer ${token}` });
        if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao buscar lojas.', error: response.json });
        return res.status(200).json({ success: true, stores: response.json.results || [] });
      }
      if (req.method === 'POST') {
        const userId = req.body?.user_id || req.body?.userId;
        const name = req.body?.name;
        if (!userId || !name) return res.status(400).json({ success: false, message: 'User ID e name são obrigatórios.' });
        const payload = {
          name,
          location: req.body?.location || {
            street_number: "239", street_name: "Rua Jicara", city_name: "Rio de Janeiro", state_name: "Rio de Janeiro", latitude: -22.9035, longitude: -43.2096, reference: "Dona Lu Pastelaria"
          }
        };
        const response = await nativeRequest(`https://api.mercadopago.com/users/${userId}/stores`, 'POST', { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, payload);
        if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao criar loja.', error: response.json });
        return res.status(200).json({ success: true, store: response.json });
      }
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    if (action === 'devices') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
      const response = await nativeRequest(`https://api.mercadopago.com/point/integration-api/devices`, 'GET', { 'Authorization': `Bearer ${token}` });
      if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao listar dispositivos.', error: response.json });
      return res.status(200).json({ success: true, devices: response.json.devices || [] });
    }

    if (action === 'set-mode') {
      if (req.method !== 'PATCH') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
      const { deviceId, operatingMode } = req.body || {};
      if (!deviceId || !operatingMode) return res.status(400).json({ success: false, message: 'deviceId e operatingMode são obrigatórios.' });
      
      const response = await nativeRequest(`https://api.mercadopago.com/point/integration-api/devices/${deviceId}`, 'PATCH', {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }, { operating_mode: operatingMode });

      if (!response.ok) return res.status(400).json({ success: false, message: 'Erro ao alterar modo de operação.', error: response.json });
      return res.status(200).json({ success: true, device: response.json });
    }

    return res.status(404).json({ success: false, message: 'Action not found' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro interno.', error: String(error) });
  }
}
