export type UserRole = 'developer' | 'owner' | 'manager' | 'staff' | 'client';

export interface StaffFunctions {
  cook: boolean;       // Cozinheiro
  attendant: boolean;  // Atendente
  cashier: boolean;    // Caixa
}

export interface UserAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  zipCode: string;
  complement?: string;
}

export interface UserDocument {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  phoneNumber?: string;
  staffFunctions?: StaffFunctions;
  clientAddress?: UserAddress;
}
