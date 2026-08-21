// stone-middleware.js
import fs from 'fs';
import path from 'path';

// Função utilitária para ler o corpo da requisição JSON com segurança em middlewares Node
function parseJsonBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      try {
        return resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
      } catch (e) {
        return resolve({});
      }
    }
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch(e) { resolve({}); }
    });
    if (req.readableEnded || req.complete) {
      try { resolve(body ? JSON.parse(body) : {}); } catch(e) { resolve({}); }
    }
  });
}

// Global state for mock payments
if (!global.mockStonePayments) {
  global.mockStonePayments = {};
}

// Middlewares - Mock Implementation
export const createStonePixMiddleware = async (req, res) => {
  const data = await parseJsonBody(req);
  console.log('[Stone Pix Mock] Gerando PIX simulado...', data);
  
  const paymentId = 'STONE_PIX_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
  
  global.mockStonePayments[paymentId] = {
    status: 'pending',
    createdAt: Date.now()
  };

  // Simula latência
  await new Promise(resolve => setTimeout(resolve, 800));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    success: true,
    paymentId,
    qrCode: '00020101021226870014br.gov.bcb.pix2565qr-mock-code-stone-1234567890',
    qrCodeBase64: '',
    status: 'pending',
    isMock: true
  }));
};

export const checkStonePixMiddleware = async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const paymentId = urlObj.searchParams.get('paymentId');

  console.log('[Stone Pix Status] Verificando PIX simulado...', paymentId);

  const mockPay = global.mockStonePayments[paymentId];
  if (mockPay) {
    // Aprova automaticamente após 5 segundos
    if (Date.now() - mockPay.createdAt > 5000) {
      mockPay.status = 'approved';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, status: mockPay.status, isMock: true }));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ success: false, message: 'Payment not found in mock state' }));
};

export const createStoneCardMiddleware = async (req, res) => {
  const data = await parseJsonBody(req);
  console.log('[Stone Card Mock] Processando cartão simulado...', data);

  // Simula latência
  await new Promise(resolve => setTimeout(resolve, 1200));

  const chargeId = 'STONE_CARD_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    success: true,
    chargeId,
    status: 'approved',
    isMock: true
  }));
};

export const createStonePosOrderMiddleware = async (req, res) => {
  const data = await parseJsonBody(req);
  console.log('[Stone POS Mock] Criando pedido no terminal físico...', data);

  const intentId = 'STONE_POS_MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
  
  global.mockStonePayments[intentId] = {
    status: 'OPEN',
    createdAt: Date.now()
  };

  // Simula latência
  await new Promise(resolve => setTimeout(resolve, 600));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    success: true,
    intentId,
    status: 'OPEN',
    isMock: true
  }));
};

export const checkStonePosOrderMiddleware = async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const intentId = urlObj.searchParams.get('intentId');

  console.log('[Stone POS Status] Verificando terminal simulado...', intentId);

  const mockIntent = global.mockStonePayments[intentId];
  if (mockIntent) {
    // Aprova automaticamente após 8 segundos
    if (Date.now() - mockIntent.createdAt > 8000) {
      mockIntent.status = 'FINISHED';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, status: mockIntent.status, isMock: true }));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ success: false, message: 'Intent not found in mock state' }));
};

export const cancelStonePosOrderMiddleware = async (req, res) => {
  const data = await parseJsonBody(req);
  const { intentId } = data;
  
  console.log('[Stone POS Cancel] Cancelando terminal simulado...', intentId);

  if (global.mockStonePayments[intentId]) {
    global.mockStonePayments[intentId].status = 'CANCELED';
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ success: true, message: 'Pagamento simulado cancelado.' }));
};
