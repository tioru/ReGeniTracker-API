// scripts/scrape-creatures.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fetchCategoryMembers,
  fetchWikitextWithLanglink,
  fetchFrWikitext,
  sleep,
} from './lib/wiki-fetch';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/creatures/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Category:Wildlife liste directement ~200 pages individuelles (pas de
// sous-catégories à parcourir séparément, contrairement à Category:Enemies) :
// une seule requête paginée suffit (fetchCategoryMembers, comme
// scrape-books.ts/scrape-domains.ts). Deux sous-catégories techniques
// apparaissent aussi dans les résultats (Category:Wildlife Families,
// Category:Wildlife Groups, ns=14) : elles sont naturellement filtrées par
// fetchCategoryMembers (ns !== 0).
//
// Chaque fiche créature utilise {{Wildlife Infobox|image|type|family|group|
// location|description}}. Le champ "type" vaut "Wildlife" pour une créature
// individuelle, vide sur certaines pages plus anciennes (ex: Rishboland
// Tiger, Spinocrocodile — traité comme "Wildlife" par défaut), ou "Wildlife
// Groups" pour les pages de présentation d'un groupe élémentaire/de variantes
// (ex: "Crystalfly", "Butterfly", "Shirakodai", "Weasel Thief" : pas de
// {{Card}} de butin, juste un renvoi vers les variantes qui, elles, sont déjà
// des pages individuelles distinctes dans la catégorie). Ces pages de groupe
// sont donc exclues (isGroupPage).
//
// Le butin ({{Card|Nom|Quantité}}) est documenté dans la section ==Drops==
// du wikitext brut, comme la plupart des autres champs : contrairement à
// scrape-enemies.ts, aucune donnée utile n'est calculée uniquement côté HTML
// rendu pour les créatures (pas de stats de combat détaillées par niveau), ce
// script suit donc le pattern "léger" de scrape-books.ts (wikitext seul,
// pas de cheerio).
//
// ── Poissons / "Maintenance Mek" ────────────────────────────────────────────
//
// Une quarantaine de pages listées dans Category:Wildlife (tous les poissons
// pêchables, ex: "Abiding Angelfish", "Medaka", "Snowstrider", et les robots
// "Maintenance Mek: ...") n'utilisent PAS {{Wildlife Infobox}} mais
// {{Item Infobox|type=Fish|lbFamily=...|lbGroup=...|lbType=Wildlife|bait=...}}
// : sur ce wiki, ces créatures sont cataloguées côté "Materials" (pêche),
// avec malgré tout trois champs "lb*" (living beings) qui les rattachent à
// Wildlife. On les traite donc comme des créatures à part entière
// (parseEnFishInfobox), filtrées sur lbType=Wildlife pour exclure les autres
// items ordinaires. Elles n'ont pas de section ==Drops== (elles sont pêchées,
// pas tuées) : drops est toujours [] pour ces pages, et bait (l'appât
// nécessaire) est renseigné à la place.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// La page FR ({{Infobox Faune|type=faune|famille=...|groupe=...|image=...|
// emplacement=...}}) ne contient PAS la description dans l'infobox
// elle-même (contrairement à l'EN) : selon les pages, elle est soit dans un
// bloc {{Quote|...|Description Archive}} juste après l'infobox (ex: Renard
// écarlate), soit dans une section ==Description== dédiée (ex: Écureuil). On
// essaie les deux, dans cet ordre.
//
// Le butin FR ({{Objet|Nom|s=taille}} xN ou {{Objet|Nom}} xN) est documenté
// dans la section ==Butin==, avec la quantité en dehors du template
// (contrairement à l'EN où {{Card|Nom|Quantité}} porte la quantité en 2e
// paramètre positionnel).
//
// Les poissons FR utilisent {{Infobox objet|description=...|appât=...}} (le
// même template générique que les matériaux, cf. scrape-materials.ts) : pas
// de famille/groupe/localisation exploitables côté FR pour ces pages, ces
// trois champs restent donc repris tels quels de l'EN (comme le reste du
// contenu non traduisible pour les créatures sans page FR, cf. ci-dessous).
//
// Comme pour scrape-enemies.ts/scrape-domains.ts : si aucune page FR dédiée
// n'existe (pas de langlink), on retombe sur le nom documenté par
// {{Other Languages|fr=...}} sur la page EN, sinon sur le nom EN tel quel ;
// le reste du contenu (family/group/location/description/drops) reste alors
// en anglais faute de source FR.
// ─────────────────────────────────────────────────────────────────────────────

interface Drop {
  name: string;
  quantity: number;
}

interface CreatureOutput {
  // Titre de page wiki EN (indépendant de la langue, comme `image`) : source
  // fiable pour re-scraper la page (ex: scrape-creature-images.ts) sans
  // dépendre d'un cache — `name` peut diverger du pageTitle réel (suffixe
  // parenthétique de désambiguïsation retiré).
  pageTitle: string;
  name: string;
  family: string;
  group: string;
  location: string;
  description: string;
  image: string | null;
  drops: Drop[];
  releaseVersion: string;
  // Poissons uniquement (cf. NOTE en tête de fichier) : appât nécessaire
  // pour les pêcher. Absent pour les créatures "terrestres/aériennes"
  // classiques ({{Wildlife Infobox}}).
  bait?: string;
}

interface RawCreature {
  pageTitle: string;
  en: CreatureOutput;
  frTitle: string | null;
  otherLanguagesFrName: string | null;
}

interface CachedCreature {
  pageTitle: string;
  en: CreatureOutput;
  fr: CreatureOutput;
}

// ── Wikitext helpers (repris tels quels de scrape-enemies.ts/scrape-books.ts) ──

function extractBracedBlock(content: string, startMarker: string): string | null {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < content.length - 1; i++) {
    if (content[i] === '{' && content[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (content[i] === '}' && content[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return content.slice(start, i + 1);
      continue;
    }
  }
  return null;
}

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const markers = [...block.matchAll(/\|\s*([\w' -]+?)\s*=\s*/g)];
  for (let i = 0; i < markers.length; i++) {
    const key = markers[i][1].trim();
    const valueStart = markers[i].index! + markers[i][0].length;
    const valueEnd = i + 1 < markers.length ? markers[i + 1].index! : block.length;
    fields[key] = block.slice(valueStart, valueEnd).replace(/\}\}\s*$/, '').trim();
  }
  return fields;
}

// Variante accentuée pour l'infobox FR ({{Infobox Faune}}, champs "famille",
// "emplacement", ...), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const markers = [...block.matchAll(/\|\s*([^=|]+?)\s*=\s*/g)];
  for (let i = 0; i < markers.length; i++) {
    const key = markers[i][1].trim();
    const valueStart = markers[i].index! + markers[i][0].length;
    const valueEnd = i + 1 < markers.length ? markers[i + 1].index! : block.length;
    fields[key] = block.slice(valueStart, valueEnd).replace(/\}\}\s*$/, '').trim();
  }
  return fields;
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/&shy;/gi, '')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'),
      '',
    )
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Isole le contenu d'une section "==Titre==" jusqu'au prochain heading de
// même niveau ou supérieur (repris de scrape-books.ts).
function extractSection(content: string, heading: string): string | null {
  const marker = `==${heading}==`;
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const nextHeading = content.slice(start).search(/\n==[^=]/);
  return nextHeading === -1 ? content.slice(start) : content.slice(start, start + nextHeading);
}

// {{Card|Raw Meat|2}} — un {{Card}} par ligne de butin (rarement plusieurs
// items différents sur une même page, ex: variantes de récompense).
function parseEnDrops(section: string | null): Drop[] {
  if (!section) return [];
  const drops: Drop[] = [];
  for (const match of section.matchAll(/\{\{Card\|([^|}]+)\|(\d+)\}\}/g)) {
    drops.push({ name: cleanWikitext(match[1]), quantity: parseInt(match[2], 10) });
  }
  return drops;
}

// "* {{Objet|Viande crue|s=50}} x2" ou "*{{Objet|Viande crue}} x1" : la
// quantité est toujours en dehors du template côté FR, contrairement à l'EN.
function parseFrDrops(section: string | null): Drop[] {
  if (!section) return [];
  const drops: Drop[] = [];
  for (const match of section.matchAll(/\{\{Objet\|([^|}]+)(?:\|[^}]*)?\}\}\s*x(\d+)/g)) {
    drops.push({ name: cleanWikitext(match[1]), quantity: parseInt(match[2], 10) });
  }
  return drops;
}

// Pages de présentation d'un groupe élémentaire/de variantes (Crystalfly,
// Butterfly, Shirakodai, Weasel Thief, ...) : pas de créature individuelle,
// cf. NOTE en tête de fichier.
function isGroupPage(rawType: string): boolean {
  return /^wildlife groups$/i.test(rawType.trim());
}

// Le champ "image" est presque toujours un simple nom de fichier
// ("Fichier.png" ou "Fichier.png|légende"), mais certaines pages de
// présentation de groupe (ex: "Butterfly", dont le type reste "Wildlife" au
// lieu de "Wildlife Groups" comme les autres pages de groupe — incohérence
// du wiki lui-même) y placent directement une balise <gallery> multi-lignes
// listant toutes les variantes : on prend alors la première entrée listée.
function extractImageFilename(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^<gallery/i.test(trimmed)) {
    const firstLine = trimmed
      .replace(/^<gallery[^>]*>/i, '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    if (!firstLine) return null;
    return firstLine.split('|')[0].trim() || null;
  }
  return trimmed.split('|')[0].trim() || null;
}

function parseOtherLanguagesField(content: string, lang: string): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  const value = fields[lang];
  return value ? cleanWikitext(value) : null;
}

function parseEnCreatureName(fields: Record<string, string>, pageTitle: string): string {
  return fields['name']
    ? cleanWikitext(fields['name'])
    : pageTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function parseEnWildlifeInfobox(pageTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Wildlife Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  if (isGroupPage(fields['type'] ?? '')) return null;

  const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);

  return {
    pageTitle,
    name: parseEnCreatureName(fields, pageTitle),
    family: cleanWikitext(fields['family'] ?? ''),
    group: cleanWikitext(fields['group'] ?? ''),
    location: cleanWikitext(fields['location'] ?? ''),
    description: cleanWikitext(fields['description'] ?? ''),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: parseEnDrops(extractSection(content, 'Drops')),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
  };
}

// Poissons pêchables / "Maintenance Mek" (cf. NOTE en tête de fichier) :
// {{Item Infobox}} au lieu de {{Wildlife Infobox}}, filtré sur
// lbType=Wildlife pour exclure les items ordinaires (qui utilisent le même
// template sans ces 3 champs "lb*").
function parseEnFishInfobox(pageTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Item Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  if (!/^wildlife$/i.test((fields['lbType'] ?? '').trim())) return null;

  const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);

  return {
    pageTitle,
    name: parseEnCreatureName(fields, pageTitle),
    family: cleanWikitext(fields['lbFamily'] ?? ''),
    group: cleanWikitext(fields['lbGroup'] ?? ''),
    location: cleanWikitext(fields['location'] ?? ''),
    description: cleanWikitext(fields['description'] ?? ''),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: [], // pêché, pas tué : pas de {{Card}} de butin pour ces pages
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
    bait: fields['bait'] ? cleanWikitext(fields['bait']) : undefined,
  };
}

function parseEnCreaturePage(pageTitle: string, content: string): CreatureOutput | null {
  return parseEnWildlifeInfobox(pageTitle, content) ?? parseEnFishInfobox(pageTitle, content);
}

function extractFrDescription(content: string): string {
  const quoteBlock = extractBracedBlock(content, '{{Quote');
  if (quoteBlock) {
    // {{Quote|texte...|Description Archive}} : le texte est le 1er paramètre
    // positionnel, la source ("Description Archive") le dernier — on ne
    // garde que ce qui précède le dernier "|".
    const inner = quoteBlock.slice(2, -2).replace(/^Quote\s*\|/, '');
    const lastPipe = inner.lastIndexOf('|');
    return cleanWikitext(lastPipe === -1 ? inner : inner.slice(0, lastPipe));
  }
  const section = extractSection(content, 'Description');
  if (!section) return '';
  // Certaines pages laissent en toutes lettres un résidu de template
  // orphelin en fin de section (ex: "...jours.|Description Archives}}" sur
  // "Ibis violet", sans "{{Quote" correspondant en amont — coquille propre
  // au wiki, pas un vrai {{Quote}} imbriqué) : on le retire s'il traîne.
  return cleanWikitext(section).replace(/\s*\|[^|{}]{0,60}\}\}\s*$/, '');
}

function parseFrWildlifeInfobox(frTitle: string, content: string): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Infobox Faune');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  const versionMatch = content.match(/\{\{Historique\|([^}|]+)/);

  return {
    pageTitle: '', // overridé par parseFrCreaturePage (pageTitle EN, cf. plus bas)
    name: frTitle,
    family: cleanWikitext(fields['famille'] ?? ''),
    group: cleanWikitext(fields['groupe'] ?? ''),
    location: cleanWikitext(fields['emplacement'] ?? ''),
    description: extractFrDescription(content),
    image: fields['image'] ? extractImageFilename(fields['image']) : null,
    drops: parseFrDrops(extractSection(content, 'Butin')),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
  };
}

// Poissons FR : {{Infobox objet}} (même template générique que les
// matériaux, cf. NOTE en tête de fichier) — pas de champ famille/groupe/
// localisation exploitable, on reprend ceux de l'EN (enFallback).
function parseFrFishInfobox(
  frTitle: string,
  content: string,
  enFallback: CreatureOutput,
): CreatureOutput | null {
  const block = extractBracedBlock(content, '{{Infobox objet');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  const versionMatch = content.match(/\{\{Historique\|([^}|]+)/);

  return {
    pageTitle: enFallback.pageTitle,
    name: frTitle,
    family: enFallback.family,
    group: enFallback.group,
    location: enFallback.location,
    description: fields['description'] ? cleanWikitext(fields['description']) : enFallback.description,
    image: fields['icon'] ? extractImageFilename(fields['icon']) : enFallback.image,
    drops: [],
    releaseVersion: versionMatch ? versionMatch[1].trim() : enFallback.releaseVersion,
    bait: fields['appât'] ? cleanWikitext(fields['appât']) : enFallback.bait,
  };
}

function parseFrCreaturePage(
  frTitle: string,
  content: string,
  enFallback: CreatureOutput,
): CreatureOutput | null {
  const result =
    parseFrWildlifeInfobox(frTitle, content) ?? parseFrFishInfobox(frTitle, content, enFallback);
  return result ? { ...result, pageTitle: enFallback.pageTitle } : null;
}

// ── Repli sur la dernière valeur connue ────────────────────────────────────
// Le wiki retire parfois un champ structuré d'une infobox lors d'une
// réorganisation (le contenu reste alors seulement en prose libre juste en
// dessous, ex: Bake-Danuki/Flying Serpent qui ont perdu leur champ
// "description" tout en gardant un paragraphe d'intro équivalent) sans que
// la donnée soit fausse ou obsolète pour autant. Plutôt que de tenter de la
// ré-extraire depuis la prose (peu fiable, cf. NOTE en tête de fichier), on
// garde la dernière valeur connue tant que le nouveau scrape retombe sur une
// valeur vide — même logique que preserveKnownFields dans scrape-books.ts.
// "previous" vient désormais du fichier de sortie déjà écrit en repo
// (prisma/data/creatures/<lang>/*.json), pas d'un cache disposable : cf.
// readPreviousOutput.
function preserveKnownFields(fresh: CreatureOutput, previous: CreatureOutput | undefined): CreatureOutput {
  if (!previous) return fresh;
  return {
    ...fresh,
    family: fresh.family || previous.family,
    group: fresh.group || previous.group,
    location: fresh.location || previous.location,
    description: fresh.description || previous.description,
    bait: fresh.bait || previous.bait,
  };
}

function readPreviousOutput(lang: 'en' | 'fr', name: string): CreatureOutput | undefined {
  const filePath = path.join(OUTPUT_DIR(lang), `${slugify(name)}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

async function scrapeCreature(pageTitle: string): Promise<RawCreature | null> {
  const { content, frTitle } = await fetchWikitextWithLanglink(pageTitle);
  if (!content) return null;

  let en = parseEnCreaturePage(pageTitle, content);
  if (!en) return null; // pas de {{Wildlife Infobox}} exploitable, ou page de groupe
  en = preserveKnownFields(en, readPreviousOutput('en', en.name));

  return {
    pageTitle,
    en,
    frTitle,
    otherLanguagesFrName: parseOtherLanguagesField(content, 'fr'),
  };
}

async function scrapeAll(pageTitles: string[]): Promise<RawCreature[]> {
  const results: RawCreature[] = [];
  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    try {
      const creature = await scrapeCreature(pageTitles[i]);
      if (creature) results.push(creature);
    } catch (err) {
      console.warn(`⚠️  Échec du scraping de "${pageTitles[i]}": ${err}`);
    }
    await sleep(300);
  }
  return results;
}

async function enrichWithFrench(raw: RawCreature): Promise<CachedCreature> {
  const fallbackName = raw.otherLanguagesFrName || raw.en.name;
  const fallbackFr = (): CreatureOutput => ({ ...raw.en, name: fallbackName });

  let fr: CreatureOutput;
  if (raw.frTitle) {
    const frContent = await fetchFrWikitext(raw.frTitle);
    const frPage = frContent ? parseFrCreaturePage(raw.frTitle, frContent, raw.en) : null;
    if (frPage) {
      fr = frPage;
    } else {
      console.warn(
        `⚠️  "${raw.pageTitle}": page FR "${raw.frTitle}" introuvable ou sans {{Infobox Faune}}/{{Infobox objet}} exploitable, fichier fr/ écrit avec le nom "${fallbackName}".`,
      );
      fr = fallbackFr();
    }
  } else {
    console.warn(`⚠️  "${raw.pageTitle}": aucune page FR trouvée, fichier fr/ écrit avec le nom "${fallbackName}".`);
    fr = fallbackFr();
  }
  fr = preserveKnownFields(fr, readPreviousOutput('fr', fr.name));

  return { pageTitle: raw.pageTitle, en: raw.en, fr };
}

async function scrapeAndEnrichAll(pageTitles: string[]): Promise<CachedCreature[]> {
  const raws = await scrapeAll(pageTitles);
  const enriched: CachedCreature[] = [];
  for (let i = 0; i < raws.length; i++) {
    console.log(`Fetching FR page for "${raws[i].pageTitle}" (${i + 1}/${raws.length})...`);
    enriched.push(await enrichWithFrench(raws[i]));
    await sleep(300);
  }
  return enriched;
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeCreatureFiles(creatures: CachedCreature[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  for (const creature of creatures) {
    const filename = `${slugify(creature.en.name)}.json`;
    // Même clé que scrape-creature-images.ts (slugify(pageTitle)) : l'icône
    // est indépendante de la langue, donc identique en/fr — matche
    // directement le param :file de GET /assets/creatures/:file (sans
    // extension, le controller essaie déjà .png/.webp/...). Le nom de
    // fichier wiki brut calculé par parseEn*Infobox (ex: "Alpaca Icon.png")
    // n'est qu'une étape intermédiaire : scrape-creature-images.ts le
    // re-dérive lui-même depuis le wikitext (même pattern que
    // scrape-material-images.ts, cf. sa NOTE).
    const image = slugify(creature.pageTitle);
    const pageTitle = creature.pageTitle;
    fs.writeFileSync(path.join(enDir, filename), JSON.stringify({ ...creature.en, image, pageTitle }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(frDir, filename), JSON.stringify({ ...creature.fr, image, pageTitle }, null, 2), 'utf-8');
  }

  console.log(`✅ Wrote ${creatures.length} creature files (en/ + fr/) to ${enDir} / ${frDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-category'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch une liste de pages    : npx ts-node -r tsconfig-paths/register scripts/scrape-creatures.ts --fetch "Squirrel" "Crimson Fox"');
    console.error('  Fetch toute la catégorie     : npx ts-node -r tsconfig-paths/register scripts/scrape-creatures.ts --fetch-category');
    process.exit(1);
  }

  let pageTitles: string[];
  if (args[0] === '--fetch-category') {
    console.log('Fetching "Category:Wildlife" members...');
    pageTitles = await fetchCategoryMembers('Wildlife');
    console.log(`Found ${pageTitles.length} pages in category.`);
  } else {
    pageTitles = args.slice(1);
  }

  const creatures = await scrapeAndEnrichAll(pageTitles);
  writeCreatureFiles(creatures);
}

main();
