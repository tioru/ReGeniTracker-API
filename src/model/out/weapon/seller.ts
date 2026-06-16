import { RestockType } from '@prisma/client';

export interface WeaponSellerOut {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: RestockType;
}