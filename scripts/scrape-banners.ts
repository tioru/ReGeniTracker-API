import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URLS: Record<string, string> = {
  en: 'https://genshin-impact.fandom.com/api.php',
  fr: 'https://genshin-impact.fandom.com/fr/api.php', // ← doit être comme ça, pas fr.genshin-impact...
  de: 'https://de.genshin-impact.fandom.com/api.php',
  es: 'https://es.genshin-impact.fandom.com/api.php',
  zh: 'https://genshin-impact.fandom.com/zh/api.php',
};

const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/banners');

const BANNER_CATEGORY: Record<string, string> = {
  en: 'Category:Wish_Banners',
  fr: 'Catégorie:Image_Bannière',
  // de, es, zh à découvrir avec la même méthode (prop=categories sur un fichier bannière connu)
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

// ── API ───────────────────────────────────────────────────────────────────────

function getApiUrl(lang: string): string {
  return API_URLS[lang] ?? API_URLS['en'];
}

async function fetchPageWikitext(
  pageTitle: string,
  lang: string,
): Promise<string> {
  const response = await axios.get(getApiUrl(lang), {
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

async function fetchAllOccurrencesViaPrefix(
  seriesName: string,
  lang: string,
): Promise<string[]> {
  const prefix = `${seriesName}/`;
  const titles: string[] = [];
  let apcontinue: string | undefined = undefined;

  do {
    const response: any = await axios.get(getApiUrl(lang), {
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
        .filter((title: string) => /\/\d{4}-\d{2}-\d{2}$/.test(title)),
    );

    apcontinue = response.data?.continue?.apcontinue;
    if (apcontinue) await new Promise((r) => setTimeout(r, 300));
  } while (apcontinue);

  return titles;
}

async function fetchAllBannerOccurrencesFromCategory(
  lang: string,
): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined = undefined;

  do {
    const response: any = await axios.get(getApiUrl(lang), {
      params: {
        action: 'query',
        list: 'categorymembers',
        cmtitle: getBannerCategory(lang), // ← remplace le "Category:Wish_Banners" en dur
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

    for (const member of members) {
      const match = member.title.match(
        /^[^:]+:(.+) (\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\.png$/,
      );
      if (match) {
        const [, name, date] = match;
        titles.push(`${name}/${date}`);
      }
    }

    cmcontinue = response.data?.continue?.cmcontinue;
    if (cmcontinue) await new Promise((r) => setTimeout(r, 300));
  } while (cmcontinue);

  return [...new Set(titles)];
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function splitSemicolon(value: string): string[] {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractWishParam(wikitext: string, param: string): string {
  const match = wikitext.match(new RegExp(`\\|\\s*${param}\\s*=\\s*([^\n|]+)`));
  return match ? match[1].trim() : '';
}

function extractDates(wikitext: string): {
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

function extractBannerName(wikitext: string, pageTitle: string): string {
  const nameMatch = wikitext.match(/\|name\s*=\s*([^\n|]+)/);
  if (nameMatch) {
    return nameMatch[1]
      .trim()
      .replace(/\s+\d{4}-\d{2}-\d{2}$/, '')
      .trim();
  }
  return pageTitle.replace(/\/[\d-]+$/, '').replace(/_/g, ' ');
}

function parseCharacterBanner(
  wikitext: string,
  pageTitle: string,
): CharacterBannerData {
  const { releaseDate, endDate } = extractDates(wikitext);
  const name = extractBannerName(wikitext, pageTitle);

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

function parseWeaponBanner(
  wikitext: string,
  pageTitle: string,
): WeaponBannerData {
  const { releaseDate, endDate } = extractDates(wikitext);
  const name = extractBannerName(wikitext, pageTitle);

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

function parseChronicledBanner(
  wikitext: string,
  pageTitle: string,
  mechanic: 'chronicled' | 'lightrace',
): ChronicledBannerData {
  const { releaseDate, endDate } = extractDates(wikitext);
  const name = extractBannerName(wikitext, pageTitle);

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

function parseStandardBanner(
  wikitext: string,
  pageTitle: string,
): StandardBannerData {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const name = extractBannerName(wikitext, pageTitle);

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

function parseNoviceBanner(
  wikitext: string,
  pageTitle: string,
): NoviceBannerData {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const name = extractBannerName(wikitext, pageTitle);

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

function detectBannerType(
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

// ── Filename ──────────────────────────────────────────────────────────────────

function toFilename(name: string, releaseDate: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${slug}_${releaseDate}.json`;
}

// ── Scrape ────────────────────────────────────────────────────────────────────

async function scrapeBannerOccurrence(
  pageTitle: string,
  lang: string,
): Promise<BannerData | null> {
  const wikitext = await fetchPageWikitext(pageTitle, lang);
  const type = detectBannerType(wikitext);

  if (type === 'character') return parseCharacterBanner(wikitext, pageTitle);
  if (type === 'weapon') return parseWeaponBanner(wikitext, pageTitle);
  if (type === 'chronicled')
    return parseChronicledBanner(wikitext, pageTitle, 'chronicled');
  if (type === 'lightrace')
    return parseChronicledBanner(wikitext, pageTitle, 'lightrace');
  if (type === 'standard') return parseStandardBanner(wikitext, pageTitle);
  if (type === 'novice') return parseNoviceBanner(wikitext, pageTitle);
  return null;
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
      ? `${data.name
          .toLowerCase()
          .replace(/['']/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')}.json`
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

  // ── --everything ──────────────────────────────────────────────────────────
  if (args[0] === '--everything') {
    console.log(
      `\nDiscovering all banner occurrences via Category:Wish_Banners [${lang}]...`,
    );
    const occurrences = await fetchAllBannerOccurrencesFromCategory(lang);
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

function createHttpsAgent(): https.Agent {
  return new https.Agent({ keepAlive: true });
}
