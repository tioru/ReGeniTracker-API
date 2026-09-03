// scripts/scrape-domains.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  path.resolve(__dirname, `../prisma/data/domains/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Confirmé sur 3 domaines réels (Lightless Capital/Mastery, Lost Mooncourt/
// Forgery, Frostladen Machinery/Blessing) : Mora / Adventure EXP /
// Companionship EXP dépendent uniquement du "team level" (recLevel), PAS du
// type de domaine. Ex: recLevel=59 donne Mora=1850 / CompanionshipEXP=15
// aussi bien pour un domaine Forgery que Blessing. On utilise donc une seule
// table indexée par partyLevel plutôt que 3 tables séparées par type.
//
// requiredAR / recLevel sont normalement présents directement sur la page du
// domaine (contrairement à ce qu'on pensait au départ) — Lightless Capital,
// où requiredAR est mis en commentaire HTML, est une exception, pas la norme.
//
// Les données spécifiques à chaque domaine (cibles + vagues d'ennemis)
// viennent du template {{Domain Enemies}} présent sur la page du domaine,
// au format "Nom*quantité" séparé par ";" (ennemis d'une vague) et "//"
// (vagues d'un même niveau).
//
// Trounce Domains (ex: Beneath the Dragon-Queller) ont une structure
// complètement différente ({{Weekly Boss Rewards}}, pas de vagues
// d'ennemis) : le script les laisse volontairement avec rewards/levels
// vides plutôt que de deviner une structure incorrecte. À compléter
// séparément si besoin.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// Contrairement aux armes, les pages de domaines EN et FR ne sont PAS des
// sources équivalentes : le wiki FR utilise un template générique et bien
// plus pauvre ({{Infobox Lieux}} / {{Infobox_Lieux}}) qui ne contient QUE :
// - le nom traduit du domaine, le pays (identique à l'EN, ex: "Mondstadt"),
//   et parfois une région/zone (ex: "Forêt de jade") pour les Trounce/quest,
// - pour les domaines à rotation (Mastery/Forgery/Blessing) : un tableau
//   "Nom / Jours / Matériau" listant, par jour, le nom du lieu ET les
//   matériaux ({{Tuile|A,B,C|nano=1}}), dans le même ordre que les clés
//   mon/tue/wed de l'EN.
// Aucune trace de recLevel, de vagues d'ennemis, de cibles ("Defeat X
// opponents..."), ni de la description "lore" présente sur l'EN. On traduit
// donc uniquement ce qui EST disponible côté FR (nom, rotations, sous-lieu
// pour Trounce) et on réutilise tel quel le reste des données EN
// (description, éléments recommandés, niveaux/vagues/ennemis/récompenses),
// comme le fait déjà scrape-weapons.ts pour les vendeurs FR.
// ─────────────────────────────────────────────────────────────────────────────

interface LevelReward {
  adventureExp: number;
  mora: number;
  companionshipExp: number;
}

// Table combinée, indexée par team/party level, construite à partir des 3
// domaines de référence ci-dessus. Si un nouveau domaine utilise un
// partyLevel absent d'ici, getRewardForPartyLevel renverra undefined et un
// avertissement sera loggé — il suffit alors d'ajouter la ligne manquante.
const PARTY_LEVEL_REWARDS: Record<number, LevelReward> = {
  15: { adventureExp: 100, mora: 1125, companionshipExp: 10 },
  34: { adventureExp: 100, mora: 1525, companionshipExp: 15 },
  36: { adventureExp: 100, mora: 1550, companionshipExp: 15 },
  38: { adventureExp: 100, mora: 1575, companionshipExp: 15 },
  47: { adventureExp: 100, mora: 1700, companionshipExp: 15 },
  54: { adventureExp: 100, mora: 1800, companionshipExp: 15 },
  59: { adventureExp: 100, mora: 1850, companionshipExp: 15 },
  69: { adventureExp: 100, mora: 2025, companionshipExp: 20 },
  71: { adventureExp: 100, mora: 2050, companionshipExp: 20 },
  80: { adventureExp: 100, mora: 2200, companionshipExp: 20 },
  88: { adventureExp: 100, mora: 2375, companionshipExp: 20 },
  90: { adventureExp: 100, mora: 2525, companionshipExp: 20 },
  // 37/53/70/87 (Relics of the Fallen Grace) et 89 (Inverted Glacier) :
  // le champ recLevel de l'infobox de ces 2 pages est décalé de -1 par
  // rapport au "PartyLevel" du tableau de récompenses officiel affiché sur
  // la même page (confirmé : 38/54/71/88 et 90 respectivement, valeurs déjà
  // ci-dessus) — coquille wiki isolée à ces 2 pages, pas un vrai palier
  // supplémentaire. Alias plutôt que doublon de valeurs pour rester la
  // source unique de vérité si ces valeurs venaient à changer.
  37: { adventureExp: 100, mora: 1575, companionshipExp: 15 },
  53: { adventureExp: 100, mora: 1800, companionshipExp: 15 },
  70: { adventureExp: 100, mora: 2050, companionshipExp: 20 },
  87: { adventureExp: 100, mora: 2375, companionshipExp: 20 },
  89: { adventureExp: 100, mora: 2525, companionshipExp: 20 },
};

function getRewardForPartyLevel(
  partyLevel: number | undefined,
  context: string, // ex: "Forsaken Rift (niveau II)" — pour tracer facilement la source du warning
): LevelReward | undefined {
  if (partyLevel === undefined) return undefined;
  const reward = PARTY_LEVEL_REWARDS[partyLevel];
  if (!reward) {
    console.warn(
      `⚠️  Aucune récompense connue pour partyLevel=${partyLevel} (${context}). Ajoute une entrée dans PARTY_LEVEL_REWARDS.`,
    );
  }
  return reward;
}

// Libellés des récompenses de niveau, EN et FR (mêmes valeurs numériques,
// wording FR confirmé via les pages Trounce du wiki FR, ex: "EXP d'affinité"
// apparaît tel quel dans la liste des matériaux exclusifs de "Sous l'arbre
// dompteur de dragon").
const REWARD_LABELS = {
  en: { adventureExp: 'Adventure EXP', mora: 'Mora', companionshipExp: 'Companionship EXP' },
  fr: { adventureExp: "EXP d'Aventure", mora: 'Mora', companionshipExp: "EXP d'affinité" },
} as const;

interface RawEnemy {
  name: string;
  number: number;
}

interface RawLevel {
  targets: string[]; // un segment par vague (généralement identique pour toutes, mais peut différer, ex: vague normale + vague boss)
  waves: RawEnemy[][]; // une entrée par vague
}

interface RawRotation {
  baseDays: string[]; // ["monday", "thursday"], ["tuesday", "friday"] ou ["wednesday", "saturday"]
  name: string;
  // quality -> nom complet du matériau (déjà donné entier par le wiki,
  // ex: "Teachings of Moonlight" ou "Artful Device Fragment")
  materialsByQuality: Record<number, string>;
}

interface RawDomain {
  pageTitle: string;
  title: string;
  domainTypeRaw: string; // valeur brute du champ "type" de l'infobox: Mastery / Forgery / Blessing / Trounce / ...
  description: string;
  mainLocation: string; // "region" field
  subLocation: string; // "area" field
  recommendedElements: string[];
  recLevels: number[]; // "recLevel" splitté par "/", un par palier
  releaseVersion: string;
  rotations: RawRotation[]; // 0 à 3 rotations (les domaines n'ayant pas de {{Domain by Weekday}} en ont 0)
  levels: RawLevel[];
  quest: string; // champ "quest" de l'infobox (Quest Domains uniquement) — vide si absent
  questType: string; // champ "quest_type" de l'infobox — vide si absent
  frTitle: string | null; // titre de la page FR correspondante (via langlinks), null si absente
}

interface DomainOutput {
  name: string;
  domainType: string;
  location: { mainLocation: string; subLocation: string };
  description: string;
  recommendedElements: string[];
  releaseVersion: string;
  quest?: { name: string; type?: string };
  rewards: {
    days: string[];
    name: string;
    reward: { quality: number; name: string }[];
  }[];
  levels: {
    level: number;
    name: string;
    teamLevelRecommanded: number | undefined;
    rewards: { name: string; quantity: number }[];
    waves: {
      wave: number;
      description: string;
      enemies: { name: string; number: number; level: number | undefined }[];
    }[];
  }[];
}

interface CachedDomain {
  pageTitle: string;
  releaseVersion: string;
  en: DomainOutput;
  fr: DomainOutput | null;
}

// ── Wikitext helpers (repris tels quels du script achievements) ─────────────

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

function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Variante utilisée pour les infobox FR : les noms de champs peuvent contenir
// des accents (ex: "région"), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Certaines pages du wiki (ex: "Dougier's Kingdom" côté FR) contiennent des
// entités HTML tapées en dur dans le wikitext/titre (ex: "«&nbsp;Royaume&nbsp;»
// de Dougier") au lieu du caractère réel — jamais rendues côté wiki puisqu'on
// lit le wikitext brut / le titre de page tel quel, pas le HTML généré. On les
// décode explicitement plutôt que de les laisser fuiter telles quelles dans
// les champs "name".
const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
};

function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes('&')) return text;
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return decodeHtmlEntities(
    text
      .replace(/<!--[\s\S]*?-->/g, '') // commentaires HTML (ex: |requiredAR = <!-- 27/28/36/45 -->)
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/'''''/g, '')
      .replace(/'''/g, '')
      .replace(/''/g, '')
      .replace(/\{\{Icon\/Element\|([^}|]+)[^}]*\}\}/gi, '$1') // {{Icon/Element|Hydro|25}} -> Hydro
      .replace(/\{\{[^{}]*\}\}/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function toRoman(num: number): string {
  const map: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = num;
  let result = '';
  for (const [value, symbol] of map) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result || String(num);
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Sépare une liste séparée par des virgules ou "•"/retours à la ligne dans un
// champ comme recElements = Hydro, Electro
function splitList(value: string): string[] {
  return cleanWikitext(value)
    .split(/[,•\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Le champ "type" de l'infobox donne directement Mastery / Forgery / Blessing
// / Trounce / etc. On le transforme en libellé lisible.
function domainTypeLabel(rawType: string): string {
  const type = rawType.trim();
  if (!type) return '';
  if (/^(mastery|forgery|blessing)$/i.test(type)) {
    return `Domain of ${type[0].toUpperCase()}${type.slice(1).toLowerCase()}`;
  }
  if (/^trounce$/i.test(type)) return 'Trounce Domain';
  if (/^quest$/i.test(type)) return 'Quest Domain';
  return type;
}

// Équivalent FR, construit à la main (le wiki FR n'utilise qu'un seul champ
// "type" générique — "Donjon" ou "Donjon de la conquête" — qui ne distingue
// pas Mastery/Forgery/Blessing/Quest entre eux, cf. NOTE en tête de fichier).
function domainTypeLabelFr(rawType: string): string {
  const type = rawType.trim().toLowerCase();
  switch (type) {
    case 'mastery':
      return 'Domaine de maîtrise';
    case 'forgery':
      return 'Domaine de forge';
    case 'blessing':
      return 'Domaine de bénédiction';
    case 'trounce':
      return 'Donjon de la conquête';
    case 'quest':
      return 'Domaine de quête';
    case 'event':
      return 'Domaine évènementiel';
    case 'one-time':
      return 'Domaine à usage unique';
    case 'level':
      return 'Domaine de niveau';
    case 'special':
      return 'Domaine spécial';
    default:
      return domainTypeLabel(rawType);
  }
}

// ── Parsing du bloc {{Domain by Weekday}} (EN) ──────────────────────────────
// Champs attendus (cf. Genshin Impact Wiki:Domain Pages Guide) :
// mon-name, mon-2, mon-3, mon-4, mon-5, tue-name, tue-2, ... wed-name, wed-2, ...
// (mon-2/mon-3/mon-4 = qualité 2/3/4 ; mon-5 optionnel pour les domaines 5★)
//
// Chaque rotation (mon/tue/wed) couvre en réalité 2 jours (le contenu du wiki
// mon-* s'applique aussi bien le lundi que le jeudi, etc.) : on l'encode
// directement dans baseDays plutôt que de dupliquer 2x la même donnée.
function parseRotations(content: string): RawRotation[] {
  const block = extractBracedBlock(content, '{{Domain by Weekday');
  const result: RawRotation[] = [];
  if (!block) return result;

  const fields = parseInfoboxFields(block);
  const days: Record<string, string[]> = {
    mon: ['monday', 'thursday'],
    tue: ['tuesday', 'friday'],
    wed: ['wednesday', 'saturday'],
  };

  for (const [prefix, baseDays] of Object.entries(days)) {
    const name = fields[`${prefix}-name`];
    if (!name) continue;

    const materialsByQuality: Record<number, string> = {};
    for (const quality of [2, 3, 4, 5]) {
      const value = fields[`${prefix}-${quality}`];
      if (value) materialsByQuality[quality] = cleanWikitext(value);
    }

    result.push({
      baseDays,
      name: cleanWikitext(name),
      materialsByQuality,
    });
  }

  return result;
}

// ── Parsing du bloc {{Domain Enemies}} → cibles + vagues d'ennemis (EN) ────
// Format observé :
//   |target1  = Defeat 7 opponent(s) within 300 second(s)
//   |enemies1 = Name*2;Name2*2//Name3*2;Name4*1   (waves séparées par "//",
//                                                   ennemis d'une wave par ";")
function parseEnemiesString(enemiesRaw: string): RawEnemy[][] {
  return enemiesRaw.split('//').map((wave) =>
    wave
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, count] = entry.split('*').map((s) => s.trim());
        return {
          name: cleanWikitext(name ?? ''),
          number: parseInt(count ?? '1', 10) || 1,
        };
      }),
  );
}

function parseLevels(content: string): RawLevel[] {
  const block = extractBracedBlock(content, '{{Domain Enemies');
  if (!block) return [];

  const fields = parseInfoboxFields(block);
  const levels: RawLevel[] = [];

  for (let i = 1; ; i++) {
    const target = fields[`target${i}`];
    const enemies = fields[`enemies${i}`];
    if (!target && !enemies) break; // plus de palier au-delà de i-1

    const waves = enemies ? parseEnemiesString(enemies) : [];

    // La cible peut contenir plusieurs segments séparés par "//" (un par
    // vague, ex: Cecilia Garden IV = vague normale + vague "boss" avec un
    // objectif différent). Si un seul segment est présent, on le réutilise
    // pour toutes les vagues (cas le plus courant).
    const targetSegments = (target ?? '')
      .split('//')
      .map((t) => cleanWikitext(t))
      .filter(Boolean);
    const targets =
      targetSegments.length > 0
        ? waves.map(
            (_, idx) =>
              targetSegments[idx] ?? targetSegments[targetSegments.length - 1],
          )
        : [];

    levels.push({ targets, waves });
  }

  return levels;
}

// ── Parsing FR (wikitext brut, {{Infobox Lieux}} / {{Infobox_Lieux}}) ──────

interface FrDomainPage {
  title: string;
  subLocation: string | null; // région/zone — uniquement présent pour Trounce/quest
  rotations: { name: string; materials: string[] }[]; // dans l'ordre mon/tue/wed
  // true si issu d'une vraie page FR dédiée (via langlinks) ; false si le nom
  // provient uniquement du fallback "Other Languages" de la page EN (cf.
  // parseFrNameFromOtherLanguages) — dans ce cas rotations/subLocation sont
  // toujours vides et il ne faut pas avertir sur un "tableau non aligné".
  hasFullPage: boolean;
}

// Extrait le contenu (texte + listes séparées par des virgules) d'un template
// {{Tuile|A,B,C|nano=1}} ou {{Tuile|mini=1|A,B|show_caption=1}}, en ignorant
// les paramètres nommés (nano=1, mini=1, show_caption=1, ...).
function parseTuileList(raw: string): string[] {
  const block = extractBracedBlock(raw, '{{Tuile');
  if (!block) return [];
  const inner = block.replace(/^\{\{Tuile\|/, '').replace(/\}\}$/, '');
  const listPart = inner
    .split('|')
    .find((part) => !/^[a-z_]+\s*=/i.test(part.trim()));
  if (!listPart) return [];
  return listPart
    .split(',')
    .map((s) => cleanWikitext(s.trim()))
    .filter(Boolean);
}

// Parse le tableau "Nom / Jours / Matériau" présent sur les pages FR des
// domaines à rotation (Mastery/Forgery/Blessing). Les lignes apparaissent
// dans le même ordre que les clés mon/tue/wed de l'EN (Lundi-Jeudi,
// Mardi-Vendredi, Mercredi-Samedi).
function parseFrRotationsTable(content: string): { name: string; materials: string[] }[] {
  const tableStart = content.indexOf('class="article-table"');
  if (tableStart === -1) return [];
  const blockStart = content.lastIndexOf('{|', tableStart);
  if (blockStart === -1) return [];
  const blockEnd = content.indexOf('\n|}', blockStart);
  const block = content.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);

  const rows: { name: string; materials: string[] }[] = [];
  const rowChunks = block.split(/\n\|-/).slice(1);
  for (const chunk of rowChunks) {
    const cells = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'))
      .map((l) => l.replace(/^\|/, '').trim());
    if (cells.length < 3) continue;

    const name = cleanWikitext(cells[0]);
    const materials = parseTuileList(cells[2]);
    if (name && materials.length) rows.push({ name, materials });
  }
  return rows;
}

function parseFrDomainPage(content: string): FrDomainPage {
  const marker = content.includes('{{Infobox_Lieux')
    ? '{{Infobox_Lieux'
    : '{{Infobox Lieux';
  const block = extractBracedBlock(content, marker);
  const fields = block ? parseInfoboxFieldsAccented(block) : {};

  const subLocationRaw = fields['région'] ?? fields['zone'] ?? '';

  return {
    title: '', // renseigné séparément (titre de page)
    subLocation: subLocationRaw ? cleanWikitext(subLocationRaw) : null,
    rotations: parseFrRotationsTable(content),
    hasFullPage: true,
  };
}

// Fallback quand aucun langlink FR (ni groupé, ni dédié) n'a été trouvé pour
// une page : le wikitext EN documente en principe le nom officiel dans
// chaque langue via {{Other Languages}}, indépendamment de l'existence d'un
// lien interwiki. Confirmé sur "Twinning Isle" : aucun langlink FR, mais
// |fr = Îles jumelles présent dans le wikitext ET une page FR "Îles
// jumelles" existe bel et bien (juste sans lien interwiki réciproque).
//
// MAIS deux formats coexistent sur ce wiki :
// - les pages de lieux (comme "Twinning Isle") embarquent les traductions en
//   clair : {{Other Languages|en=...|fr=Îles jumelles|...}} — extractible
//   directement du wikitext, sans requête supplémentaire.
// - les pages de domaines (comme "A Forest of Change (Domain)") appellent le
//   template avec un seul paramètre positionnel, {{Other Languages|Titre}},
//   et les traductions sont résolues par un module Lua central invisible en
//   wikitext brut : il faut alors la page RENDUE (action=parse) pour les
//   obtenir. D'où les deux tentatives ci-dessous, wikitext puis HTML rendu.
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

// Combine les deux tentatives ci-dessus : wikitext (gratuit si le contenu
// est déjà en main, sinon 1 requête) puis, si rien trouvé, page rendue (1
// requête de plus, plus coûteuse mais gère le cas du module Lua central).
async function resolveFrNameViaOtherLanguages(
  pageTitle: string,
  wikitext?: string | null,
): Promise<string | null> {
  const content = wikitext !== undefined ? wikitext : await fetchEnWikitext(pageTitle);
  const fromWikitext = content ? parseOtherLanguagesField(content, 'fr') : null;
  if (fromWikitext) return fromWikitext;

  const html = await fetchEnHtml(pageTitle);
  return html ? parseFrNameFromOtherLanguagesHtml(html) : null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchBatch(continueParams?: Record<string, string>): Promise<{
  results: RawDomain[];
  nextContinueParams?: Record<string, string>;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Domains',
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
  const nextContinueParams = response.data?.continue;
  const results: RawDomain[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    if (!content.includes('{{Domain Infobox')) continue;

    const block = extractBracedBlock(content, '{{Domain Infobox');
    if (!block) continue;
    const fields = parseInfoboxFields(block);

    // Quest Domains (type=Quest) sont liés à une quête précise, pas
    // farmables librement : hors périmètre du tracker, on les exclut dès
    // la source plutôt que de les enrichir/écrire pour rien.
    if ((fields['type'] ?? '').trim().toLowerCase() === 'quest') continue;

    const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';
    const frTitle: string | null = page.langlinks?.[0]?.title
      ? decodeHtmlEntities(page.langlinks[0].title)
      : null;

    results.push({
      pageTitle: page.title,
      title: decodeHtmlEntities(page.title.trim()),
      domainTypeRaw: fields['type'] ?? '',
      description: cleanWikitext(fields['description'] ?? ''),
      mainLocation: cleanWikitext(fields['region'] ?? fields['nation'] ?? ''),
      subLocation: cleanWikitext(fields['area'] ?? fields['domain'] ?? ''),
      recommendedElements: splitList(fields['recElements'] ?? ''),
      recLevels: cleanWikitext(fields['recLevel'] ?? '')
        .split('/')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !Number.isNaN(v)),
      releaseVersion: version,
      rotations: parseRotations(content),
      levels: parseLevels(content),
      quest: cleanWikitext(fields['quest'] ?? ''),
      questType: cleanWikitext(fields['quest_type'] ?? ''),
      frTitle,
    });
  }

  return { results, nextContinueParams };
}

async function fetchAll(): Promise<RawDomain[]> {
  // Comme pour scrape-weapons.ts : MediaWiki peut renvoyer une même page
  // plusieurs fois tant que tous les langlinks du lot ne sont pas résolus.
  // On dédoublonne par pageTitle et on complète frTitle si un round
  // ultérieur l'apporte.
  const byPageTitle = new Map<string, RawDomain>();
  let continueParams: Record<string, string> | undefined;
  let page = 1;
  do {
    console.log(`Fetching batch ${page}...`);
    const { results, nextContinueParams } = await fetchBatch(continueParams);
    for (const domain of results) {
      const existing = byPageTitle.get(domain.pageTitle);
      if (existing) {
        if (domain.frTitle) existing.frTitle = domain.frTitle;
        continue;
      }
      byPageTitle.set(domain.pageTitle, domain);
    }
    continueParams = nextContinueParams;
    page++;
    await sleep(500);
  } while (continueParams);
  return Array.from(byPageTitle.values());
}

// Repli quand le langlink groupé (generator=categorymembers + prop=langlinks
// dans le même appel, cf. fetchBatch) n'a pas été résolu pour une page
// donnée : MediaWiki peut mêler la continuation de la pagination de
// catégorie (gcmcontinue) et celle des langlinks (llcontinue) de façon à ce
// qu'une page du lot précédent ne soit jamais re-proposée avec son
// langlink — observé en pratique (reproductible sur les mêmes domaines à
// deux runs complets d'affilée), alors qu'une requête dédiée par page
// (titles=X) résout le langlink sans problème. On retente donc en dédié
// avant d'abandonner sur le fallback "Other Languages" (nom seul).
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
      const title = page?.langlinks?.[0]?.title;
      return title ? decodeHtmlEntities(title) : null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch langlink FR pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

// Beaucoup de domaines n'ont pas de champ région/zone dans leur propre
// infobox FR (cf. NOTE en tête de fichier), mais le sous-lieu (ex:
// "Windwail Highland", "Hiisi Island") est lui-même une page du wiki avec
// son propre nom FR — confirmé en pratique sur plusieurs sous-lieux. Le
// langlink direct (rapide, 1 requête) est essayé en premier ; si absent, on
// retombe sur {{Other Languages}} (cf. resolveFrNameViaOtherLanguages, qui
// gère les deux formats du wiki). Résultat mis en cache car de nombreux
// domaines partagent le même sous-lieu.
const subLocationTranslationCache = new Map<string, string | null>();

async function fetchSubLocationFr(enSubLocation: string): Promise<string | null> {
  if (subLocationTranslationCache.has(enSubLocation)) {
    return subLocationTranslationCache.get(enSubLocation)!;
  }
  let result = await fetchFrTitleDirect(enSubLocation);
  if (!result) {
    result = await resolveFrNameViaOtherLanguages(enSubLocation);
  }
  subLocationTranslationCache.set(enSubLocation, result);
  return result;
}

// ── Construction des objets de sortie (EN et FR) ────────────────────────────

function buildRotationsOutput(
  domain: RawDomain,
  lang: 'en' | 'fr',
  frPage: FrDomainPage | null,
) {
  return domain.rotations.map((rotation, idx) => {
    const frRow = frPage?.rotations[idx];
    const qualities = Object.keys(rotation.materialsByQuality)
      .map(Number)
      .sort((a, b) => a - b);

    let name = rotation.name;
    let materialsByQuality = rotation.materialsByQuality;

    if (lang === 'fr') {
      if (frRow && frRow.materials.length === qualities.length) {
        name = frRow.name;
        materialsByQuality = Object.fromEntries(
          qualities.map((quality, i) => [quality, frRow.materials[i]]),
        );
      } else {
        // Page FR absente ou tableau non aligné avec l'EN (nombre de
        // paliers différent) : on réutilise les noms EN plutôt que de
        // produire une correspondance incorrecte. Pas d'avertissement pour
        // le fallback "Other Languages" (hasFullPage: false), qui n'a par
        // définition jamais de tableau de rotation.
        if (frPage?.hasFullPage) {
          console.warn(
            `⚠️  "${domain.title}": rotation "${rotation.name}" non traduite (tableau FR non aligné).`,
          );
        }
      }
    }

    return {
      // Chaque rotation est active ses 2 jours de base + le dimanche (règle
      // du jeu : le dimanche, TOUS les jeux de matériaux sont disponibles en
      // même temps). Encodé ici plutôt que dupliqué.
      days: [...rotation.baseDays, 'sunday'],
      name,
      reward: qualities.map((quality) => ({
        quality,
        name: materialsByQuality[quality],
      })),
    };
  });
}

function buildLevelsOutput(domain: RawDomain, lang: 'en' | 'fr', title: string) {
  const labels = REWARD_LABELS[lang];

  return domain.levels.map((level, idx) => {
    const levelIndex = idx + 1;
    const teamLevelRecommanded = domain.recLevels[idx];
    const reward = getRewardForPartyLevel(
      teamLevelRecommanded,
      `${domain.title} ${toRoman(levelIndex)}`,
    );

    return {
      level: levelIndex,
      name: `${title} ${toRoman(levelIndex)}`,
      teamLevelRecommanded,
      rewards: reward
        ? [
            { name: labels.adventureExp, quantity: reward.adventureExp },
            { name: labels.mora, quantity: reward.mora },
            { name: labels.companionshipExp, quantity: reward.companionshipExp },
          ]
        : [], // partyLevel absent de PARTY_LEVEL_REWARDS → table à compléter (voir warning console)
      // La description (objectif) et les noms d'ennemis ne sont disponibles
      // que côté EN (le wiki FR n'a pas d'équivalent au template {{Domain
      // Enemies}}) : réutilisés tels quels pour la version FR, comme le fait
      // scrape-weapons.ts pour les vendeurs.
      waves: level.waves.map((wave, waveIdx) => ({
        wave: waveIdx + 1,
        description: level.targets[waveIdx] ?? '',
        enemies: wave.map((enemy) => ({
          name: enemy.name,
          number: enemy.number,
          level: teamLevelRecommanded,
        })),
      })),
    };
  });
}

function buildDomainOutput(
  domain: RawDomain,
  lang: 'en' | 'fr',
  frPage: FrDomainPage | null,
): DomainOutput {
  const title = lang === 'fr' && frPage ? frPage.title : domain.title;
  const domainType =
    lang === 'fr'
      ? domainTypeLabelFr(domain.domainTypeRaw)
      : domainTypeLabel(domain.domainTypeRaw);

  // mainLocation (pays/région) est un nom propre inchangé entre EN et FR
  // (Mondstadt, Liyue, Inazuma, ...), confirmé sur les pages FR observées :
  // pas besoin de traduction. subLocation en revanche est traduit côté FR,
  // mais seulement présent sur les pages Trounce/quest.
  const subLocation =
    lang === 'fr' && frPage?.subLocation ? frPage.subLocation : domain.subLocation;

  return {
    name: title,
    domainType,
    location: {
      mainLocation: domain.mainLocation,
      subLocation,
    },
    // Pas d'équivalent "lore" exploitable côté FR (cf. NOTE en tête de
    // fichier) : réutilisé tel quel.
    description: domain.description,
    recommendedElements: domain.recommendedElements,
    releaseVersion: domain.releaseVersion,
    // Uniquement présent pour les Quest Domains (absent partout ailleurs).
    ...(domain.quest
      ? { quest: { name: domain.quest, type: domain.questType || undefined } }
      : {}),
    rewards: buildRotationsOutput(domain, lang, frPage),
    levels: buildLevelsOutput(domain, lang, title),
  };
}

async function enrichDomain(domain: RawDomain): Promise<CachedDomain> {
  let frPage: FrDomainPage | null = null;

  let frTitle = domain.frTitle;

  if (frTitle) {
    const frContent = await fetchFrWikitext(frTitle);
    if (frContent) {
      frPage = { ...parseFrDomainPage(frContent), title: frTitle };
    }
  }

  // Le langlink groupé de fetchBatch n'a rien donné (ou la page FR récupérée
  // via ce titre s'est révélée introuvable) : on retente une résolution
  // dédiée par page avant d'abandonner (cf. commentaire de
  // fetchFrTitleDirect).
  if (!frPage) {
    frTitle = await fetchFrTitleDirect(domain.pageTitle);
    if (frTitle) {
      const frContent = await fetchFrWikitext(frTitle);
      if (frContent) {
        frPage = { ...parseFrDomainPage(frContent), title: frTitle };
      }
    }
  }

  // Toujours pas de page FR trouvée via langlink : on récupère le nom
  // officiel FR documenté dans {{Other Languages}} (cf.
  // resolveFrNameViaOtherLanguages) et on tente de fetch une VRAIE page FR
  // sous ce nom — souvent présente malgré l'absence de langlink réciproque
  // (confirmé sur "Twinning Isle" → "Îles jumelles"). Seulement si cette
  // page n'existe vraiment pas on se rabat sur le nom seul.
  if (!frPage) {
    const frName = await resolveFrNameViaOtherLanguages(domain.pageTitle);
    if (frName) {
      const frContent = await fetchFrWikitext(frName);
      frPage = frContent
        ? { ...parseFrDomainPage(frContent), title: frName }
        : { title: frName, subLocation: null, rotations: [], hasFullPage: false };
    }
  }

  // La page FR du domaine elle-même n'a pas toujours de champ région/zone
  // (cf. NOTE en tête de fichier), mais le sous-lieu EN est en général une
  // page à part entière dont on peut récupérer le langlink FR séparément.
  if (frPage && !frPage.subLocation && domain.subLocation) {
    frPage.subLocation = await fetchSubLocationFr(domain.subLocation);
  }

  const en = buildDomainOutput(domain, 'en', frPage);
  const fr = frPage ? buildDomainOutput(domain, 'fr', frPage) : null;

  return { pageTitle: domain.pageTitle, releaseVersion: domain.releaseVersion, en, fr };
}

async function fetchAndEnrichAll(): Promise<CachedDomain[]> {
  console.log('Fetching all domains from wiki (this will take a few minutes)...');
  const rawDomains = await fetchAll();
  const enriched: CachedDomain[] = [];

  for (let i = 0; i < rawDomains.length; i++) {
    const domain = rawDomains[i];
    console.log(`Enriching "${domain.pageTitle}" (${i + 1}/${rawDomains.length})...`);
    enriched.push(await enrichDomain(domain));
    await sleep(300);
  }

  return enriched;
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeDomainFiles(domains: CachedDomain[], versionFilter?: string[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  const filtered = versionFilter?.length
    ? domains.filter((d) => versionFilter.includes(d.releaseVersion))
    : domains;

  let written = 0;
  let skippedFr = 0;
  for (const domain of filtered) {
    const filename = `${slugify(domain.en.name)}.json`;

    fs.writeFileSync(
      path.join(enDir, filename),
      JSON.stringify(domain.en, null, 2),
      'utf-8',
    );

    if (domain.fr) {
      fs.writeFileSync(
        path.join(frDir, filename),
        JSON.stringify(domain.fr, null, 2),
        'utf-8',
      );
    } else {
      skippedFr++;
    }

    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} domaine(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} domain files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== '--fetch') {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout    : npx ts-node ... scrape-domains.ts --fetch',
    );
    console.error(
      '  Filtrer par version(s)   : ... --fetch "Luna I" "Luna II"',
    );
    process.exit(1);
  }

  const versionFilter = args.slice(1);
  const domains = await fetchAndEnrichAll();
  writeDomainFiles(domains, versionFilter.length ? versionFilter : undefined);
}

main();
