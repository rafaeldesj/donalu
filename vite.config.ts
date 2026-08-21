import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
// @ts-ignore
import { processPaymentMiddleware, createPixMiddleware, checkPixMiddleware, createPointOrderMiddleware, checkPointOrderMiddleware, mpOAuthExchangeMiddleware, listPointDevicesMiddleware, setPointDeviceModeMiddleware, cancelPointOrderMiddleware, processMPCardOrderMiddleware, webhookMiddleware, pointUserMiddleware, pointStoresMiddleware, pointPosMiddleware } from './payment-middleware.js'
// @ts-ignore
import { createStonePixMiddleware, checkStonePixMiddleware, createStoneCardMiddleware, createStonePosOrderMiddleware, checkStonePosOrderMiddleware, cancelStonePosOrderMiddleware } from './stone-middleware.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    mkcert(),
    {
      name: 'pagbank-payment-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/pagamentos/process-payment' && req.method === 'POST') {
            processPaymentMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/create-pix') && req.method === 'POST') {
            createPixMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/check-pix') && req.method === 'GET') {
            checkPixMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/webhook') && req.method === 'POST') {
            webhookMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/create-point-order') && req.method === 'POST') {
            createPointOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/check-point-order') && req.method === 'GET') {
            checkPointOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/cancel-point-order') && req.method === 'POST') {
            cancelPointOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/mercadopago/exchange-token') && req.method === 'POST') {
            mpOAuthExchangeMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/devices') && req.method === 'GET') {
            listPointDevicesMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/set-mode') && req.method === 'PATCH') {
            setPointDeviceModeMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/create-mp-card-order') && req.method === 'POST') {
            processMPCardOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/user') && req.method === 'GET') {
            pointUserMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/stores')) {
            pointStoresMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/pos')) {
            pointPosMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/create-pix') && req.method === 'POST') {
            createStonePixMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/check-pix') && req.method === 'GET') {
            checkStonePixMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/create-card') && req.method === 'POST') {
            createStoneCardMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/create-pos') && req.method === 'POST') {
            createStonePosOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/check-pos') && req.method === 'GET') {
            checkStonePosOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/stone/cancel-pos') && req.method === 'POST') {
            cancelStonePosOrderMiddleware(req, res);
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    host: true,
  }
})
