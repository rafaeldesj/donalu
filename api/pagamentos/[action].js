import cancelPointOrder from '../_pagamentos/cancel-point-order.js';
import checkPix from '../_pagamentos/check-pix.js';
import checkPointOrder from '../_pagamentos/check-point-order.js';
import createMpCardOrder from '../_pagamentos/create-mp-card-order.js';
import createPix from '../_pagamentos/create-pix.js';
import createPointOrder from '../_pagamentos/create-point-order.js';
import getPaymentFees from '../_pagamentos/get-payment-fees.js';
import processPayment from '../_pagamentos/process-payment.js';
import refundPayment from '../_pagamentos/refund-payment.js';
import stoneCreateCard from '../_pagamentos/stone-create-card.js';
import stoneCreatePix from '../_pagamentos/stone-create-pix.js';
import stoneCreateRecipient from '../_pagamentos/stone-create-recipient.js';
import stoneWebhook from '../_pagamentos/stone-webhook.js';
import webhook from '../_pagamentos/webhook.js';

const routes = {
  'cancel-point-order': cancelPointOrder,
  'check-pix': checkPix,
  'check-point-order': checkPointOrder,
  'create-mp-card-order': createMpCardOrder,
  'create-pix': createPix,
  'create-point-order': createPointOrder,
  'get-payment-fees': getPaymentFees,
  'process-payment': processPayment,
  'refund-payment': refundPayment,
  'stone-create-card': stoneCreateCard,
  'stone-create-pix': stoneCreatePix,
  'stone-create-recipient': stoneCreateRecipient,
  'stone-webhook': stoneWebhook,
  'webhook': webhook
};

export default async function handler(req, res) {
  const { action } = req.query;

  const routeHandler = routes[action];
  
  if (routeHandler) {
    return routeHandler(req, res);
  } else {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
}
