const https = require('https');
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
async function run() {
  const url = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/settings/store_config';
  const res = await nativeRequest(url, 'GET', {});
  const token = res.json.fields.storeOwnerAccessToken.stringValue;
  
  const stoneUrl = 'https://api.pagar.me/core/v5/orders/or_9zR2GRszNUWNAnLd';
  const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
  const response = await nativeRequest(stoneUrl, 'GET', { 'Authorization': authHeader });
  console.log(JSON.stringify(response.json, null, 2));
}
run();
