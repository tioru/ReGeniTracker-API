// scripts/apply-creature-overrides.ts
//
// scrape-creatures.ts réécrit intégralement chaque fichier de
// prisma/data/creatures/{en,fr}/ à chaque --fetch/--fetch-category/--cache :
// toute correction faite après coup (à la main ou via
// scrape-creatures-gamedata.ts --apply) est perdue au prochain re-scraping
// (même limite que scrape-food.ts, cf. apply-food-overrides.ts). Cas
// rencontré le 2026-08-14 : parseFrFishInfobox retombe TOUJOURS sur
// enFallback.family pour les poissons FR (pas de champ famille exploitable
// dans {{Infobox objet}}), donc ces fichiers reçoivent systématiquement la
// valeur anglaise ("Fish" au lieu de "Animaux aquatiques") à chaque
// re-scraping tant que le scraper lui-même n'est pas corrigé — d'où la
// régression du commit 31c29058 qui avait effacé les corrections de family
// faites juste avant par 598847aa/afe21517.
//
// Ce script applique des valeurs de champs vérifiées, stockées séparément
// dans scripts/data/creature-overrides.json — jamais touché par
// scrape-creatures.ts — et jamais perdues : il suffit de relancer ce script
// après chaque --fetch/--fetch-category pour les réappliquer. Le contenu
// initial (56 family + 1 name) vient de scrape-creatures-gamedata.ts
// --apply ; il peut aussi être relancé pour regénérer les mêmes valeurs
// après un re-scraping (cf. son propre header), ce fichier sert de filet en
// plus, notamment pour les 5 créatures non résolues dans les données minées
// où ce recours n'est pas disponible.
//
// Format de scripts/data/creature-overrides.json :
//   {
//     "<nom de fichier sans .json, ex: forest_boar>": {
//       "en": { "<champ ou chemin pointé>": "valeur" },
//       "fr": { "...": "..." }
//     },
//     ...
//   }
// Un seul des deux champs "en"/"fr" peut être renseigné. Chaque clé de champ
// accepte un chemin pointé pour cibler un champ imbriqué. La valeur doit
// déjà exister dans le fichier (aucune création de structure manquante) —
// pensé pour corriger, pas pour générer des fichiers.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/apply-creature-overrides.ts [--dry-run]

import fs from 'fs';
import path from 'path';

const EN_DIR = path.resolve(__dirname, '../prisma/data/creatures/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/creatures/fr');
const OVERRIDES_PATH = path.resolve(__dirname, './data/creature-overrides.json');

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
  console.log(`Créatures avec overrides définis : ${entries.length}`);
  console.log(`Fichiers modifiés                : ${filesTouched}`);
  console.log(`Champs appliqués                 : ${fieldsApplied}`);
  if (DRY_RUN) console.log('(dry-run : aucun fichier écrit)');
}

main();
