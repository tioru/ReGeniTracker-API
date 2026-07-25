import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';

const API_URLS: Record<string, string> = {
  en: 'https://genshin-impact.fandom.com/api.php',
  fr: 'https://genshin-impact.fandom.com/fr/api.php',
  de: 'https://de.genshin-impact.fandom.com/api.php',
  es: 'https://es.genshin-impact.fandom.com/api.php',
  zh: 'https://genshin-impact.fandom.com/zh/api.php',
};

// Langues dont le pipeline de scraping est réellement implémenté à ce jour.
// de/es/zh ont encore leurs URLs mais pas de logique de parsing dédiée.
const IMPLEMENTED_LANGS = new Set(['en', 'fr']);

const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/banners');

const BANNER_CATEGORY: Record<string, string> = {
  en: 'Category:Wish_Banners',
};

// Le wiki FR sépare les bannières armes et personnages dans deux catégories
// de fichiers distinctes, avec des conventions de nommage différentes :
// - Armes      : "Nom Date.png"          → date exploitable directement
// - Personnages: "Bannière Nom N.png"    → juste un numéro de série, pas de date
const BANNER_CATEGORIES_FR = {
  weapon: 'Catégorie:Image_Bannière',
  character: 'Catégorie:Image Bannière personnage',
};

// Bannières permanentes (standard/novice) : une seule page par langue, sans
// date, jamais listée dans les catégories de fichiers d'occurrences
// événementielles. Il faut les cibler nommément plutôt que les découvrir.
// Noms confirmés via les liens interlangues (prop=langlinks) depuis les
// pages EN de référence.
const PERMANENT_BANNERS: Record<string, string[]> = {
  en: ['Wanderlust Invocation', "Beginners' Wish"],
  // Le novice FR ("Vœux recommandés pour les débutants") n'a pas de données
  // structurées exploitables (pas de template dédié, juste du texte
  // descriptif) : seul le standard est inclus pour l'instant.
  fr: ['Envie de voyage'],
};

function getBannerCategory(lang: string): string {
  return BANNER_CATEGORY[lang] ?? BANNER_CATEGORY['en'];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CharacterBannerData {
  name: string;
  type: 'character';
  boostedCharacters: {
    featured5Star: string;
    featured4Star: string[];
  };
  otherCharacters: {
    featured5Star: string[];
    featured4Star: string[];
  };
  weapons: {
    featured4Star: string[];
    featured3Star: string[];
  };
  releaseDate: string;
  endDate: string;
}

interface WeaponBannerData {
  name: string;
  type: 'weapon';
  releaseDate: string;
  endDate: string;
  boostedWeapons: {
    featured5Star: string[];
    featured4Star: string[];
  };
  characters: {
    featured4Star: string[];
  };
  otherWeapons: {
    featured5Star: string[];
    featured4Star: string[];
    featured3Star: string[];
  };
}

interface ChronicledBannerData {
  name: string;
  type: 'chronicled';
  mechanic: 'chronicled' | 'lightrace';
  characters: {
    featured5Star: string[];
    featured4Star: string[];
  };
  weapons: {
    featured5Star: string[];
    featured4Star: string[];
    featured3Star: string[];
  };
  releaseDate: string;
  endDate: string;
}

interface StandardBannerData {
  name: string;
  type: 'standard';
  characters: {
    featured5Star: string[];
    featured4Star: string[];
  };
  weapons: {
    featured5Star: string[];
    featured4Star: string[];
    featured3Star: string[];
  };
  releaseDate: string;
}

interface NoviceBannerData {
  name: string;
  type: 'novice';
  characters: {
    featured5Star: string[];
    featured4Star: string[];
  };
  weapons: {
    featured3Star: string[];
  };
  releaseDate: string;
}

type BannerData =
  | CharacterBannerData
  | WeaponBannerData
  | ChronicledBannerData
  | StandardBannerData
  | NoviceBannerData;

// ── HTTP ──────────────────────────────────────────────────────────────────────

function getApiUrl(lang: string): string {
  return API_URLS[lang] ?? API_URLS['en'];
}

function createHttpsAgent(): https.Agent {
  return new https.Agent({ keepAlive: true });
}

// Le wiki fandom coupe parfois la connexion (ECONNRESET) ou renvoie un 429/503
// après une rafale de requêtes rapprochées. On retente avec un backoff
// exponentiel plutôt que d'abandonner l'occurrence : sans ça, une bannière
// pourtant valide finit marquée en échec dans les logs (vu en pratique sur la
// fin d'un scraping --all, ~7 occurrences perdues pour rien).
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
]);

function isRetryableError(err: any): boolean {
  if (RETRYABLE_CODES.has(err?.code)) return true;
  const status = err?.response?.status;
  return status === 429 || status === 503;
}

async function axiosGetWithRetry(
  url: string,
  config: Record<string, unknown>,
  maxRetries = 4,
): Promise<any> {
  let attempt = 0;
  for (;;) {
    try {
      return await axios.get(url, config);
    } catch (err: any) {
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      const delay = 1000 * 2 ** attempt;
      console.error(
        `  ⚠️  ${err.code ?? err.response?.status} — retry ${attempt + 1}/${maxRetries} dans ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

async function fetchPageWikitext(
  pageTitle: string,
  lang: string,
): Promise<string> {
  const response = await axiosGetWithRetry(getApiUrl(lang), {
    params: {
      action: 'query',
      titles: pageTitle,
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
      Accept: 'application/json',
    },
    httpsAgent: createHttpsAgent(),
  });

  const pages = response.data?.query?.pages;
  if (!pages || pages.length === 0) throw new Error('Page not found');
  if (pages[0]?.missing) throw new Error(`Page missing: ${pageTitle}`);
  const content = pages[0]?.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error('No content found');
  return content;
}

async function fetchExpandTemplate(
  templateCall: string,
  contextTitle: string,
  lang: string,
): Promise<string> {
  const response = await axiosGetWithRetry(getApiUrl(lang), {
    params: {
      action: 'expandtemplates',
      text: templateCall,
      title: contextTitle,
      prop: 'wikitext',
      format: 'json',
      formatversion: '2',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
      Accept: 'application/json',
    },
    httpsAgent: createHttpsAgent(),
  });
  return response.data?.expandtemplates?.wikitext ?? '';
}

async function fetchRenderedHtml(
  pageTitle: string,
  lang: string,
): Promise<string> {
  const response = await axiosGetWithRetry(getApiUrl(lang), {
    params: {
      action: 'parse',
      page: pageTitle,
      prop: 'text',
      format: 'json',
      formatversion: '2',
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
      Accept: 'application/json',
    },
    httpsAgent: createHttpsAgent(),
  });

  const html = response.data?.parse?.text;
  if (!html) throw new Error('No rendered HTML found');
  return html;
}

// Format de date accepté dans les titres de page : AAAA-MM-JJ (en) ou JJ.MM.AAAA (fr)
const PAGE_DATE_PATTERN = String.raw`(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})`;

async function fetchAllOccurrencesViaPrefix(
  seriesName: string,
  lang: string,
): Promise<string[]> {
  const prefix = `${seriesName}/`;
  const titles: string[] = [];
  let apcontinue: string | undefined = undefined;
  const dateRegex = new RegExp(`\\/${PAGE_DATE_PATTERN}$`);

  do {
    const response: any = await axiosGetWithRetry(getApiUrl(lang), {
      params: {
        action: 'query',
        list: 'allpages',
        apprefix: prefix,
        apfilterredir: 'nonredirects',
        aplimit: 'max',
        ...(apcontinue ? { apcontinue } : {}),
        format: 'json',
        formatversion: '2',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
        Accept: 'application/json',
      },
      httpsAgent: createHttpsAgent(),
    });

    const pages = response.data?.query?.allpages ?? [];
    titles.push(
      ...pages
        .map((p: { title: string }) => p.title)
        .filter((title: string) => dateRegex.test(title)),
    );

    apcontinue = response.data?.continue?.apcontinue;
    if (apcontinue) await new Promise((r) => setTimeout(r, 300));
  } while (apcontinue);

  return titles;
}

async function fetchCategoryFileMembers(
  categoryTitle: string,
  lang: string,
): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined = undefined;

  do {
    const response: any = await axiosGetWithRetry(getApiUrl(lang), {
      params: {
        action: 'query',
        list: 'categorymembers',
        cmtitle: categoryTitle,
        cmnamespace: '6',
        cmlimit: 'max',
        ...(cmcontinue ? { cmcontinue } : {}),
        format: 'json',
        formatversion: '2',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)',
        Accept: 'application/json',
      },
      httpsAgent: createHttpsAgent(),
    });

    const members = response.data?.query?.categorymembers ?? [];
    titles.push(...members.map((m: { title: string }) => m.title));

    cmcontinue = response.data?.continue?.cmcontinue;
    if (cmcontinue) await new Promise((r) => setTimeout(r, 300));
  } while (cmcontinue);

  return titles;
}

// Catégorie unique, fichiers "Nom Date.png" → occurrences directes (schéma EN).
async function fetchAllBannerOccurrencesFromCategory(
  lang: string,
): Promise<string[]> {
  const fileTitles = await fetchCategoryFileMembers(
    getBannerCategory(lang),
    lang,
  );
  const fileRegex = new RegExp(`^[^:]+:(.+) ${PAGE_DATE_PATTERN}\\.png$`);
  const titles: string[] = [];

  for (const title of fileTitles) {
    const match = title.match(fileRegex);
    if (match) {
      const [, name, date] = match;
      titles.push(`${name}/${date}`);
    }
  }

  return [...new Set(titles)];
}

// Schéma FR : deux catégories, deux stratégies.
async function fetchAllBannerOccurrencesFr(lang: string): Promise<string[]> {
  const occurrences: string[] = [];

  // Armes : "Fichier:Nom JJ.MM.AAAA.png" → occurrence directe.
  const weaponFileTitles = await fetchCategoryFileMembers(
    BANNER_CATEGORIES_FR.weapon,
    lang,
  );
  const weaponFileRegex = new RegExp(`^[^:]+:(.+) ${PAGE_DATE_PATTERN}\\.png$`);
  for (const title of weaponFileTitles) {
    const match = title.match(weaponFileRegex);
    if (match) {
      const [, name, date] = match;
      occurrences.push(`${name}/${date}`);
    }
  }

  // Personnages : "Fichier:Bannière Nom N.png" → juste le nom de série, pas de
  // date. On récupère le nom, puis on élargit chaque série via allpages
  // (fetchAllOccurrencesViaPrefix) pour obtenir ses vraies occurrences datées.
  const characterFileTitles = await fetchCategoryFileMembers(
    BANNER_CATEGORIES_FR.character,
    lang,
  );
  const characterNameRegex = /^[^:]+:Bannière (.+) \d+\.png$/;
  const seriesNames = new Set<string>();
  for (const title of characterFileTitles) {
    const match = title.match(characterNameRegex);
    if (match) seriesNames.add(match[1].trim());
  }

  for (const seriesName of seriesNames) {
    const seriesOccurrences = await fetchAllOccurrencesViaPrefix(
      seriesName,
      lang,
    );
    occurrences.push(...seriesOccurrences);
    await new Promise((r) => setTimeout(r, 300));
  }

  return [...new Set(occurrences)];
}

// ── Utilitaires communs ─────────────────────────────────────────────────────

function splitSemicolon(value: string): string[] {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprime les diacritiques (é→e, à→a, ç→c...)
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/['']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function toFilename(name: string, releaseDate: string): string {
  return `${slugify(name)}_${releaseDate}.json`;
}

// ══════════════════════════════════════════════════════════════════════════
// ── EN — parsing par paramètres wikitext (|type=, |character_5_F=, etc.) ───
// ══════════════════════════════════════════════════════════════════════════

function extractWishParam(wikitext: string, param: string): string {
  const match = wikitext.match(new RegExp(`\\|\\s*${param}\\s*=\\s*([^\n|]+)`));
  return match ? match[1].trim() : '';
}

function extractDatesEn(wikitext: string): {
  releaseDate: string;
  endDate: string;
} {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const endMatch = wikitext.match(/\|time_end\s*=\s*(\d{4}-\d{2}-\d{2})/);
  return {
    releaseDate: startMatch ? startMatch[1] : '',
    endDate: endMatch ? endMatch[1] : '',
  };
}

function extractBannerNameEn(wikitext: string, pageTitle: string): string {
  const nameMatch = wikitext.match(/\|name\s*=\s*([^\n|]+)/);
  if (nameMatch) {
    return nameMatch[1]
      .trim()
      .replace(/\s+\d{4}-\d{2}-\d{2}$/, '')
      .trim();
  }
  return pageTitle.replace(/\/[\d.\-]+$/, '').replace(/_/g, ' ');
}

function parseCharacterBannerEn(
  wikitext: string,
  pageTitle: string,
): CharacterBannerData {
  const { releaseDate, endDate } = extractDatesEn(wikitext);
  const name = extractBannerNameEn(wikitext, pageTitle);

  return {
    name,
    type: 'character',
    boostedCharacters: {
      featured5Star: extractWishParam(wikitext, 'character_5_F'),
      featured4Star: splitSemicolon(
        extractWishParam(wikitext, 'character_4_F'),
      ),
    },
    otherCharacters: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'character_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'character_4')),
    },
    weapons: {
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'weapon_4')),
      featured3Star: splitSemicolon(extractWishParam(wikitext, 'weapon_3')),
    },
    releaseDate,
    endDate,
  };
}

function parseWeaponBannerEn(
  wikitext: string,
  pageTitle: string,
): WeaponBannerData {
  const { releaseDate, endDate } = extractDatesEn(wikitext);
  const name = extractBannerNameEn(wikitext, pageTitle);

  return {
    name,
    type: 'weapon',
    releaseDate,
    endDate,
    boostedWeapons: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'weapon_5_F')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'weapon_4_F')),
    },
    characters: {
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'character_4')),
    },
    otherWeapons: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'weapon_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'weapon_4')),
      featured3Star: splitSemicolon(extractWishParam(wikitext, 'weapon_3')),
    },
  };
}

function parseChronicledBannerEn(
  wikitext: string,
  pageTitle: string,
  mechanic: 'chronicled' | 'lightrace',
): ChronicledBannerData {
  const { releaseDate, endDate } = extractDatesEn(wikitext);
  const name = extractBannerNameEn(wikitext, pageTitle);

  return {
    name,
    type: 'chronicled',
    mechanic,
    characters: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'character_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'character_4')),
    },
    weapons: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'weapon_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'weapon_4')),
      featured3Star: splitSemicolon(extractWishParam(wikitext, 'weapon_3')),
    },
    releaseDate,
    endDate,
  };
}

function parseStandardBannerEn(
  wikitext: string,
  pageTitle: string,
): StandardBannerData {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const name = extractBannerNameEn(wikitext, pageTitle);

  return {
    name,
    type: 'standard',
    characters: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'character_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'character_4')),
    },
    weapons: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'weapon_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'weapon_4')),
      featured3Star: splitSemicolon(extractWishParam(wikitext, 'weapon_3')),
    },
    releaseDate: startMatch ? startMatch[1] : '',
  };
}

function parseNoviceBannerEn(
  wikitext: string,
  pageTitle: string,
): NoviceBannerData {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const name = extractBannerNameEn(wikitext, pageTitle);

  return {
    name,
    type: 'novice',
    characters: {
      featured5Star: splitSemicolon(extractWishParam(wikitext, 'character_5')),
      featured4Star: splitSemicolon(extractWishParam(wikitext, 'character_4')),
    },
    weapons: {
      featured3Star: splitSemicolon(extractWishParam(wikitext, 'weapon_3')),
    },
    releaseDate: startMatch ? startMatch[1] : '',
  };
}

function detectBannerTypeEn(
  wikitext: string,
):
  | 'character'
  | 'weapon'
  | 'chronicled'
  | 'lightrace'
  | 'standard'
  | 'novice'
  | 'unknown' {
  const typeMatch = wikitext.match(/\|type\s*=\s*([^\n|]+)/);
  if (!typeMatch) return 'unknown';
  const type = typeMatch[1].trim().toLowerCase();
  if (type.includes('character event')) return 'character';
  if (type.includes('weapon event')) return 'weapon';
  if (type.includes('lightrace')) return 'lightrace';
  if (type.includes('chronicled')) return 'chronicled';
  if (type.includes('standard')) return 'standard';
  if (type.includes('novice')) return 'novice';
  return 'unknown';
}

async function scrapeBannerOccurrenceEn(
  pageTitle: string,
  lang: string,
): Promise<BannerData | null> {
  const wikitext = await fetchPageWikitext(pageTitle, lang);
  const type = detectBannerTypeEn(wikitext);

  if (type === 'character') return parseCharacterBannerEn(wikitext, pageTitle);
  if (type === 'weapon') return parseWeaponBannerEn(wikitext, pageTitle);
  if (type === 'chronicled')
    return parseChronicledBannerEn(wikitext, pageTitle, 'chronicled');
  if (type === 'lightrace')
    return parseChronicledBannerEn(wikitext, pageTitle, 'lightrace');
  if (type === 'standard') return parseStandardBannerEn(wikitext, pageTitle);
  if (type === 'novice') return parseNoviceBannerEn(wikitext, pageTitle);
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// ── FR — parsing par HTML rendu (le wikitext ne contient pas de données) ───
// ══════════════════════════════════════════════════════════════════════════
//
// Le wiki FR pilote ses bannières via un template Lua sans paramètres
// exploitables dans le wikitext source. On récupère donc le HTML rendu de
// la section "Obtention" et on en extrait les cartes personnage/arme via
// leurs classes CSS (card-rare-5/4/3, card-caption, card-text).
//
// Actuellement implémenté : bannières "character" et "weapon".
// TODO : chronicled/lightrace, standard, novice — vérifier les intitulés de
// section HTML correspondants avant d'ajouter leur support (voir la
// conversation de mise au point pour la méthode : action=expandtemplates
// sur {{Bannière}} avec le titre d'une occurrence connue de chaque type).

interface HtmlItem {
  name: string;
  rarity: number;
}

function parseCardContainer(
  $: ReturnType<typeof cheerio.load>,
  $el: any,
): HtmlItem | null {
  const rarityClass = $el.find('.giw-card-image').attr('class') ?? '';
  const rarityMatch = rarityClass.match(/card-rare-(\d)/);
  const rarity = rarityMatch ? parseInt(rarityMatch[1], 10) : 0;

  // Le texte affiché (.card-text) peut être une version raccourcie pour les
  // noms composés longs (ex: "Yumemizuki Mizuki" → "Mizuki", "Kuki Shinobu"
  // → "Shinobu", "Shikanoin Heizou" → "Heizou"). L'attribut alt de l'icône
  // porte toujours le nom complet officiel, donc on le préfère.
  const iconAlt = $el.find('.giw-card-image img').attr('alt');
  const caption = $el.find('.card-caption').first().text().trim();
  const cardText = $el.find('.card-text').first().text().trim();
  const name = (iconAlt || caption || cardText).replace(/^[—]$/, '').trim();
  return name ? { name, rarity } : null;
}

// Certaines sections ("... au taux augmenté") contiennent du HTML invalide :
// des <div class="card-container"> directement enfants de <table>, sans
// <tr><td>. Les navigateurs (et cheerio, qui suit les mêmes règles HTML5)
// "foster-parentent" ces <div> : ils sont déplacés juste AVANT la <table>
// dans l'arbre DOM plutôt que d'y rester comme enfants. Du coup le <h3>
// n'est plus forcément suivi d'une <table> — il peut être suivi directement
// par ces <div> échappées. On parcourt donc tous les frères suivants jusqu'au
// prochain <h3>, et on cherche les .card-container partout dans cette plage,
// qu'ils soient nus ou nichés dans une table.
function parseBannerSectionsFr(html: string): Record<string, HtmlItem[]> {
  const $: ReturnType<typeof cheerio.load> = cheerio.load(html);
  const sections: Record<string, HtmlItem[]> = {};

  $('h3').each((_, h3) => {
    const heading = $(h3).text().trim();
    const items: HtmlItem[] = [];
    let node = $(h3).next();

    while (node.length && node.get(0)?.tagName?.toLowerCase() !== 'h3') {
      const containers = node.hasClass('card-container')
        ? node
        : node.find('.card-container');
      containers.each((_, el) => {
        const item = parseCardContainer($, $(el));
        if (item) items.push(item);
      });
      node = node.next();
    }

    sections[heading] = items;
  });

  return sections;
}

function detectBannerTypeFromHtmlFr(
  sections: Record<string, HtmlItem[]>,
): 'character' | 'weapon' | 'chronicled' | 'unknown' {
  if ('Personnages au taux augmenté' in sections) return 'character';
  if ('Armes au taux augmenté' in sections) return 'weapon';
  // Le Vœu chroniqué n'a pas de mise en avant : juste une sélection de
  // personnages et d'armes déjà sortis, sans rate-up.
  if ('Autres personnages' in sections && 'Armes' in sections)
    return 'chronicled';
  return 'unknown';
}

const onlyRarity = (items: HtmlItem[], rarity: number) =>
  items.filter((i) => i.rarity === rarity).map((i) => i.name);

const FR_MONTHS: Record<string, string> = {
  janvier: '01',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  décembre: '12',
};

function parseFrenchDate(text: string): string | null {
  const match = text.match(/(\d{1,2})(?:er)?\s+(\p{L}+)\s+(\d{4})/u);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = FR_MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function extractDatesFr(wikitext: string): {
  releaseDate: string;
  endDate: string;
} {
  const dureeMatch = wikitext.match(/==\s*Durée\s*==([\s\S]*?)(?:\n==|$)/);
  // Le wikitext contient parfois du HTML brut, ex: "1<sup>er</sup> janvier 2025"
  // pour l'ordinal du 1er du mois. Sans ce nettoyage, la regex de date ne
  // matche jamais ce cas précis (le tag scinde "1" et "er"), et on se
  // retrouve à prendre la date de fin comme date de sortie par erreur.
  const dureeText = (dureeMatch ? dureeMatch[1] : '').replace(/<[^>]+>/g, '');
  const dates = [...dureeText.matchAll(/\d{1,2}(?:er)?\s+\p{L}+\s+\d{4}/gu)]
    .map((m) => parseFrenchDate(m[0]))
    .filter((d): d is string => d !== null);
  return { releaseDate: dates[0] ?? '', endDate: dates[1] ?? '' };
}

function extractBannerNameFr(pageTitle: string): string {
  // Pas de |name= exploitable en FR : on dérive du titre de page.
  return pageTitle.replace(/\/[\d.\-]+$/, '').replace(/_/g, ' ');
}

function buildCharacterBannerFromHtmlFr(
  sections: Record<string, HtmlItem[]>,
  name: string,
  releaseDate: string,
  endDate: string,
): CharacterBannerData {
  const boosted = sections['Personnages au taux augmenté'] ?? [];
  const other = sections['Autres personnages'] ?? [];
  const weapons = sections['Armes'] ?? [];
  return {
    name,
    type: 'character',
    boostedCharacters: {
      featured5Star: onlyRarity(boosted, 5)[0] ?? '',
      featured4Star: onlyRarity(boosted, 4),
    },
    otherCharacters: {
      featured5Star: onlyRarity(other, 5),
      featured4Star: onlyRarity(other, 4),
    },
    weapons: {
      featured4Star: onlyRarity(weapons, 4),
      featured3Star: onlyRarity(weapons, 3),
    },
    releaseDate,
    endDate,
  };
}

function buildWeaponBannerFromHtmlFr(
  sections: Record<string, HtmlItem[]>,
  name: string,
  releaseDate: string,
  endDate: string,
): WeaponBannerData {
  const boosted = sections['Armes au taux augmenté'] ?? [];
  const characters = sections['Personnages'] ?? [];
  const other = sections['Autres armes'] ?? [];
  return {
    name,
    type: 'weapon',
    releaseDate,
    endDate,
    boostedWeapons: {
      featured5Star: onlyRarity(boosted, 5),
      featured4Star: onlyRarity(boosted, 4),
    },
    characters: {
      featured4Star: onlyRarity(characters, 4),
    },
    otherWeapons: {
      featured5Star: onlyRarity(other, 5),
      featured4Star: onlyRarity(other, 4),
      featured3Star: onlyRarity(other, 3),
    },
  };
}

// Vœu chroniqué : pas de mise en avant, juste un pool de personnages/armes
// déjà sortis. On ne sait pas encore distinguer "chronicled" de "lightrace"
// (mécanique voisine) côté FR faute d'exemple — tout est marqué "chronicled"
// pour l'instant, à corriger si un cas "lightrace" apparaît.
function buildChronicledBannerFromHtmlFr(
  sections: Record<string, HtmlItem[]>,
  name: string,
  releaseDate: string,
  endDate: string,
): ChronicledBannerData {
  const characters = sections['Autres personnages'] ?? [];
  const weapons = sections['Armes'] ?? [];
  return {
    name,
    type: 'chronicled',
    mechanic: 'chronicled',
    characters: {
      featured5Star: onlyRarity(characters, 5),
      featured4Star: onlyRarity(characters, 4),
    },
    weapons: {
      featured5Star: onlyRarity(weapons, 5),
      featured4Star: onlyRarity(weapons, 4),
      featured3Star: onlyRarity(weapons, 3),
    },
    releaseDate,
    endDate,
  };
}

// ── Standard FR ("Envie de voyage") ─────────────────────────────────────────
// Page permanente, structure encore différente : les personnages passent par
// un sous-template dédié ({{Bannière/Envie de voyage|...}}) qui rend une
// table à plat (pas de <h3> "au taux augmenté"/"autres" à distinguer), et les
// armes sont écrites directement en wikitext via {{Tuile|show_caption=1|...}}
// sans passer par du HTML généré du tout.

function parseFlatCardList(html: string): HtmlItem[] {
  const $: ReturnType<typeof cheerio.load> = cheerio.load(html);
  const items: HtmlItem[] = [];
  $('.card-container').each((_, el) => {
    const item = parseCardContainer($, $(el));
    if (item) items.push(item);
  });
  return items;
}

// On récupère l'appel du sous-template directement depuis le wikitext de la
// page plutôt que de coder en dur son paramètre (ex: "Luna V", un nom de
// version qui changera avec le temps) : on rejoue exactement l'appel tel
// qu'il existe sur la page au moment du scraping.
function extractStandardCharacterTemplateCall(wikitext: string): string | null {
  const match = wikitext.match(/\{\{Bannière\/Envie de voyage\|[^}]*\}\}/);
  return match ? match[0] : null;
}

function extractWeaponsFromWikitextFr(wikitext: string): {
  featured5Star: string[];
  featured4Star: string[];
  featured3Star: string[];
} {
  const armesMatch = wikitext.match(/==\s*Armes\s*==([\s\S]*?)(?:\n==|$)/);
  const text = armesMatch ? armesMatch[1] : '';
  const byRarity: Record<string, string[]> = { '5': [], '4': [], '3': [] };

  for (const m of text.matchAll(
    /\{\{Star\|(\d)\}\}[\s\S]*?\{\{Tuile\|show_caption=1\|([^}]+)\}\}/g,
  )) {
    const [, rarity, list] = m;
    byRarity[rarity] = list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    featured5Star: byRarity['5'] ?? [],
    featured4Star: byRarity['4'] ?? [],
    featured3Star: byRarity['3'] ?? [],
  };
}

async function buildStandardBannerFr(
  pageTitle: string,
  lang: string,
): Promise<StandardBannerData | null> {
  const wikitext = await fetchPageWikitext(pageTitle, lang);
  const templateCall = extractStandardCharacterTemplateCall(wikitext);
  if (!templateCall) return null;

  const charactersHtml = await fetchExpandTemplate(
    templateCall,
    pageTitle,
    lang,
  );
  const characterItems = parseFlatCardList(charactersHtml);
  const { releaseDate } = extractDatesFr(wikitext);
  const weapons = extractWeaponsFromWikitextFr(wikitext);

  return {
    name: pageTitle,
    type: 'standard',
    characters: {
      featured5Star: onlyRarity(characterItems, 5),
      featured4Star: onlyRarity(characterItems, 4),
    },
    weapons,
    releaseDate,
  };
}

async function scrapeBannerOccurrenceFr(
  pageTitle: string,
  lang: string,
): Promise<BannerData | null> {
  const wikitext = await fetchPageWikitext(pageTitle, lang);
  const html = await fetchRenderedHtml(pageTitle, lang);
  const sections = parseBannerSectionsFr(html);
  const type = detectBannerTypeFromHtmlFr(sections);

  if (type === 'unknown') return null;

  const { releaseDate, endDate } = extractDatesFr(wikitext);
  const name = extractBannerNameFr(pageTitle);

  if (type === 'character')
    return buildCharacterBannerFromHtmlFr(sections, name, releaseDate, endDate);
  if (type === 'weapon')
    return buildWeaponBannerFromHtmlFr(sections, name, releaseDate, endDate);
  return buildChronicledBannerFromHtmlFr(sections, name, releaseDate, endDate);
}

// ── Routeur par langue ────────────────────────────────────────────────────────

async function scrapeBannerOccurrence(
  pageTitle: string,
  lang: string,
): Promise<BannerData | null> {
  if (lang === 'fr') {
    if (PERMANENT_BANNERS.fr.includes(pageTitle))
      return buildStandardBannerFr(pageTitle, lang);
    return scrapeBannerOccurrenceFr(pageTitle, lang);
  }
  // en (et pour l'instant de/es/zh, non testés) utilisent le pipeline wikitext,
  // qui gère déjà standard/novice via |type= sans routage spécifique.
  return scrapeBannerOccurrenceEn(pageTitle, lang);
}

// ── Save ──────────────────────────────────────────────────────────────────────

function saveBanner(data: BannerData, lang: string) {
  const subdirName =
    data.type === 'character'
      ? 'characters'
      : data.type === 'weapon'
        ? 'weapons'
        : data.type === 'chronicled'
          ? 'unusual'
          : data.type === 'novice'
            ? 'novice'
            : 'standard';

  const subdir = path.join(OUTPUT_DIR, lang, subdirName);
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

  const filename =
    data.type === 'standard' || data.type === 'novice'
      ? `${slugify(data.name)}.json`
      : toFilename(
          data.name,
          (
            data as
              | CharacterBannerData
              | WeaponBannerData
              | ChronicledBannerData
          ).releaseDate,
        );

  const filePath = path.join(subdir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✅ ${lang}/${subdirName}/${filename}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function printUsage() {
  console.error('Usage:');
  console.error(
    '  Occurrence unique   : npx ts-node ... scrape-banners.ts "Ballad in Goblets/2020-09-28" en',
  );
  console.error(
    '  Toute une série     : npx ts-node ... scrape-banners.ts --all "Ballad_in_Goblets" en',
  );
  console.error(
    '  Toutes les bannières: npx ts-node ... scrape-banners.ts --everything en',
  );
}

async function main() {
  const args = process.argv.slice(2);

  const lang = args[args.length - 1];

  if (args.length < 2 || !lang || !API_URLS[lang]) {
    printUsage();
    console.error(
      `\nLangues disponibles : ${Object.keys(API_URLS).join(', ')}`,
    );
    process.exit(1);
  }

  if (!IMPLEMENTED_LANGS.has(lang)) {
    console.error(
      `\n⚠️  Le pipeline de parsing pour "${lang}" n'est pas encore implémenté (seuls en/fr le sont). Le scraping risque de tout skipper.`,
    );
  }

  // ── --everything ──────────────────────────────────────────────────────────
  if (args[0] === '--everything') {
    console.log(`\nDiscovering all banner occurrences [${lang}]...`);
    const discovered =
      lang === 'fr'
        ? await fetchAllBannerOccurrencesFr(lang)
        : await fetchAllBannerOccurrencesFromCategory(lang);
    const permanent = PERMANENT_BANNERS[lang] ?? [];
    const occurrences = [...discovered, ...permanent];
    console.log(
      `Found ${discovered.length} occurrences + ${permanent.length} bannières permanentes`,
    );

    for (const occurrence of occurrences) {
      try {
        console.log(`  Scraping ${occurrence}...`);
        const data = await scrapeBannerOccurrence(occurrence, lang);
        if (data) saveBanner(data, lang);
        else console.log(`  ⏭️  Skipped (standard or unknown type)`);
      } catch (err: any) {
        console.error(`  ❌ ${occurrence}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }

  // ── --all <série> ─────────────────────────────────────────────────────────
  if (args[0] === '--all') {
    // args = ['--all', 'Ballad_in_Goblets', 'en']  → séries = args[1..-2]
    const series = args.slice(1, -1);

    if (series.length === 0) {
      console.error('Erreur : --all requiert au moins un nom de série.');
      printUsage();
      process.exit(1);
    }

    for (const seriesName of series) {
      console.log(`\nFetching all occurrences of ${seriesName} [${lang}]...`);
      const occurrences = await fetchAllOccurrencesViaPrefix(seriesName, lang);
      console.log(`Found ${occurrences.length} occurrences`);

      for (const occurrence of occurrences) {
        try {
          console.log(`  Scraping ${occurrence}...`);
          const data = await scrapeBannerOccurrence(occurrence, lang);
          if (data) saveBanner(data, lang);
          else console.log(`  ⏭️  Skipped (standard or unknown type)`);
        } catch (err: any) {
          console.error(`  ❌ ${occurrence}: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
    return;
  }

  // ── Occurrence(s) unique(s) ───────────────────────────────────────────────
  // args = ['Ballad in Goblets/2020-09-28', 'en']  → targets = args[0..-2]
  const targets = args.slice(0, -1);

  for (const target of targets) {
    try {
      console.log(`Scraping ${target} [${lang}]...`);
      const data = await scrapeBannerOccurrence(target, lang);
      if (data) saveBanner(data, lang);
      else console.log('⏭️  Skipped');
    } catch (err: any) {
      console.error(`❌ ${target}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
