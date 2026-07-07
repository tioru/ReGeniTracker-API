import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/banners/en');

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

async function fetchPageWikitext(pageTitle: string): Promise<string> {
  const response = await axios.get(API_URL, {
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
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
): Promise<string[]> {
  const prefix = `${seriesName}/`;
  const titles: string[] = [];
  let apcontinue: string | undefined = undefined;

  do {
    const response: any = await axios.get(API_URL, {
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
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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

async function fetchAllBannerOccurrencesFromCategory(): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined = undefined;

  do {
    const response: any = await axios.get(API_URL, {
      params: {
        action: 'query',
        list: 'categorymembers',
        cmtitle: 'Category:Wish_Banners',
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
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const members = response.data?.query?.categorymembers ?? [];

    for (const member of members) {
      const match = member.title.match(/^File:(.+) (\d{4}-\d{2}-\d{2})\.png$/);
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

  const char5F = extractWishParam(wikitext, 'character_5_F');
  const char4F = extractWishParam(wikitext, 'character_4_F');
  const char5 = extractWishParam(wikitext, 'character_5');
  const char4 = extractWishParam(wikitext, 'character_4');
  const weap4 = extractWishParam(wikitext, 'weapon_4');
  const weap3 = extractWishParam(wikitext, 'weapon_3');

  return {
    name,
    type: 'character',
    boostedCharacters: {
      featured5Star: char5F,
      featured4Star: splitSemicolon(char4F),
    },
    otherCharacters: {
      featured5Star: splitSemicolon(char5),
      featured4Star: splitSemicolon(char4),
    },
    weapons: {
      featured4Star: splitSemicolon(weap4),
      featured3Star: splitSemicolon(weap3),
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

  const weap5F = extractWishParam(wikitext, 'weapon_5_F');
  const weap4F = extractWishParam(wikitext, 'weapon_4_F');
  const weap5 = extractWishParam(wikitext, 'weapon_5');
  const weap4 = extractWishParam(wikitext, 'weapon_4');
  const weap3 = extractWishParam(wikitext, 'weapon_3');
  const char4 = extractWishParam(wikitext, 'character_4');

  return {
    name,
    type: 'weapon',
    releaseDate,
    endDate,
    boostedWeapons: {
      featured5Star: splitSemicolon(weap5F),
      featured4Star: splitSemicolon(weap4F),
    },
    characters: {
      featured4Star: splitSemicolon(char4),
    },
    otherWeapons: {
      featured5Star: splitSemicolon(weap5),
      featured4Star: splitSemicolon(weap4),
      featured3Star: splitSemicolon(weap3),
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

  const char5 = extractWishParam(wikitext, 'character_5');
  const char4 = extractWishParam(wikitext, 'character_4');
  const weap5 = extractWishParam(wikitext, 'weapon_5');
  const weap4 = extractWishParam(wikitext, 'weapon_4');
  const weap3 = extractWishParam(wikitext, 'weapon_3');

  return {
    name,
    type: 'chronicled',
    mechanic,
    characters: {
      featured5Star: splitSemicolon(char5),
      featured4Star: splitSemicolon(char4),
    },
    weapons: {
      featured5Star: splitSemicolon(weap5),
      featured4Star: splitSemicolon(weap4),
      featured3Star: splitSemicolon(weap3),
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
  const releaseDate = startMatch ? startMatch[1] : '';
  const name = extractBannerName(wikitext, pageTitle);

  const char5 = extractWishParam(wikitext, 'character_5');
  const char4 = extractWishParam(wikitext, 'character_4');
  const weap5 = extractWishParam(wikitext, 'weapon_5');
  const weap4 = extractWishParam(wikitext, 'weapon_4');
  const weap3 = extractWishParam(wikitext, 'weapon_3');

  return {
    name,
    type: 'standard',
    characters: {
      featured5Star: splitSemicolon(char5),
      featured4Star: splitSemicolon(char4),
    },
    weapons: {
      featured5Star: splitSemicolon(weap5),
      featured4Star: splitSemicolon(weap4),
      featured3Star: splitSemicolon(weap3),
    },
    releaseDate,
  };
}

function parseNoviceBanner(
  wikitext: string,
  pageTitle: string,
): NoviceBannerData {
  const startMatch = wikitext.match(/\|time_start\s*=\s*(\d{4}-\d{2}-\d{2})/);
  const releaseDate = startMatch ? startMatch[1] : '';
  const name = extractBannerName(wikitext, pageTitle);

  const char5 = extractWishParam(wikitext, 'character_5');
  const char4 = extractWishParam(wikitext, 'character_4');
  const weap3 = extractWishParam(wikitext, 'weapon_3');

  return {
    name,
    type: 'novice',
    characters: {
      featured5Star: splitSemicolon(char5),
      featured4Star: splitSemicolon(char4),
    },
    weapons: {
      featured3Star: splitSemicolon(weap3),
    },
    releaseDate,
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

function toFilename(name: string, releaseDate: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${slug}_${releaseDate}.json`;
}

async function scrapeBannerOccurrence(
  pageTitle: string,
): Promise<BannerData | null> {
  const wikitext = await fetchPageWikitext(pageTitle);
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

function saveBanner(data: BannerData) {
  const subdirName =
    data.type === 'character'
      ? 'characters'
      : data.type === 'weapon'
        ? 'weapons'
        : data.type === 'chronicled'
          ? 'unusual'
          : 'standard';

  const subdir = path.join(OUTPUT_DIR, subdirName);
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
  console.log(`  ✅ ${subdirName}/${filename}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error(
      '  Occurrence unique   : npx ts-node ... scrape-banners.ts "Ballad in Goblets/2020-09-28"',
    );
    console.error(
      '  Toute une série     : npx ts-node ... scrape-banners.ts --all "Ballad_in_Goblets"',
    );
    console.error(
      '  Plusieurs séries    : npx ts-node ... scrape-banners.ts --all "Ballad_in_Goblets" "Epitome_Invocation"',
    );
    process.exit(1);
  }

  if (args[0] === '--everything') {
    console.log(
      '\nDiscovering all banner occurrences via Category:Wish_Banners...',
    );
    const occurrences = await fetchAllBannerOccurrencesFromCategory();
    console.log(`Found ${occurrences.length} occurrences`);

    for (const occurrence of occurrences) {
      try {
        console.log(`  Scraping ${occurrence}...`);
        const data = await scrapeBannerOccurrence(occurrence);
        if (data) saveBanner(data);
        else console.log(`  ⏭️  Skipped (standard or unknown type)`);
      } catch (err: any) {
        console.error(`  ❌ ${occurrence}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return;
  }

  const fetchAll = args[0] === '--all';
  const targets = fetchAll ? args.slice(1) : args;

  for (const target of targets) {
    if (fetchAll) {
      console.log(`\nFetching all occurrences of ${target}...`);
      const occurrences = await fetchAllOccurrencesViaPrefix(target);
      console.log(`Found ${occurrences.length} occurrences`);

      for (const occurrence of occurrences) {
        try {
          console.log(`  Scraping ${occurrence}...`);
          const data = await scrapeBannerOccurrence(occurrence);
          if (data) saveBanner(data);
          else console.log(`  ⏭️  Skipped (standard or unknown type)`);
        } catch (err: any) {
          console.error(`  ❌ ${occurrence}: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      try {
        console.log(`Scraping ${target}...`);
        const data = await scrapeBannerOccurrence(target);
        if (data) saveBanner(data);
        else console.log('⏭️  Skipped');
      } catch (err: any) {
        console.error(`❌ ${target}: ${err.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
