export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivering' | 'completed';

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
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    zipCode: string;
    complement?: string;
  };
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
}
