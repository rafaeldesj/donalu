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
    const {
      token, // A Secret Key (sk_...) da conta Master (Desenvolvedor)
      name,
      email,
      document,
      type, // 'individual' | 'company'
      bank,
      branch_number,
      branch_check_digit,
      account_number,
      account_check_digit,
      account_type // 'checking' | 'savings'
    } = req.body;

    if (!token || !token.startsWith('sk_')) {
      return res.status(400).json({ success: false, message: 'Token (Secret Key) inválido ou ausente.' });
    }

    const stoneUrl = 'https://api.pagar.me/core/v5/recipients';
    const authHeader = 'Basic ' + Buffer.from(token + ':').toString('base64');
    
    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    };

    const cleanDocument = (document || '').replace(/\D/g, '');
    
    // type para Pagar.me V5 pode ser 'individual' ou 'company'. 
    // No register_information ele espera 'individual' ou 'corporation'.
    const registerType = type === 'company' ? 'corporation' : 'individual';

    const payload = {
      name: name,
      email: email,
      document: cleanDocument,
      type: type,
      default_bank_account: {
        holder_name: name,
        holder_type: type,
        holder_document: cleanDocument,
        bank: bank,
        branch_number: branch_number,
        branch_check_digit: branch_check_digit || '0',
        account_number: account_number,
        account_check_digit: account_check_digit || '0',
        type: account_type
      },
      transfer_settings: {
        transfer_enabled: true,
        transfer_interval: "daily"
      },
      register_information: {
        type: registerType,
        document: cleanDocument,
        name: name,
        email: email,
        site_url: "https://donalupastelaria.com.br", // URL fictícia caso não exista
        phone_numbers: [
          {
            type: "mobile",
            number: "999999999", // Mock ou pegar do payload
            area_code: "21",
            country_code: "55"
          }
        ]
      }
    };

    const response = await nativeRequest(stoneUrl, 'POST', headers, payload);

    if (!response.ok) {
      console.error('[Stone Recipient] Erro ao criar recebedor:', JSON.stringify(response.json, null, 2));
      return res.status(400).json({ 
        success: false, 
        message: response.json?.message || 'Erro ao criar recebedor na Stone.',
        details: response.json
      });
    }

    return res.status(200).json({
      success: true,
      recipientId: response.json.id
    });

  } catch (err) {
    console.error('[Stone Recipient] Erro interno:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao criar recebedor na Stone.' });
  }
}
