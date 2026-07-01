export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivering' | 'completed' | 'cancelled' | 'aguardando_caixa' | 'pendente_pagamento';

export interface OrderItem {
  id: number;
  name: string;
  price: number; // Numérico para cálculos
  quantity: number;
}

export interface OrderDocument {
  id?: string;
  clientUid: string;
  clientName: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  orderType?: 'pickup' | 'delivery' | 'dine_in';
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
  changeFor?: number | null;
}
