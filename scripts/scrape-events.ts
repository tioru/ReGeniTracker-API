// scripts/scrape-events.ts
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/events/${lang}`);
const CACHE_PATH = path.resolve(__dirname, './cache/events-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Category:Events (1215+ pages) mélange des évènements jouables in-game
// (quêtes temporaires, mini-jeux, connexion quotidienne...) et des évènements
// purement communautaires ("Web" : concours de fan art, sondages HoYoLAB...).
// Les deux utilisent exactement le même template {{Event}}, distingué par son
// champ |type= ("In-Game" | "Web") — vérifié par échantillonnage de 400 pages
// de la catégorie (397/400 avaient bien {{Event}}, seules 2 valeurs de type
// rencontrées). Les quelques pages restantes sans {{Event}} sont des
// sous-pages techniques (".../Gallery", ".../Change History") ou des pages de
// série récurrente ("Hypostatic Symphony", qui utilise {{Terminology
// Infobox}} et liste ses occurrences datées comme des sous-pages
// "Hypostatic Symphony/2024-08-28" — non traitées ici, seules les pages
// listées directement dans Category:Events sont scrapées) : elles sont
// naturellement filtrées (parseEventInfoboxEn retourne null).
//
// Contrairement aux ennemis/nourriture, AUCUNE requête HTML supplémentaire
// n'est nécessaire : dates, récompenses ({{Event Rewards|Item=Qté|...}}) et
// description ({{Description|...}}) sont toutes des paramètres de template en
// clair dans le wikitext brut.
//
// ── Récompenses ──────────────────────────────────────────────────────────
// {{Event Rewards}} peut apparaître PLUSIEURS fois sur une même page (ex: un
// groupe "Quest" et un groupe "Original Resin" séparés), chaque bloc pouvant
// avoir un paramètre optionnel |type= servant d'intitulé de catégorie
// ("Quest"/"Original Resin"/"Event Items") — à ne pas confondre avec le champ
// |type= de l'infobox {{Event}} elle-même (In-Game/Web), qui est un template
// différent. Le paramètre |sort= (ordre d'affichage) est ignoré, il ne porte
// aucune donnée de récompense.
//
// Certains évènements (ex: sélection de personnage lors d'un Flagship event)
// utilisent en plus |reward=/|rewardType= directement dans l'infobox
// {{Event}} pour documenter un choix (ex: reward=Faruzan, rewardType=
// Character), distinct de {{Event Rewards}} — capturé séparément
// (specialReward).
//
// ── FR ────────────────────────────────────────────────────────────────────
// Le wiki FR utilise {{Infobox Événements}}, bien plus pauvre : pas de champ
// |nom= (le nom traduit est le TITRE de la page elle-même), une |durée= en
// texte libre non fiable pour en extraire des dates (cf. scrape-banners.ts,
// même problème constaté sur les dates FR des occurrences de bannières) et
// aucune description structurée. Seules les récompenses sont exploitables via
// {{Récompenses/Événement|Nom*Qté, Nom2*Qté2}} (liste à plat, pas de
// distinction par catégorie contrairement à l'EN). On ne traduit donc que le
// nom et les récompenses ; le reste (dates, type, groupes, description,
// liens) est repris tel quel depuis l'EN, comme le font déjà scrape-enemies.ts
// et scrape-food.ts pour leurs propres champs non traduisibles côté FR.
// ─────────────────────────────────────────────────────────────────────────────

interface EventLink {
  label: string;
  url: string;
}

interface EventReward {
  name: string;
  quantity: number;
}

interface EventRewardGroup {
  category: string | null; // |type= du bloc {{Event Rewards}} ("Quest", "Original Resin", ...), null si absent
  rewards: EventReward[];
}

interface EventOutput {
  pageTitle: string;
  name: string;
  type: string; // "In-Game" | "Web" (valeur brute de l'infobox)
  groups: string[]; // group, group2, ...
  parentEvent: string | null; // champ "event" (ex: "Lantern Rite Festival")
  description: string | null;
  timeKnown: boolean;
  startDate: string | null; // ISO ("YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm:ss"), null si TBA
  startDateOffset: string | null;
  endDate: string | null;
  endDateOffset: string | null;
  isIndefinite: boolean; // time_end = "none" (évènement permanent)
  links: EventLink[];
  featuredCharacters: string[];
  specialReward: { type: string | null; options: string[] } | null;
  rewardGroups: EventRewardGroup[];
  releaseVersion: string;
}

interface CachedEvent {
  pageTitle: string;
  en: EventOutput;
  fr: EventOutput | null;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
};
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.warn(
          `⚠️  ${label} a échoué (tentative ${i + 1}/${attempts}), nouvel essai...`,
        );
        await sleep(800 * (i + 1));
      }
    }
  }
  throw lastErr;
}

async function fetchWikitext(
  apiUrl: string,
  pageTitle: string,
): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext "${pageTitle}"`, async () => {
      const response = await axios.get(apiUrl, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return page.revisions?.[0]?.slots?.main?.content ?? null;
    });
  } catch (err) {
    console.warn(
      `⚠️  Échec du fetch wikitext pour "${pageTitle}" après plusieurs tentatives: ${err}`,
    );
    return null;
  }
}

interface CategoryPage {
  pageTitle: string;
  content: string;
  frTitle: string | null;
}

async function fetchCategoryBatch(
  continueParams?: Record<string, string>,
): Promise<{ results: CategoryPage[]; nextContinue?: Record<string, string> }> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Events',
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
    ...continueParams,
  };

  const response = await axios.get(EN_API_URL, {
    params,
    headers: HTTP_HEADERS,
    httpsAgent,
  });

  const pages = response.data?.query?.pages ?? [];
  // Certaines pages du lot ont plus de langlinks que ce qu'un seul appel ne
  // peut renvoyer : dans ce cas l'API renvoie un `continue` portant sur
  // "llcontinue" (pagination des langlinks pour CE lot), pas "gcmcontinue"
  // (avancer au lot suivant) — les deux clés ne coexistent jamais dans le
  // même objet `continue`. Il faut renvoyer TOUT l'objet `continue` tel quel
  // au prochain appel (protocole standard de l'API MediaWiki), sinon la
  // pagination du générateur s'arrête prématurément dès qu'un lot déclenche
  // une continuation de langlinks (vécu en pratique : 150/1215 pages
  // seulement récupérées avant ce correctif, l'API renvoyant "llcontinue"
  // sans "gcmcontinue" au 3e lot).
  const nextContinue = response.data?.continue;
  const results: CategoryPage[] = pages.map((page: any) => ({
    pageTitle: page.title,
    content: page?.revisions?.[0]?.slots?.main?.content ?? '',
    frTitle: page.langlinks?.[0]?.title ?? null,
  }));

  return { results, nextContinue };
}

async function fetchAllCategoryPages(): Promise<CategoryPage[]> {
  // Un même titre de page peut réapparaître sur un lot de continuation de
  // langlinks (cf. NOTE dans fetchCategoryBatch) : on fusionne par pageTitle
  // plutôt que d'accumuler tel quel, en complétant frTitle/content si un
  // passage ultérieur les apporte et que le premier passage ne les avait pas.
  const byPageTitle = new Map<string, CategoryPage>();
  let cont: Record<string, string> | undefined;
  let page = 1;
  do {
    console.log(`Fetching Category:Events batch ${page}...`);
    const { results, nextContinue } = await fetchCategoryBatch(cont);
    for (const result of results) {
      const existing = byPageTitle.get(result.pageTitle);
      if (existing) {
        if (!existing.frTitle && result.frTitle)
          existing.frTitle = result.frTitle;
        if (!existing.content && result.content)
          existing.content = result.content;
        continue;
      }
      byPageTitle.set(result.pageTitle, result);
    }
    cont = nextContinue;
    page++;
    await sleep(400);
  } while (cont);
  return [...byPageTitle.values()];
}

// ── Wikitext helpers (repris tels quels des autres scripts scrape-*) ────────

function extractBracedBlock(
  content: string,
  startMarker: string,
): string | null {
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

function extractAllBracedBlocks(
  content: string,
  startMarker: string,
): string[] {
  const blocks: string[] = [];
  let offset = 0;
  while (true) {
    const idx = content.indexOf(startMarker, offset);
    if (idx === -1) break;
    const block = extractBracedBlock(content.slice(idx), startMarker);
    if (!block) break;
    blocks.push(block);
    offset = idx + block.length;
  }
  return blocks;
}

// Champs de {{Event}} : toujours des noms de paramètre alphanumériques fixes
// (name/type/time_start/group2/...), jamais de caractères spéciaux.
function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w]+)\s*=\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// Variante pour {{Event Rewards}} : les clés sont des NOMS D'OBJET (espaces,
// apostrophes, virgules possibles, ex: "Hero's Wit", "Statue of Her
// Excellency, the Almighty Narukami Ogosho, God of Thunder") — seul le "="
// délimite la clé, jamais un jeu de caractères restreint. Suppose un bloc
// multi-ligne (une entrée par ligne), seul format rencontré en pratique sur
// cette catégorie.
function parsePermissiveFields(block: string): Record<string, string> {
  // Retire "{{Event Rewards" (jusqu'au 1er retour à la ligne ou "|") en tête,
  // et le "}}" de fermeture du template en fin de bloc.
  const inner = block
    .replace(/^\{\{[^\n|]*/, '')
    .replace(/\}\}\s*$/, '');

  const fields: Record<string, string> = {};
  for (const line of inner.split('\n')) {
    const m = line.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
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
    .replace(/\s+/g, ' ')
    .trim();
}

// "/" -> "--" AVANT normalisation : une page peut coexister avec une page
// homonyme qui remplace juste ce "/" par un espace (vu en pratique : "...Fan
// Art Contest 2023-06-07" vs ".../2023-06-07", deux pages DIFFÉRENTES de
// Category:Events) — sans distinction, les deux collapsent sur le même slug
// et la seconde écrase silencieusement le fichier de la première. Les tirets
// simples (dates "2023-06-07") sont préservés tels quels (exclus du collapse
// générique) pour que seul "--" signale un ex-"/", jamais un tiret normal.
function slugify(title: string): string {
  return title
    .replace(/\//g, '--')
    .toLowerCase()
    .normalize('NFD')
    .replace(
      new RegExp(
        `[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`,
        'g',
      ),
      '',
    )
    .replace(/[^a-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseNumber(raw: string): number {
  const n = parseInt(raw.replace(/[,\s]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

// "2024-08-28 11:00:00" -> "2024-08-28T11:00:00" ; "2025-03-26" -> tel quel
// (certaines pages n'ont que la date, sans heure, ex: "A 'Tranquil' Day").
function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/,
  );
  if (!match) return null;
  return match[2] ? `${match[1]}T${match[2]}` : match[1];
}

// group, group2, group3, ... jusqu'à la première absente.
function parseGroups(fields: Record<string, string>): string[] {
  const groups: string[] = [];
  for (let i = 1; ; i++) {
    const key = i === 1 ? 'group' : `group${i}`;
    const value = fields[key];
    if (value === undefined) break;
    const cleaned = cleanWikitext(value);
    if (cleaned) groups.push(cleaned);
  }
  return groups;
}

const LINK_DEFAULT_LABELS = [
  'Official Announcement',
  'Gameplay Details',
  'Event Page',
];

// link/link2/link3 + linkname/link2name/link3name, avec les libellés par
// défaut du template {{Event}} (cf. Template:Event) quand aucun nom n'est
// fourni.
function parseLinks(fields: Record<string, string>): EventLink[] {
  const links: EventLink[] = [];
  for (let i = 1; i <= 3; i++) {
    const urlKey = i === 1 ? 'link' : `link${i}`;
    const nameKey = i === 1 ? 'linkname' : `link${i}name`;
    const url = fields[urlKey];
    if (!url) continue;
    const label = fields[nameKey]
      ? cleanWikitext(fields[nameKey])
      : LINK_DEFAULT_LABELS[i - 1];
    links.push({ label, url: url.trim() });
  }
  return links;
}

function parseSpecialReward(
  fields: Record<string, string>,
): { type: string | null; options: string[] } | null {
  const raw = fields['reward'];
  if (!raw) return null;
  return {
    type: fields['rewardType'] ? cleanWikitext(fields['rewardType']) : null,
    options: raw
      .split(',')
      .map((s) => cleanWikitext(s))
      .filter(Boolean),
  };
}

// {{Event Rewards|Item1 = Qté1|Item2 = Qté2|type=Original Resin|sort=...}} —
// "sort" (ordre d'affichage) et "type" (intitulé de catégorie, extrait à part
// en tant que `category`) ne sont jamais des récompenses.
function parseRewardBlock(block: string): EventRewardGroup {
  const fields = parsePermissiveFields(block);
  const rewards: EventReward[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'sort' || key === 'type') continue;
    rewards.push({ name: key, quantity: parseNumber(value) });
  }
  return {
    category: fields['type'] ? cleanWikitext(fields['type']) : null,
    rewards,
  };
}

function parseRewardGroups(content: string): EventRewardGroup[] {
  return extractAllBracedBlocks(content, '{{Event Rewards').map(
    parseRewardBlock,
  );
}

function parseDescription(content: string): string | null {
  const block = extractBracedBlock(content, '{{Description');
  if (!block) return null;
  const inner = block.replace(/^\{\{Description\|/, '').replace(/\}\}$/, '');
  return cleanWikitext(inner) || null;
}

// {{Other Languages|fr=...}} : nom FR documenté sur la page EN elle-même,
// utilisé en repli quand aucune page FR dédiée n'existe (cf. NOTE FR en tête
// de fichier, même principe que scrape-enemies.ts/scrape-domains.ts).
function parseOtherLanguagesFrName(content: string): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  const value = fields['fr'];
  return value ? cleanWikitext(value) : null;
}

// ── EN: {{Event}} ────────────────────────────────────────────────────────

interface RawEventEn {
  pageTitle: string;
  output: EventOutput;
  otherLanguagesFrName: string | null;
}

function parseEventEn(pageTitle: string, content: string): RawEventEn | null {
  const block = extractBracedBlock(content, '{{Event\n');
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
  const releaseVersion = versionMatch ? versionMatch[1].trim() : '';

  const timeEndRaw = (fields['time_end'] ?? '').trim().toLowerCase();
  const isIndefinite = timeEndRaw === 'none';

  const output: EventOutput = {
    pageTitle,
    name: cleanWikitext(fields['name'] ?? pageTitle) || pageTitle,
    type: cleanWikitext(fields['type'] ?? ''),
    groups: parseGroups(fields),
    parentEvent: fields['event'] ? cleanWikitext(fields['event']) : null,
    description: parseDescription(content),
    timeKnown: (fields['time_known'] ?? '').trim().toLowerCase() !== 'no',
    startDate: normalizeDate(fields['time_start']),
    startDateOffset: fields['time_start_offset']
      ? fields['time_start_offset'].trim()
      : null,
    endDate: isIndefinite ? null : normalizeDate(fields['time_end']),
    endDateOffset: fields['time_end_offset']
      ? fields['time_end_offset'].trim()
      : null,
    isIndefinite,
    links: parseLinks(fields),
    featuredCharacters: fields['characters']
      ? fields['characters']
          .split(';')
          .map((s) => cleanWikitext(s))
          .filter(Boolean)
      : [],
    specialReward: parseSpecialReward(fields),
    rewardGroups: parseRewardGroups(content),
    releaseVersion,
  };

  return {
    pageTitle,
    output,
    otherLanguagesFrName: parseOtherLanguagesFrName(content),
  };
}

// ── FR: {{Infobox Événements}} + {{Récompenses/Événement}} ─────────────────
// Seuls le nom (= titre de page) et les récompenses sont exploitables côté FR
// (cf. NOTE FR en tête de fichier) : le reste des champs vient de l'EN.

// "Primo-gemme*20, Mora*50000, Fragment de jade shivada*6" -> paires
// nom/quantité (délimiteur "," ou "¤" par défaut du template, cf.
// Modèle:Récompenses/Événement).
function parseFrRewardList(raw: string): EventReward[] {
  return raw
    .split(/[,¤]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Le séparateur de milliers observé côté FR est une espace, pas une
      // virgule (ex: "Mora*980 000") — la virgule est déjà le délimiteur
      // d'entrée, une quantité à 4+ chiffres ne peut donc pas l'utiliser.
      const m = entry.match(/^(.*?)\*([\d\s]+)$/);
      if (!m) return { name: cleanWikitext(entry), quantity: 1 };
      return { name: cleanWikitext(m[1]), quantity: parseNumber(m[2]) };
    });
}

function parseFrRewardGroups(content: string): EventRewardGroup[] | null {
  const block = extractBracedBlock(content, '{{Récompenses/Événement');
  if (!block) return null;
  const inner = block
    .replace(/^\{\{Récompenses\/Événement\s*\|/, '')
    .replace(/\}\}$/, '');
  // Ignore le paramètre nommé "choix_perso"/"choix_perso_rareté" (choix de
  // personnage) : seul le paramètre positionnel (liste de récompenses) nous
  // intéresse ici.
  const positional = inner
    .split('|')
    .find((part) => !/^\s*choix_perso/.test(part));
  if (!positional) return null;
  return [{ category: null, rewards: parseFrRewardList(positional) }];
}

function extractFrName(frTitle: string): string {
  return frTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function buildFrOutput(
  en: EventOutput,
  frTitle: string,
  frContent: string | null,
): EventOutput {
  const frRewardGroups = frContent ? parseFrRewardGroups(frContent) : null;
  return {
    ...en,
    name: extractFrName(frTitle),
    rewardGroups: frRewardGroups ?? en.rewardGroups,
  };
}

// ── Pipeline: 1 évènement ───────────────────────────────────────────────────

async function enrichEvent(page: CategoryPage): Promise<CachedEvent | null> {
  const raw = parseEventEn(page.pageTitle, page.content);
  if (!raw) return null;

  const en = raw.output;

  let fr: EventOutput | null = null;
  if (page.frTitle) {
    const frContent = await fetchWikitext(FR_API_URL, page.frTitle);
    if (frContent) {
      fr = buildFrOutput(en, page.frTitle, frContent);
    } else {
      console.warn(
        `⚠️  "${page.pageTitle}": page FR "${page.frTitle}" introuvable, fichier fr/ écrit avec le nom "${page.frTitle}".`,
      );
      fr = buildFrOutput(en, page.frTitle, null);
    }
  } else {
    const fallbackName = raw.otherLanguagesFrName;
    if (fallbackName) {
      fr = { ...en, name: fallbackName };
    } else {
      console.warn(
        `⚠️  "${page.pageTitle}": aucune page FR trouvée, fichier fr/ non généré.`,
      );
    }
  }

  return { pageTitle: page.pageTitle, en, fr };
}

async function fetchAndEnrichAll(): Promise<CachedEvent[]> {
  const pages = await fetchAllCategoryPages();
  const enriched: CachedEvent[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    console.log(`Processing "${page.pageTitle}" (${i + 1}/${pages.length})...`);
    try {
      const event = await enrichEvent(page);
      if (event) enriched.push(event);
    } catch (err) {
      console.warn(`⚠️  Échec du traitement de "${page.pageTitle}": ${err}`);
    }
    await sleep(300);
  }
  return enriched;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): CachedEvent[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: CachedEvent[]) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────
// Nom de fichier dérivé du TITRE DE PAGE (toujours unique), pas du nom
// affiché — même précaution que scrape-food.ts (des occurrences distinctes
// peuvent partager un nom affiché, ex: pages "(Event)" désambiguïsées).

function writeEventFiles(events: CachedEvent[], versionFilter?: string[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  const filtered = versionFilter?.length
    ? events.filter((e) => versionFilter.includes(e.en.releaseVersion))
    : events;

  let written = 0;
  let skippedFr = 0;
  for (const event of filtered) {
    const filename = `${slugify(event.pageTitle)}.json`;

    fs.writeFileSync(
      path.join(enDir, filename),
      JSON.stringify(event.en, null, 2),
      'utf-8',
    );

    if (event.fr) {
      fs.writeFileSync(
        path.join(frDir, filename),
        JSON.stringify(event.fr, null, 2),
        'utf-8',
      );
    } else {
      skippedFr++;
    }
    written++;
  }

  if (skippedFr > 0) {
    console.warn(
      `⚠️  ${skippedFr} évènement(s) sans traduction FR trouvée (fichier fr/ non écrit).`,
    );
  }
  console.log(`✅ Wrote ${written} event files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout   : npx ts-node -r tsconfig-paths/register scripts/scrape-events.ts --fetch',
    );
    console.error(
      '  Régénérer depuis cache : npx ts-node -r tsconfig-paths/register scripts/scrape-events.ts --cache',
    );
    console.error('  Filtrer par version(s) : ... --cache 5.0 5.1');
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let events: CachedEvent[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    events = cached;
    console.log(`Loaded ${events.length} events from cache.`);
  } else {
    console.log(
      'Fetching all events from wiki (this will take a while, ~1200 pages)...',
    );
    events = await fetchAndEnrichAll();
    saveCache(events);
  }

  writeEventFiles(events, versionFilter.length ? versionFilter : undefined);
}

main();
