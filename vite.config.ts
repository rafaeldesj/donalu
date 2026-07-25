import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
// @ts-ignore
import { processPaymentMiddleware, createPixMiddleware, checkPixMiddleware, createPointOrderMiddleware, checkPointOrderMiddleware, mpOAuthExchangeMiddleware, listPointDevicesMiddleware, setPointDeviceModeMiddleware } from './payment-middleware.js'

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
          } else if (req.url?.startsWith('/api/pagamentos/create-point-order') && req.method === 'POST') {
            createPointOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/pagamentos/check-point-order') && req.method === 'GET') {
            checkPointOrderMiddleware(req, res);
          } else if (req.url?.startsWith('/api/mercadopago/exchange-token') && req.method === 'POST') {
            mpOAuthExchangeMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/devices') && req.method === 'GET') {
            listPointDevicesMiddleware(req, res);
          } else if (req.url?.startsWith('/api/point/set-mode') && req.method === 'PATCH') {
            setPointDeviceModeMiddleware(req, res);
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
