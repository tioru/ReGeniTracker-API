import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';
import { seedCharacters } from './seeds/character.seed';
import { seedMaterials } from './seeds/material.seed';
import { seedWeapons } from './seeds/weapon.seed';
import { seedBanners } from './seeds/banner.seed';
import { seedCreatures } from './seeds/creature.seed';
import { seedFood } from './seeds/food.seed';
import { seedLocations } from './seeds/location.seed';
import { seedArtifacts } from './seeds/artifact.seed';
import { seedBooks } from './seeds/book.seed';
import { seedEnemies } from './seeds/enemy.seed';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await seedMaterials(prisma);  // en premier — les personnages en dépendent
  await seedCharacters(prisma);
  await seedWeapons(prisma);    // avant banners — les bannières référencent Weapon.name
  await seedBanners(prisma);
  await seedCreatures(prisma);
  await seedFood(prisma);       // après characters — les plats spéciaux référencent Character
  await seedLocations(prisma);
  await seedArtifacts(prisma);  // aucune dépendance vers les autres entités
  await seedBooks(prisma);      // aucune dépendance vers les autres entités
  await seedEnemies(prisma);    // aucune dépendance vers les autres entités (drops/récompenses en String[] non liés en FK)
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });