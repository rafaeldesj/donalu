import https from 'https';

/**
 * Helper using Node native https to avoid fetch issues in serverless.
 */
function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed });
        } catch {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

/**
 * GET /api/point/devices?token=...
 * Lists all Mercado Pago Point terminals associated with the account.
 * Tries the current API first; falls back to legacy endpoint on error.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const token = req.query?.token;
    if (!token) {
      return res.status(400).json({ success: false, message: 'token é obrigatório.' });
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Try the new terminals API first
    let devices = [];
    let apiUsed = 'terminals_v1';

    const newApiRes = await nativeRequest(
      'https://api.mercadopago.com/terminals/v1/list?limit=50&offset=0',
      'GET',
      headers
    );

    if (newApiRes.ok && Array.isArray(newApiRes.json?.terminals)) {
      // Map new API response to our normalized format
      devices = newApiRes.json.terminals.map(t => ({
        id: t.id,
        external_id: t.id,
        operating_mode: t.operating_mode || 'STANDALONE',
        model: t.model || 'Unknown',
        serial_number: t.serial_number || '',
        store_id: t.store_id || '',
        pos_id: t.pos_id || '',
        external_store_id: t.external_store_id || '',
        external_pos_id: t.external_pos_id || ''
      }));
    } else {
      // Fallback: legacy Point Integration API
      apiUsed = 'point_integration_legacy';
      const legacyRes = await nativeRequest(
        'https://api.mercadopago.com/point/integration-api/devices',
        'GET',
        headers
      );

      if (!legacyRes.ok) {
        console.error('[Point Devices] Ambas as APIs falharam:', legacyRes.json);
        return res.status(400).json({
          success: false,
          message: legacyRes.json?.message || 'Não foi possível listar os dispositivos. Verifique se o token possui as permissões necessárias.',
          details: legacyRes.json
        });
      }

      // Legacy API returns { devices: [...] }
      const devList = legacyRes.json?.devices || legacyRes.json || [];
      devices = (Array.isArray(devList) ? devList : []).map(d => ({
        id: d.id,
        external_id: d.external_id || d.id,
        operating_mode: d.operating_mode || 'STANDALONE',
        model: d.model || 'Unknown',
        serial_number: d.serial_number || '',
        store_id: d.store_id || '',
        pos_id: d.pos_id || '',
        external_store_id: d.external_store_id || '',
        external_pos_id: d.external_pos_id || ''
      }));
    }

    return res.status(200).json({ success: true, devices, apiUsed });

  } catch (err) {
    console.error('[Point Devices] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao listar dispositivos.' });
  }
}
