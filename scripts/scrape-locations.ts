// scripts/scrape-locations.ts
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import {
  EN_API_URL,
  FR_API_URL,
  HTTP_HEADERS,
  httpsAgent,
  sleep,
  withRetry,
  fetchWikitext as fetchEnWikitext,
  fetchHtml as fetchEnHtml,
  fetchFrWikitext,
} from './lib/wiki-fetch';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/locations/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// "Category:Locations" elle-même est une catégorie fourre-tout (quêtes,
// panneaux d'affichage, noms entre guillemets...), inexploitable telle
// quelle. La vraie hiérarchie géographique du wiki vit dans 4 catégories
// filles de "Category:Locations by Type" :
//   Category:Nations    → {{Region Infobox}}   (les 7 nations, page "pays")
//   Category:Subregions → {{Location Infobox|type=Subregion|...}}
//   Category:Areas      → {{Location Infobox|type=Area|...}}
//   Category:Subareas   → {{Location Infobox|type=Subarea|...}}
// "Category:Points of Interest" (repères/bâtiments individuels, des
// milliers de pages) et "Category:Main Cities" sont volontairement laissés
// de côté : hors scope pour une hiérarchie de lieux "nation > région >
// sous-région > zone".
//
// Certaines catégories (notamment Subareas) contiennent aussi des pages
// parasites (noms de quêtes entre guillemets, panneaux...) qui n'ont pas le
// template attendu : on les filtre simplement en exigeant la présence de
// {{Region Infobox}} ou {{Location Infobox}} dans le wikitext.
//
// Hiérarchie parent/enfant : le champ "area"/"subregion"/"region" de
// {{Location Infobox}} donne le parent direct (area > subregion > region par
// ordre de priorité). Les nations n'ont pas de parent.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// Le wiki FR utilise {{Pays}} pour les nations (nom + citation dans
// {{Quote|...}}) et {{Infobox Lieux}} pour le reste, avec un champ
// "nomAnglais" qui donne le titre EN correspondant (fiable, mais on utilise
// plutôt les langlinks MediaWiki, cohérent avec les autres scrapers). Le
// champ "type" FR n'est PAS fiable pour distinguer Area de Subregion (les
// deux utilisent "Région") : on garde donc le type EN comme source de
// vérité et on ne fait que le traduire en libellé FR (cf. TYPE_LABELS_FR).
// Idem pour le nom du parent : la page FR d'un lieu ne référence pas
// toujours proprement son parent, donc le nom de parent FR est résolu via la
// table de correspondance EN→FR construite depuis les langlinks de TOUTES
// les localisations récupérées dans ce run (pas de requête supplémentaire).
// ─────────────────────────────────────────────────────────────────────────────

export type LocationType = 'Nation' | 'Subregion' | 'Area' | 'Subarea';

const CATEGORIES: { category: string; type: LocationType }[] = [
  { category: 'Category:Nations', type: 'Nation' },
  { category: 'Category:Subregions', type: 'Subregion' },
  { category: 'Category:Areas', type: 'Area' },
  { category: 'Category:Subareas', type: 'Subarea' },
];

export const TYPE_LABELS_FR: Record<LocationType, string> = {
  Nation: 'Nation',
  Subregion: 'Sous-région',
  Area: 'Région',
  Subarea: 'Zone',
};

export interface RawLocation {
  pageTitle: string;
  title: string;
  type: LocationType;
  parentTitle: string | null; // titre EN de la page parente, null pour une nation
  description: string;
  image: string | null;
  frTitle: string | null;
}

export interface LocationOutput {
  name: string;
  type: string;
  parent: string | null;
  description: string;
  image: string | null;
  imageLocalName: string | null;
  subLocations: string[];
}

// "image" reste le nom de fichier exact du wiki (nécessaire pour
// reconstruire l'URL réelle sur le CDN Fandom, sensible à la casse) ;
// "imageLocalName" en est une version normalisée (minuscules, espaces ->
// "_") pour qui veut nommer un fichier téléchargé localement.
export function normalizeImageLocalName(image: string | null): string | null {
  if (!image) return null;
  return image.toLowerCase().replace(/ /g, '_');
}

interface CachedLocation {
  pageTitle: string;
  en: LocationOutput;
  fr: LocationOutput | null;
}

// ── Wikitext helpers (repris de scrape-domains.ts) ──────────────────────────

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
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Variante utilisée pour l'infobox FR : les noms de champs peuvent contenir
// des accents (ex: "région"), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

const HTML_ENTITIES: Record<string, string> = {
  '&mdash;': '—',
  '&ndash;': '–',
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  "&#39;": "'",
};

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '') // commentaires HTML
    .replace(/<\/?p>/g, ' ') // paragraphes HTML des templates de description
    .replace(/<[^>]+>/g, ' ') // autres balises HTML (br, sup, ref...)
    .replace(/\{\{Lang\|([^|}]+)(?:\|[^}]*)?\}\}/gi, '$1') // {{Lang|'''X'''|zh=...}} -> X
    .replace(/\{\{If Self\|[^|}]*\|([^|}]*)\|[^}]*\}\}/gi, '$1') // {{If Self|A|It|The A}} -> "It"
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '') // templates restants non gérés spécifiquement
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Coupe un contenu de template par "|" de premier niveau seulement (ignore
// les "|" imbriqués dans des [[liens]] ou {{templates}}), pour lire des
// paramètres positionnels comme {{Description|texte|source}}.
function splitTopLevelPipe(text: string): string[] {
  const parts: string[] = [];
  let depthBrace = 0;
  let depthBracket = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{') {
      depthBrace++;
      current += two;
      i++;
      continue;
    }
    if (two === '}}') {
      depthBrace--;
      current += two;
      i++;
      continue;
    }
    if (two === '[[') {
      depthBracket++;
      current += two;
      i++;
      continue;
    }
    if (two === ']]') {
      depthBracket--;
      current += two;
      i++;
      continue;
    }
    if (text[i] === '|' && depthBrace === 0 && depthBracket === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += text[i];
  }
  parts.push(current);
  return parts;
}

// Première image d'un bloc infobox, que ce soit une <gallery> multi-lignes
// (EN, et FR pour les nations) ou un champ "image = Fichier.png" en une
// ligne (FR pour les lieux simples, ex: "Plaines Guili").
function extractFirstImage(block: string): string | null {
  const galleryMatch = block.match(/<gallery>([\s\S]*?)<\/gallery>/);
  if (galleryMatch) {
    const firstLine = galleryMatch[1]
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    if (!firstLine) return null;
    return firstLine
      .split('|')[0]
      .replace(/^(Fichier|File)\s*:\s*/i, '')
      .trim() || null;
  }
  const m = block.match(/\|\s*image1?\s*=\s*([^\n|]+)/);
  if (m) {
    const value = m[1].replace(/^(Fichier|File)\s*:\s*/i, '').trim();
    return value || null;
  }
  return null;
}

// ── Parsing EN ───────────────────────────────────────────────────────────────

function parseNationDescriptionEn(content: string): string {
  const block = extractBracedBlock(content, '{{Description');
  if (!block) return '';
  const inner = block.slice('{{Description'.length, -2);
  const parts = splitTopLevelPipe(inner);
  return parts.length > 1 ? cleanWikitext(parts[1]) : '';
}

function parseLocationIntroDescriptionEn(content: string): string {
  const block = extractBracedBlock(content, '{{Location Intro');
  if (!block) return '';
  const idx = block.indexOf('description');
  if (idx === -1) return '';
  const eqIdx = block.indexOf('=', idx);
  if (eqIdx === -1) return '';
  const raw = block.slice(eqIdx + 1, -2); // retire le "}}" final du template
  return cleanWikitext(raw);
}

// Les pages de type Subregion (ex: Chenyu Vale, Dharma Forest) n'ont pas de
// {{Location Intro}} : elles utilisent {{Description}}, comme les nations.
function parseLocationDescriptionEn(content: string): string {
  const introDescription = parseLocationIntroDescriptionEn(content);
  if (introDescription) return introDescription;
  return parseNationDescriptionEn(content);
}

function parseNationEn(content: string): {
  parentTitle: null;
  description: string;
  image: string | null;
} | null {
  const block = extractBracedBlock(content, '{{Region Infobox');
  if (!block) return null;
  return {
    parentTitle: null,
    description: parseNationDescriptionEn(content),
    image: extractFirstImage(block),
  };
}

function parseLocationEn(content: string): {
  type: LocationType;
  parentTitle: string | null;
  description: string;
  image: string | null;
} | null {
  const block = extractBracedBlock(content, '{{Location Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const type = fields['type'] as LocationType;
  if (!['Nation', 'Subregion', 'Area', 'Subarea'].includes(type)) return null;

  const area = fields['area']?.trim();
  const subregion = fields['subregion']?.trim();
  const region = fields['region']?.trim();
  const parentTitle = area || subregion || region || null;

  return {
    type,
    parentTitle,
    description: parseLocationDescriptionEn(content),
    image: extractFirstImage(block),
  };
}

// ── Parsing FR ───────────────────────────────────────────────────────────────

// Certaines pages FR (ex: Nod-Krai) mettent leur texte d'intro dans un
// template {{Description|texte|source}} plutôt qu'en prose brute. cleanWikitext()
// supprime tout template non géré (donc {{Description|...}} en entier, texte
// compris) : il faut l'extraire *avant* nettoyage, comme pour parseNationDescriptionEn.
function extractDescriptionTemplateText(raw: string): string | null {
  const block = extractBracedBlock(raw, '{{Description');
  if (!block) return null;
  const inner = block.slice('{{Description'.length, -2);
  const parts = splitTopLevelPipe(inner);
  return parts.length > 1 ? cleanWikitext(parts[1]) : null;
}

// Repli pour l'intro brute (texte libre après l'infobox, avant le premier
// "==" ou "{{Description}}") : utilisé quand ni template ni champ dédié ne
// fournit la description.
function extractProseIntro(raw: string): string {
  const stopMatch = raw.match(/\n==/);
  const introRaw = stopMatch ? raw.slice(0, stopMatch.index) : raw;
  return cleanWikitext(introRaw);
}

export function parseNationFr(content: string): { name: string; description: string; image: string | null } | null {
  const block = extractBracedBlock(content, '{{Pays');
  if (!block) {
    // Certaines ex-nations/régions à part (ex: Khaenri'ah, qui n'est plus une
    // des 7 nations canoniques) sont modélisées côté wiki FR avec l'infobox
    // "lieu" générique plutôt que {{Pays}} : on retombe sur ce parsing-là.
    const asLocation = parseLocationFr(content);
    return asLocation ? { name: '', ...asLocation } : null;
  }
  const fields = parseInfoboxFieldsAccented(block);

  const quoteBlock = extractBracedBlock(content, '{{Quote');
  let description = '';
  if (quoteBlock) {
    const inner = quoteBlock.slice('{{Quote'.length, -2);
    const parts = splitTopLevelPipe(inner);
    description = parts.length > 1 ? cleanWikitext(parts[1]) : '';
  }

  // Certaines nations (ex: Snezhnaya) n'ont pas de {{Quote}} exploitable : la
  // description réelle est soit dans un {{Description|...}} plus bas, soit en
  // prose libre juste après l'infobox.
  if (!description) {
    const blockEnd = content.indexOf(block) + block.length;
    const rest = content.slice(blockEnd);
    description = extractDescriptionTemplateText(rest) || extractProseIntro(rest);
  }

  return {
    name: cleanWikitext(fields['nom'] ?? ''),
    description,
    image: extractFirstImage(block),
  };
}

// Alias de template observés sur le wiki FR pour l'infobox d'un lieu
// non-nation ; toutes ne sont pas documentées mais partagent la même
// structure (infobox suivie d'une intro en prose ou en {{Description}}).
const LOCATION_INFOBOX_MARKERS = ['{{Infobox_Lieux', '{{Infobox Lieux', '{{Région/Lieux', '{{Region/Lieux'];

export function parseLocationFr(content: string): { description: string; image: string | null } | null {
  const marker = LOCATION_INFOBOX_MARKERS.find((m) => content.includes(m));
  if (!marker) return null;
  const block = extractBracedBlock(content, marker);
  if (!block) return null;

  const blockEnd = content.indexOf(block) + block.length;
  const rest = content.slice(blockEnd);

  const description = extractDescriptionTemplateText(rest) || extractProseIntro(rest);

  return {
    description,
    image: extractFirstImage(block),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function fetchCategoryBatch(
  category: string,
  type: LocationType,
  continueParams?: Record<string, string>,
): Promise<{ results: RawLocation[]; nextContinueParams?: Record<string, string> }> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category,
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
    ...continueParams,
  };

  const response = await axios.get(EN_API_URL, { params, headers: HTTP_HEADERS, httpsAgent });

  const pages = response.data?.query?.pages ?? [];
  const nextContinueParams = response.data?.continue;
  const results: RawLocation[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    const frTitle: string | null = page.langlinks?.[0]?.title ?? null;

    if (type === 'Nation') {
      const parsed = parseNationEn(content);
      if (!parsed) continue;
      results.push({
        pageTitle: page.title,
        title: page.title.trim(),
        type: 'Nation',
        parentTitle: parsed.parentTitle,
        description: parsed.description,
        image: parsed.image,
        frTitle,
      });
      continue;
    }

    const parsed = parseLocationEn(content);
    if (!parsed) continue; // page parasite de la catégorie (pas de {{Location Infobox}})
    results.push({
      pageTitle: page.title,
      title: page.title.trim(),
      type: parsed.type,
      parentTitle: parsed.parentTitle,
      description: parsed.description,
      image: parsed.image,
      frTitle,
    });
  }

  return { results, nextContinueParams };
}

async function fetchAllRaw(): Promise<Map<string, RawLocation>> {
  const byPageTitle = new Map<string, RawLocation>();

  for (const { category, type } of CATEGORIES) {
    console.log(`Fetching ${category}...`);
    let continueParams: Record<string, string> | undefined;
    let batch = 1;
    do {
      console.log(`  Batch ${batch}...`);
      const { results, nextContinueParams } = await fetchCategoryBatch(category, type, continueParams);
      for (const loc of results) {
        const existing = byPageTitle.get(loc.pageTitle);
        if (existing) {
          if (loc.frTitle) existing.frTitle = loc.frTitle;
          continue;
        }
        byPageTitle.set(loc.pageTitle, loc);
      }
      continueParams = nextContinueParams;
      batch++;
      await sleep(500);
    } while (continueParams);
  }

  return byPageTitle;
}

async function fetchFrTitleDirect(pageTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch langlink FR "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'langlinks',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      return page?.langlinks?.[0]?.title ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch langlink FR pour "${pageTitle}": ${err}`);
    return null;
  }
}

// Repli quand {{Location Intro}} n'a pas de paramètre "description" en clair
// dans le wikitext : le template génère alors lui-même une phrase à partir
// des champs de l'infobox (type/area/region/subregion, voire event pour les
// zones à durée limitée) via un module Lua, invisible dans le wikitext mais
// bien présent une fois la page rendue (cf. audit : "Ardravi Valley is an
// area located in Dharma Forest, Sumeru." — absent du wikitext, présent au
// rendu). On récupère ce texte directement plutôt que de tenter de
// reproduire la logique du module Lua, ce qui capture aussi les cas plus
// élaborés (zones d'événement avec un texte rédigé à la main, ex: Golden
// Apple Archipelago) sans code spécifique par cas.
function parseIntroTextFromHtml(html: string): string {
  const asideEnd = html.indexOf('</aside>');
  if (asideEnd === -1) return '';
  const rest = html.slice(asideEnd + '</aside>'.length);
  const stopMarkers = ['<div id="toc"', '<h2'];
  let stopIdx = rest.length;
  for (const marker of stopMarkers) {
    const idx = rest.indexOf(marker);
    if (idx !== -1 && idx < stopIdx) stopIdx = idx;
  }
  const $ = cheerio.load('<div>' + rest.slice(0, stopIdx) + '</div>');
  return $('div').text().replace(/\s+/g, ' ').trim();
}

function parseOtherLanguagesField(content: string, lang: string): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  const value = fields[lang];
  return value ? cleanWikitext(value) : null;
}

function parseFrNameFromOtherLanguagesHtml(html: string): string | null {
  const marker = 'id="Other_Languages"';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const tableStart = html.indexOf('<table', idx);
  if (tableStart === -1) return null;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return null;

  const $ = cheerio.load(html.slice(tableStart, tableEnd + '</table>'.length));
  let frenchName: string | null = null;
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    if (/^French$/i.test($(cells[0]).text().trim())) {
      frenchName = $(cells[1]).text().trim();
    }
  });
  return frenchName;
}

async function resolveFrNameViaOtherLanguages(pageTitle: string, wikitext?: string | null): Promise<string | null> {
  const content = wikitext !== undefined ? wikitext : await fetchEnWikitext(pageTitle);
  const fromWikitext = content ? parseOtherLanguagesField(content, 'fr') : null;
  if (fromWikitext) return fromWikitext;

  const html = await fetchEnHtml(pageTitle);
  return html ? parseFrNameFromOtherLanguagesHtml(html) : null;
}

// ── Résolution de la page FR (langlink batché → langlink dédié → Other Languages) ──

export async function resolveFrTitleAndContent(
  loc: RawLocation,
): Promise<{ frTitle: string; frContent: string | null } | null> {
  let frTitle = loc.frTitle;

  if (frTitle) {
    const content = await fetchFrWikitext(frTitle);
    if (content) return { frTitle, frContent: content };
  }

  frTitle = await fetchFrTitleDirect(loc.pageTitle);
  if (frTitle) {
    const content = await fetchFrWikitext(frTitle);
    if (content) return { frTitle, frContent: content };
  }

  const frName = await resolveFrNameViaOtherLanguages(loc.pageTitle);
  if (frName) {
    const content = await fetchFrWikitext(frName);
    return { frTitle: frName, frContent: content };
  }

  return null;
}

// ── Construction des sorties ────────────────────────────────────────────────

export function buildLocationOutput(
  loc: RawLocation,
  lang: 'en' | 'fr',
  name: string,
  description: string,
  image: string | null,
  parentName: string | null,
  childrenNames: string[],
): LocationOutput {
  return {
    name,
    type: lang === 'fr' ? TYPE_LABELS_FR[loc.type] : loc.type,
    parent: parentName,
    description,
    image,
    imageLocalName: normalizeImageLocalName(image),
    subLocations: childrenNames,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== '--fetch') {
    console.error('Usage:');
    console.error('  Fetch + générer tout : npx ts-node --project tsconfig.scripts.json scripts/scrape-locations.ts --fetch');
    process.exit(1);
  }

  console.log('Fetching all locations from wiki (this will take a few minutes)...');
  const rawByPageTitle = await fetchAllRaw();
  console.log(`Found ${rawByPageTitle.size} locations. Resolving French pages...`);

  const frContentByPageTitle = new Map<string, { frTitle: string; frContent: string | null } | null>();
  let i = 0;
  let renderedDescriptions = 0;
  for (const loc of rawByPageTitle.values()) {
    i++;
    console.log(`  Enriching "${loc.pageTitle}" (${i}/${rawByPageTitle.size})...`);

    // {{Location Intro}} sans description= en clair : on va chercher le
    // texte généré au rendu (cf. parseIntroTextFromHtml) avant de
    // résoudre la page FR, pour que loc.description soit déjà correct
    // quand il sert de repli dans le bloc FR plus bas.
    if (!loc.description.trim() && (loc.type === 'Area' || loc.type === 'Subarea')) {
      const html = await fetchEnHtml(loc.pageTitle);
      const rendered = parseIntroTextFromHtml(html);
      if (rendered) {
        loc.description = rendered;
        renderedDescriptions++;
      }
      await sleep(300);
    }

    const frResolved = await resolveFrTitleAndContent(loc);
    frContentByPageTitle.set(loc.pageTitle, frResolved);
    await sleep(300);
  }
  console.log(`  ${renderedDescriptions} description(s) EN récupérée(s) via le rendu HTML (repli {{Location Intro}} sans description= en clair).`);

  // ── Nom EN → nom FR, pour traduire les références de parent côté FR ───────
  const enToFrName = new Map<string, string>();
  for (const [pageTitle, resolved] of frContentByPageTitle) {
    if (!resolved) continue;
    const loc = rawByPageTitle.get(pageTitle)!;
    if (loc.type === 'Nation') {
      const parsed = resolved.frContent ? parseNationFr(resolved.frContent) : null;
      enToFrName.set(pageTitle, (parsed?.name || resolved.frTitle));
    } else {
      enToFrName.set(pageTitle, resolved.frTitle);
    }
  }

  // ── Enfants directs de chaque page (par titre EN) ─────────────────────────
  const childrenOf = new Map<string, string[]>();
  for (const loc of rawByPageTitle.values()) {
    if (!loc.parentTitle) continue;
    if (!rawByPageTitle.has(loc.parentTitle)) continue; // parent hors scope (pas dans nos 4 catégories)
    const list = childrenOf.get(loc.parentTitle) ?? [];
    list.push(loc.pageTitle);
    childrenOf.set(loc.parentTitle, list);
  }

  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  let written = 0;
  let skippedFr = 0;
  const emptyFrDescription: string[] = [];

  for (const loc of rawByPageTitle.values()) {
    const childrenTitles = childrenOf.get(loc.pageTitle) ?? [];

    const enOutput = buildLocationOutput(
      loc,
      'en',
      loc.title,
      loc.description,
      loc.image,
      loc.parentTitle,
      childrenTitles.map((t) => rawByPageTitle.get(t)!.title),
    );

    const filename = `${slugify(enOutput.name)}.json`;
    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(enOutput, null, 2), 'utf-8');

    const resolved = frContentByPageTitle.get(loc.pageTitle);
    if (resolved) {
      let frName: string;
      let frDescription: string;
      let frImage: string | null;

      if (loc.type === 'Nation') {
        const parsed = resolved.frContent ? parseNationFr(resolved.frContent) : null;
        frName = parsed?.name || resolved.frTitle;
        // Ne JAMAIS retomber sur le texte EN : une page FR sans description
        // exploitable (page introuvable, template non reconnu...) doit rester
        // vide plutôt que d'afficher un résidu anglais qui a l'air traduit.
        frDescription = parsed?.description || '';
        frImage = parsed?.image ?? loc.image;
      } else {
        const parsed = resolved.frContent ? parseLocationFr(resolved.frContent) : null;
        frName = resolved.frTitle;
        frDescription = parsed?.description || '';
        frImage = parsed?.image ?? loc.image;
      }

      if (!frDescription) emptyFrDescription.push(`${filename} (${frName})`);

      const frOutput = buildLocationOutput(
        loc,
        'fr',
        frName,
        frDescription,
        frImage,
        loc.parentTitle ? enToFrName.get(loc.parentTitle) ?? loc.parentTitle : null,
        childrenTitles.map((t) => enToFrName.get(t) ?? rawByPageTitle.get(t)!.title),
      );

      fs.writeFileSync(path.join(frDir, filename), JSON.stringify(frOutput, null, 2), 'utf-8');
    } else {
      skippedFr++;
    }

    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} localisation(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  if (emptyFrDescription.length > 0) {
    console.warn(`⚠️  ${emptyFrDescription.length} localisation(s) avec description FR vide (page FR trouvée mais rien à en extraire — vrai manque côté wiki, candidat pour scripts/data/location-description-overrides.json) :`);
    console.warn(emptyFrDescription.map((f) => `  - ${f}`).join('\n'));
  }
  console.log(`✅ Wrote ${written} location files (en/) to ${enDir}`);
}

if (require.main === module) {
  main();
}
