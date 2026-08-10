// scripts/link-food-images.ts
//
// Relie les fichiers prisma/data/foods/{en,fr}/*.json aux icônes déjà
// téléchargées par scripts/scrape-food-images.ts dans assets/foods/<slug>/.
// N'effectue aucun fetch réseau : lecture pure du disque.
//
// Ajoute (ou met à jour) 3 champs non traduits sur chaque fichier — imgNormal
// est toujours renseigné, imgDelicious/imgSuspicious restent `null` pour les
// plats à qualité fixe (potions, ingrédients bruts, cf. NOTE de
// prisma/schema/food.prisma) faute de palier correspondant sur le disque.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/link-food-images.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_DIR = path.resolve(__dirname, '../prisma/data/foods/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/foods/fr');
const ASSETS_DIR = path.resolve(__dirname, '../assets/foods');
const WEB_PREFIX = '/assets/foods';

const TIERS = ['normal', 'delicious', 'suspicious'] as const;
type Tier = (typeof TIERS)[number];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// assets/foods/<slug>/normal.png -> "/assets/foods/<slug>/normal.png" (extension
// lue sur disque, pas supposée fixe : scrape-food-images.ts la dérive de l'URL wikia).
function findTierImage(slug: string, tier: Tier): string | null {
  const dir = path.join(ASSETS_DIR, slug);
  if (!fs.existsSync(dir)) return null;

  const match = fs.readdirSync(dir).find((f) => path.parse(f).name === tier);
  return match ? `${WEB_PREFIX}/${slug}/${match}` : null;
}

function updateFoodFile(filePath: string, images: Record<Tier, string | null>): void {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  delete data.imgNormal;
  delete data.imgDelicious;
  delete data.imgSuspicious;
  data.assets = {
    NORMAL: images.normal,
    DELICIOUS: images.delicious,
    SUSPICIOUS: images.suspicious,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function main() {
  const enFiles = fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.json'));

  let linked = 0;
  let missing = 0;

  for (const fileName of enFiles) {
    const enPath = path.join(EN_DIR, fileName);
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    const pageTitle: string | undefined = enData.pageTitle;

    if (!pageTitle) {
      console.warn(`⚠️  "${fileName}": pas de pageTitle, ignoré.`);
      continue;
    }

    const slug = slugify(pageTitle);
    const images = {
      normal: findTierImage(slug, 'normal'),
      delicious: findTierImage(slug, 'delicious'),
      suspicious: findTierImage(slug, 'suspicious'),
    };

    if (!images.normal) {
      missing++;
      console.warn(`⚠️  "${pageTitle}" (${slug}): aucune image "normal" trouvée dans assets/foods/.`);
    } else {
      linked++;
    }

    updateFoodFile(enPath, images);

    const frPath = path.join(FR_DIR, fileName);
    if (fs.existsSync(frPath)) {
      updateFoodFile(frPath, images);
    }
  }

  console.log(`\n✅ ${linked} plat(s) lié(s) à au moins une image, ${missing} sans image "normal" trouvée.`);
}

main();
