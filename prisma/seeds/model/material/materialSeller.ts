import { RestockType } from "@prisma/client";

export interface MaterialSellerData {
    name: string; 
    currency: string; 
    cost: number; 
    stock: number; 
    restock: RestockType;
}