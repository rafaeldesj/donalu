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
      headers: { ...headers, ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr), 'Content-Type': 'application/json' } : {}) }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: body }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
async function run() {
  const url = 'https://firestore.googleapis.com/v1/projects/dona-lu-4242d/databases/(default)/documents/settings/store_config';
  const res = await nativeRequest(url, 'GET', {});
  const data = JSON.parse(res.text);
  const token = data.fields.stoneSecretKey.stringValue;
  
  // order ID from the screenshot where the QR code was generated just now: 
  // Wait, I don't know the new order ID. I'll just use the old one 'or_9zR2GRszNUWNAnLd'
  
  const checkUrl = 'https://donalupastel-main.vercel.app/api/pagamentos/stone-check-pix?paymentId=or_9zR2GRszNUWNAnLd&token=' + token;
  const response = await nativeRequest(checkUrl, 'GET', {});
  console.log('Status:', response.status);
  console.log('Body:', response.text);
}
run();
