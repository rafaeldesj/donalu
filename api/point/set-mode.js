import https from 'https';

/**
 * Helper using Node native https to avoid fetch issues in serverless.
 */
function nativeRequest(url, method, headers, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null;
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {})
      }
    };

    const req = https.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resBody);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed });
        } catch {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: resBody });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * PATCH /api/point/set-mode
 * Body: { token, deviceId, mode: "PDV" | "STANDALONE" }
 *
 * Changes the operating mode of a Mercado Pago Point terminal.
 * Tries both the new and legacy APIs for maximum compatibility.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { token, deviceId, mode } = req.body || {};

    if (!token) return res.status(400).json({ success: false, message: 'token é obrigatório.' });
    if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId é obrigatório.' });
    if (!['PDV', 'STANDALONE'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'mode deve ser "PDV" ou "STANDALONE".' });
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Try legacy Point Integration API first (more widely supported for mode changes)
    const legacyRes = await nativeRequest(
      `https://api.mercadopago.com/point/integration-api/devices/${deviceId}`,
      'PATCH',
      headers,
      { operating_mode: mode }
    );

    if (legacyRes.ok) {
      console.log(`[Point SetMode] Modo ${mode} aplicado ao dispositivo ${deviceId} via legacy API`);
      return res.status(200).json({
        success: true,
        deviceId,
        mode,
        message: `Modo ${mode === 'PDV' ? 'PDV (Integrado)' : 'Autônomo'} ativado com sucesso.`
      });
    }

    // Fallback: new terminals API
    const newApiRes = await nativeRequest(
      'https://api.mercadopago.com/terminals/v1/setup',
      'PATCH',
      headers,
      { terminal_id: deviceId, operating_mode: mode }
    );

    if (!newApiRes.ok) {
      const errMsg = newApiRes.json?.message || 'Erro ao alterar modo do dispositivo.';
      console.error(`[Point SetMode] Falha ao alterar modo do dispositivo ${deviceId}:`, newApiRes.json);
      return res.status(400).json({
        success: false,
        message: errMsg,
        hint: 'Verifique se o token possui permissão de escrita (write:pos) e se a maquininha está conectada.',
        details: newApiRes.json
      });
    }

    console.log(`[Point SetMode] Modo ${mode} aplicado ao dispositivo ${deviceId} via new API`);
    return res.status(200).json({
      success: true,
      deviceId,
      mode,
      message: `Modo ${mode === 'PDV' ? 'PDV (Integrado)' : 'Autônomo'} ativado com sucesso.`
    });

  } catch (err) {
    console.error('[Point SetMode] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao alterar modo do dispositivo.' });
  }
}
