// scripts/apply-location-description-overrides.ts
//
// scrape-locations.ts réécrit intégralement chaque fichier de
// prisma/data/locations/{en,fr}/ à chaque --fetch : toute correction faite
// à la main directement dans ces fichiers est perdue au prochain re-scraping
// complet (cf. audit : 78 lieux Area/Subarea sans description EN à la
// source sur le wiki, dont certains n'ont côté FR qu'une phrase générique).
//
// Ce script applique des descriptions écrites/traduites à la main, stockées
// séparément dans scripts/data/location-description-overrides.json — jamais
// touché par scrape-locations.ts — et jamais perdues : il suffit de relancer
// ce script après chaque --fetch pour les réappliquer.
//
// Pipeline complet après un re-scraping :
//   1) npx ts-node --project tsconfig.scripts.json scripts/scrape-locations.ts --fetch
//   2) npx ts-node --project tsconfig.scripts.json scripts/clean-locations.ts
//   3) npx ts-node --project tsconfig.scripts.json scripts/apply-location-description-overrides.ts
//
// Format de scripts/data/location-description-overrides.json :
//   {
//     "<nom de fichier sans .json, ex: ashavan_realm>": {
//       "en": "Texte EN (optionnel)",
//       "fr": "Texte FR (optionnel)"
//     },
//     ...
//   }
// Un seul des deux champs "en"/"fr" peut être renseigné si l'autre langue a
// déjà une description correcte côté wiki.
//
// Usage :
//   npx ts-node --project tsconfig.scripts.json scripts/apply-location-description-overrides.ts [--dry-run]

import fs from 'fs';
import path from 'path';

const EN_DIR = path.resolve(__dirname, '../prisma/data/locations/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/locations/fr');
const OVERRIDES_PATH = path.resolve(__dirname, './data/location-description-overrides.json');

const DRY_RUN = process.argv.includes('--dry-run');

interface LocationOutput {
  name: string;
  type: string;
  parent: string | null;
  description: string;
  image: string | null;
  subLocations: string[];
  descriptionSource?: 'manual';
}

type Overrides = Record<string, { en?: string; fr?: string }>;

function applyOne(dir: string, file: string, lang: 'en' | 'fr', text: string): boolean {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${lang}/${file} introuvable, override ignoré.`);
    return false;
  }

  const data: LocationOutput = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.description === text && data.descriptionSource === 'manual') return false;

  data.description = text;
  data.descriptionSource = 'manual';

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
  console.log(`  ${lang}/${file}: description manuelle appliquée`);
  return true;
}

function main() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    console.log('Aucun fichier d\'overrides trouvé, rien à faire.');
    return;
  }

  const overrides: Overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  const entries = Object.entries(overrides);

  let applied = 0;
  for (const [slug, { en, fr }] of entries) {
    const file = `${slug}.json`;
    if (en?.trim()) applied += applyOne(EN_DIR, file, 'en', en.trim()) ? 1 : 0;
    if (fr?.trim()) applied += applyOne(FR_DIR, file, 'fr', fr.trim()) ? 1 : 0;
  }

  console.log('\n── Résumé ──────────────────────────────');
  console.log(`Overrides définis : ${entries.length}`);
  console.log(`Fichiers modifiés : ${applied}`);
  if (DRY_RUN) console.log('(dry-run : aucun fichier écrit)');
}

main();
