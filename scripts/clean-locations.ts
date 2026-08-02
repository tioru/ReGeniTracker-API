// scripts/clean-locations.ts
//
// Vérifie/corrige les fichiers déjà générés sous prisma/data/locations/{en,fr}/,
// à lancer après un run de scrape-locations.ts.
//
// Problème visé : le tableau `subLocations` d'un fichier FR est censé
// contenir les noms FR des enfants, mais peut contenir le nom EN brut resté
// non traduit (constaté sur 85 entrées après une fusion manuelle de deux
// runs concurrents de scrape-locations.ts — la table de correspondance
// EN->FR en mémoire du script perd alors des entrées que les fichiers
// individuels des enfants, eux, ont correctement). Plutôt que de refaire
// confiance à une table en mémoire, ce script relit le `name` réellement
// écrit dans chaque fichier enfant FR et l'utilise comme source de vérité.
//
// Usage :
//   npx ts-node --project tsconfig.scripts.json scripts/clean-locations.ts [--dry-run]

import fs from 'fs';
import path from 'path';

const EN_DIR = path.resolve(__dirname, '../prisma/data/locations/en');
const FR_DIR = path.resolve(__dirname, '../prisma/data/locations/fr');

const DRY_RUN = process.argv.includes('--dry-run');

interface LocationOutput {
  name: string;
  type: string;
  parent: string | null;
  description: string;
  image: string | null;
  subLocations: string[];
}

// Doit rester identique à slugify() dans scrape-locations.ts : c'est cette
// fonction qui détermine le nom de fichier de chaque lieu.
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function main() {
  const enFiles = fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.json'));

  let filesChanged = 0;
  let entriesFixed = 0;
  const missingFrFile: string[] = [];
  const lengthMismatch: string[] = [];
  const unresolvedChildren: string[] = [];

  for (const file of enFiles) {
    const frPath = path.join(FR_DIR, file);
    if (!fs.existsSync(frPath)) {
      missingFrFile.push(file);
      continue;
    }

    const en: LocationOutput = JSON.parse(fs.readFileSync(path.join(EN_DIR, file), 'utf8'));
    const fr: LocationOutput = JSON.parse(fs.readFileSync(frPath, 'utf8'));

    const enSubs = en.subLocations ?? [];
    const frSubs = fr.subLocations ?? [];

    if (enSubs.length !== frSubs.length) {
      lengthMismatch.push(`${file} (EN=${enSubs.length}, FR=${frSubs.length})`);
      continue;
    }

    let changed = false;
    const fixedSubs = frSubs.map((current, i) => {
      const enName = enSubs[i];
      const childSlug = slugify(enName);
      const childFrPath = path.join(FR_DIR, `${childSlug}.json`);

      if (!fs.existsSync(childFrPath)) {
        if (current === enName) {
          unresolvedChildren.push(`${file}: "${enName}" (pas de fichier FR ${childSlug}.json)`);
        }
        return current;
      }

      const childFr: LocationOutput = JSON.parse(fs.readFileSync(childFrPath, 'utf8'));
      if (childFr.name && childFr.name !== current) {
        changed = true;
        entriesFixed++;
        console.log(`  ${file}: "${current}" -> "${childFr.name}"`);
        return childFr.name;
      }
      return current;
    });

    if (changed) {
      filesChanged++;
      if (!DRY_RUN) {
        fr.subLocations = fixedSubs;
        fs.writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf-8');
      }
    }
  }

  console.log('\n── Résumé ──────────────────────────────');
  console.log(`Fichiers FR corrigés        : ${filesChanged}`);
  console.log(`Entrées subLocations corrigées : ${entriesFixed}`);
  if (DRY_RUN) console.log('(dry-run : aucun fichier écrit)');

  if (missingFrFile.length) {
    console.log(`\n⚠️  ${missingFrFile.length} fichier(s) EN sans fichier FR correspondant :`);
    console.log(missingFrFile.map((f) => `  - ${f}`).join('\n'));
  }
  if (lengthMismatch.length) {
    console.log(`\n⚠️  ${lengthMismatch.length} fichier(s) avec un nombre de subLocations différent entre EN et FR (non corrigés, à vérifier à la main) :`);
    console.log(lengthMismatch.map((f) => `  - ${f}`).join('\n'));
  }
  if (unresolvedChildren.length) {
    console.log(`\nℹ️  ${unresolvedChildren.length} entrée(s) restée(s) en anglais faute de fichier FR pour l'enfant :`);
    console.log(unresolvedChildren.map((f) => `  - ${f}`).join('\n'));
  }
}

main();
