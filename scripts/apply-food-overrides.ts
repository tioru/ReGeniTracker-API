// scripts/apply-food-overrides.ts
//
// scrape-food.ts réécrit intégralement chaque fichier de
// prisma/data/foods/{en,fr}/ à chaque --fetch/--fetch-category/--cache :
// toute correction faite à la main directement dans ces fichiers est perdue
// au prochain re-scraping (même limite que scrape-locations.ts, cf.
// apply-location-description-overrides.ts). Cas rencontrés :
//   - specialDish.character garde toujours l'orthographe EN du template
//     {{Special Dish|Personnage|Nom}} même côté sortie FR (le scraper part du
//     principe que le nom ne se traduit pas) — faux pour 6 personnages dont
//     le wiki FR accentue/modifie le nom (Émilie, Rosalia, Noëlle, Fréminet,
//     Nomade, Thomas).
//   - recipeHint EN reste `null` quand le champ infobox `recipe`/`formula`
//     ne contient qu'un template `{{Sold By|...}}` qui disparaît entièrement
//     au nettoyage wikitext, alors que l'équivalent FR (`recette`) est du
//     texte libre déjà résolu — laissé tel quel côté EN par prudence (cf.
//     commentaire dans buildFoodOutput), comblé ici à la main après
//     vérification manuelle du vendeur de recette.
//
// Ce script applique des valeurs de champs écrites/vérifiées à la main,
// stockées séparément dans scripts/data/food-overrides.json — jamais touché
// par scrape-food.ts — et jamais perdues : il suffit de relancer ce script
// après chaque --fetch/--fetch-category pour les réappliquer.
//
// Pipeline complet après un re-scraping :
//   1) npx ts-node --project tsconfig.scripts.json scripts/scrape-food.ts --fetch-category
//   2) npx ts-node --project tsconfig.scripts.json scripts/apply-food-overrides.ts
//
// Format de scripts/data/food-overrides.json :
//   {
//     "<nom de fichier sans .json, ex: miso_soup>": {
//       "en": { "<champ ou chemin pointé, ex: specialDish.character>": "valeur" },
//       "fr": { "...": "..." }
//     },
//     ...
//   }
// Un seul des deux champs "en"/"fr" peut être renseigné. Chaque clé de champ
// accepte un chemin pointé pour cibler un champ imbriqué (ex:
// "specialDish.character"). La valeur doit déjà exister dans le fichier
// (aucune création de structure manquante) — pensé pour corriger, pas pour
// générer des fichiers.
//
// Usage :
//   npx ts-node --project tsconfig.scripts.json scripts/apply-food-overrides.ts [--dry-run]

import fs from 'fs';
import path from 'path';

const EN_DIR = path.resolve(__dirname, '../prisma/data/foods/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/foods/fr');
const OVERRIDES_PATH = path.resolve(__dirname, './data/food-overrides.json');

const DRY_RUN = process.argv.includes('--dry-run');

type FieldOverrides = Record<string, string>;
type Overrides = Record<string, { en?: FieldOverrides; fr?: FieldOverrides }>;

function getAtPath(obj: Record<string, unknown>, fieldPath: string): unknown {
  return fieldPath.split('.').reduce<unknown>((cur, key) => {
    if (cur === null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function setAtPath(obj: Record<string, unknown>, fieldPath: string, value: string): boolean {
  const keys = fieldPath.split('.');
  const last = keys.pop()!;
  let cur: Record<string, unknown> = obj;
  for (const key of keys) {
    const next = cur[key];
    if (next === null || typeof next !== 'object') return false;
    cur = next as Record<string, unknown>;
  }
  if (!(last in cur)) return false;
  cur[last] = value;
  return true;
}

function applyOne(dir: string, file: string, lang: 'en' | 'fr', fields: FieldOverrides): number {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${lang}/${file} introuvable, overrides ignorés.`);
    return 0;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  let applied = 0;

  for (const [fieldPath, value] of Object.entries(fields)) {
    if (getAtPath(data, fieldPath) === value) continue; // déjà en place
    if (!setAtPath(data, fieldPath, value)) {
      console.warn(`⚠️  ${lang}/${file}: chemin "${fieldPath}" introuvable dans le fichier, override ignoré.`);
      continue;
    }
    console.log(`  ${lang}/${file}: ${fieldPath} = "${value}"`);
    applied++;
  }

  if (applied > 0 && !DRY_RUN) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
  return applied;
}

function main() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    console.log("Aucun fichier d'overrides trouvé, rien à faire.");
    return;
  }

  const overrides: Overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  const entries = Object.entries(overrides);

  let filesTouched = 0;
  let fieldsApplied = 0;
  for (const [slug, { en, fr }] of entries) {
    const file = `${slug}.json`;
    if (en) {
      const n = applyOne(EN_DIR, file, 'en', en);
      if (n > 0) filesTouched++;
      fieldsApplied += n;
    }
    if (fr) {
      const n = applyOne(FR_DIR, file, 'fr', fr);
      if (n > 0) filesTouched++;
      fieldsApplied += n;
    }
  }

  console.log('\n── Résumé ──────────────────────────────');
  console.log(`Plats avec overrides définis : ${entries.length}`);
  console.log(`Fichiers modifiés            : ${filesTouched}`);
  console.log(`Champs appliqués             : ${fieldsApplied}`);
  if (DRY_RUN) console.log('(dry-run : aucun fichier écrit)');
}

main();
