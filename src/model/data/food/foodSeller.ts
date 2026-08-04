import { RestockType } from "@prisma/client";

export interface FoodSellerData {
    name: string;
    currency: string;
    cost: number;
    stock: number;
    restock: RestockType;
}
