import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';
import { seedCharacters } from './seeds/character.seed';
import { seedMaterials } from './seeds/material.seed';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await seedMaterials(prisma);  // en premier — les personnages en dépendent
  await seedCharacters(prisma);
  await seedWeapons(prisma);    // avant banners — les bannières référencent Weapon.name
  await seedBanners(prisma);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });