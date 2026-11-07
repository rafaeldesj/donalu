export type OrderStatus = 'pending' | 'preparing' | 'prepared' | 'ready' | 'delivering' | 'completed' | 'cancelled' | 'aguardando_caixa' | 'pendente_pagamento' | 'awaiting_payment' | 'building_cart' | 'merged' | 'abandoned';

/** Grupo de opções de um produto (ex.: "Molho": Carne Assada / Bolonhesa). Configurado pelo gerente no cardápio. */
export interface ProductOptionGroup {
  id: string;
  title: string;
  required: boolean;
  options: string[];
}

/** Escolha feita pelo cliente em um grupo de opções do produto. */
export interface SelectedOption {
  group: string;
  choice: string;
}

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
  selectedOptions?: SelectedOption[];
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
  pointPaymentIntentId?: string;
  pointPaymentStatus?: string;
  pixPaymentStatus?: string;
  paymentStatus?: string;
  paymentVerificationToken?: string;
  satisfactionRating?: number;
  satisfactionFeedback?: string;
  stonePaymentId?: string;
}
