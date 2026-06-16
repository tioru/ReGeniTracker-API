import { RestockType } from "@prisma/client";

export interface WeaponSellerData {
    name: string; 
    currency: string; 
    cost: number; 
    stock: number; 
    restock: RestockType;
}