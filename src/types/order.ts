export type OrderStatus = 'pending' | 'preparing' | 'prepared' | 'ready' | 'delivering' | 'completed' | 'cancelled' | 'aguardando_caixa' | 'pendente_pagamento' | 'awaiting_payment' | 'building_cart';

export interface OrderItem {
  id: number;
  name: string;
  price: number; // Numérico para cálculos
  quantity: number;
  category?: string;
  size?: 'grande' | 'kids';
  withCatupiry?: boolean;
  withBorda?: boolean;
  bordaType?: 'queijo' | 'kitkat_preto' | 'kitkat_branco' | 'kitkat' | 'sem_borda' | null;
  cheeseOption?: 'catupiry' | 'cheddar' | 'cream_cheese' | null;
  sweetChocolateOption?: 'preto' | 'branco' | null;
  sweetCheeseOption?: 'minas' | 'mussarela' | null;
  ingredients?: string[];
}

export interface OrderDocument {
  id?: string;
  clientUid: string;
  clientName: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  orderType?: 'pickup' | 'delivery' | 'dine_in' | 'dine_in_table' | 'pdv';
  packForTakeout?: boolean;
  tableNumber?: string | null;
  deliveryFee?: number;
  serviceFee?: number;
  address?: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    zipCode: string;
    complement?: string;
  } | null;
  deliveryUid?: string;
  deliveryName?: string;
  deliveryCoords?: {
    lat: number;
    lng: number;
  };
  clientCoords?: {
    lat: number;
    lng: number;
  };
  clientPhone?: string;
  dailySeq?: number;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  paymentMethod?: string | null;
  payments?: { method: string, amount: number, id?: string, payerName?: string }[];
  changeFor?: number | null;
  kitchenEnteredAt?: string;
  kitchenFinishedAt?: string;
  kitchenDurationSeconds?: number;
  dispatchedAt?: string;
  deliveredAt?: string;
  routeOrder?: number | null;
  refunded?: boolean;
  refundedAt?: string;
  refundedBy?: string;
  mercadoPagoPaymentId?: string;
  mercadoPagoOrderId?: string;
  satisfactionRating?: number;
  satisfactionFeedback?: string;
}
