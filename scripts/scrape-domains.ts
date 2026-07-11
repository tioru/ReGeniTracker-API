// scripts/scrape-domains.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/domains/en');
const CACHE_PATH = path.resolve(__dirname, './cache/domains-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Les templates {{Domain Levels/Mastery}}, {{Domain Levels/Forgery}} et
// {{Domain Levels/Blessing}} ne sont PAS paramétrés par domaine : ce sont des
// tableaux génériques et fixes (AR / Party Level / Adventure EXP / Mora /
// Companionship EXP) identiques pour tous les domaines d'un même type. Ils
// sont donc codés en dur ci-dessous (REWARD_TABLES) plutôt que scrapés.
//
// Les données spécifiques à chaque domaine (cibles + vagues d'ennemis)
// viennent du template {{Domain Enemies}} présent sur la page du domaine,
// au format "Nom*quantité" séparé par ";" (ennemis d'une vague) et "//"
// (vagues d'un même niveau).
//
// Trounce Domains : pas de données de référence pour l'instant (structure
// probablement différente, à confirmer avec un exemple concret).
// ─────────────────────────────────────────────────────────────────────────────

interface LevelReward {
  ar: number;
  partyLevel: number;
  adventureExp: number;
  mora: number;
  companionshipExp: number;
}

// Tableaux génériques extraits des templates Domain Levels/{Mastery,Forgery}.
// Chaque domaine de ce type utilise exactement ces 4 paliers, dans l'ordre.
const REWARD_TABLES: Record<'Mastery' | 'Forgery', LevelReward[]> = {
  Mastery: [
    {
      ar: 27,
      partyLevel: 38,
      adventureExp: 100,
      mora: 1575,
      companionshipExp: 15,
    },
    {
      ar: 28,
      partyLevel: 54,
      adventureExp: 100,
      mora: 1800,
      companionshipExp: 15,
    },
    {
      ar: 36,
      partyLevel: 71,
      adventureExp: 100,
      mora: 2050,
      companionshipExp: 20,
    },
    {
      ar: 45,
      partyLevel: 88,
      adventureExp: 100,
      mora: 2375,
      companionshipExp: 20,
    },
  ],
  Forgery: [
    {
      ar: 16,
      partyLevel: 15,
      adventureExp: 100,
      mora: 1125,
      companionshipExp: 10,
    },
    {
      ar: 21,
      partyLevel: 36,
      adventureExp: 100,
      mora: 1550,
      companionshipExp: 15,
    },
    {
      ar: 30,
      partyLevel: 59,
      adventureExp: 100,
      mora: 1850,
      companionshipExp: 15,
    },
    {
      ar: 40,
      partyLevel: 80,
      adventureExp: 100,
      mora: 2200,
      companionshipExp: 20,
    },
  ],
};

// Domain Levels/Blessing a jusqu'à 6 paliers (I à VI) ; certains domaines de
// Blessing n'en utilisent qu'une partie (les N derniers, alignés sur le
// palier VI qui est toujours présent). On aligne donc par la fin de ce
// tableau selon le nombre réel de niveaux trouvés via {{Domain Enemies}}.
const BLESSING_REWARD_TABLE: LevelReward[] = [
  {
    ar: 22,
    partyLevel: 34,
    adventureExp: 100,
    mora: 1525,
    companionshipExp: 15,
  },
  {
    ar: 25,
    partyLevel: 47,
    adventureExp: 100,
    mora: 1700,
    companionshipExp: 15,
  },
  {
    ar: 30,
    partyLevel: 59,
    adventureExp: 100,
    mora: 1850,
    companionshipExp: 15,
  },
  {
    ar: 35,
    partyLevel: 69,
    adventureExp: 100,
    mora: 2025,
    companionshipExp: 20,
  },
  {
    ar: 40,
    partyLevel: 80,
    adventureExp: 100,
    mora: 2200,
    companionshipExp: 20,
  },
  {
    ar: 45,
    partyLevel: 90,
    adventureExp: 100,
    mora: 2525,
    companionshipExp: 20,
  },
];

interface RawEnemy {
  name: string;
  number: number;
}

interface RawLevel {
  target: string; // ex: "Defeat 7 opponent(s) within 300 second(s)"
  waves: RawEnemy[][]; // une entrée par vague
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
  rewardsByWeekday: Record<
    string,
    {
      name: string;
      // quality -> nom du matériau (2 = Teachings/basique, 3 = Guide, 4 = Philosophies, 5 = éventuel palier 5★)
      materialsByQuality: Record<number, string>;
    }
  >;
  levels: RawLevel[];
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

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{Icon\/Element\|([^}|]+)[^}]*\}\}/gi, '$1') // {{Icon/Element|Hydro|25}} -> Hydro
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    .replace(/[\u0300-\u036f]/g, '')
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

// ── Parsing du bloc {{Domain by Weekday}} ───────────────────────────────────
// Champs attendus (cf. Genshin Impact Wiki:Domain Pages Guide) :
// mon-name, mon-2, mon-3, mon-4, mon-5, tue-name, tue-2, ... wed-name, wed-2, ...
// (mon-2/mon-3/mon-4 = qualité 2/3/4 ; mon-5 optionnel pour les domaines 5★)
function parseWeekdayRewards(content: string): RawDomain['rewardsByWeekday'] {
  const block = extractBracedBlock(content, '{{Domain by Weekday');
  const result: RawDomain['rewardsByWeekday'] = {};
  if (!block) return result;

  const fields = parseInfoboxFields(block);
  const days: Record<string, string> = {
    mon: 'monday',
    tue: 'tuesday',
    wed: 'wednesday',
  };

  for (const [prefix, dayName] of Object.entries(days)) {
    const name = fields[`${prefix}-name`];
    if (!name) continue;

    const materialsByQuality: Record<number, string> = {};
    for (const quality of [2, 3, 4, 5]) {
      const value = fields[`${prefix}-${quality}`];
      if (value) materialsByQuality[quality] = cleanWikitext(value);
    }

    result[dayName] = {
      name: cleanWikitext(name),
      materialsByQuality,
    };
  }

  return result;
}

// ── Parsing du bloc {{Domain Enemies}} → cibles + vagues d'ennemis ─────────
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

    levels.push({
      target: cleanWikitext(target ?? ''),
      waves: enemies ? parseEnemiesString(enemies) : [],
    });
  }

  return levels;
}

// Associe à chaque palier (1-based) sa ligne de récompenses génériques,
// selon le type de domaine. Pour Blessing, on aligne par la fin du tableau
// des 6 paliers max (les domaines à moins de 6 paliers sautent les premiers).
function getRewardForLevel(
  domainTypeRaw: string,
  levelIndex: number, // 1-based
  totalLevels: number,
): LevelReward | undefined {
  const type = domainTypeRaw.trim().toLowerCase();
  if (type === 'mastery') return REWARD_TABLES.Mastery[levelIndex - 1];
  if (type === 'forgery') return REWARD_TABLES.Forgery[levelIndex - 1];
  if (type === 'blessing') {
    const offset = BLESSING_REWARD_TABLE.length - totalLevels;
    return BLESSING_REWARD_TABLE[offset + levelIndex - 1];
  }
  return undefined; // Trounce / autres: pas de table de référence pour l'instant
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchBatch(gcmcontinue?: string): Promise<{
  results: RawDomain[];
  nextContinue?: string;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Domains',
    gcmlimit: '50',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  };
  if (gcmcontinue) params.gcmcontinue = gcmcontinue;

  const response = await axios.get(API_URL, {
    params,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });

  const pages = response.data?.query?.pages ?? [];
  const nextContinue = response.data?.continue?.gcmcontinue;
  const results: RawDomain[] = [];

  for (const page of pages) {
    const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
    if (!content.includes('{{Domain Infobox')) continue;

    const block = extractBracedBlock(content, '{{Domain Infobox');
    if (!block) continue;
    const fields = parseInfoboxFields(block);

    const versionMatch = content.match(/\{\{Change History\|([^}|]+)/);
    const version = versionMatch ? versionMatch[1].trim() : '';

    results.push({
      pageTitle: page.title,
      title: page.title.trim(),
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
      rewardsByWeekday: parseWeekdayRewards(content),
      levels: parseLevels(content),
    });
  }

  return { results, nextContinue };
}

async function fetchAll(): Promise<RawDomain[]> {
  const all: RawDomain[] = [];
  let cont: string | undefined;
  let page = 1;
  do {
    console.log(`Fetching batch ${page}...`);
    const { results, nextContinue } = await fetchBatch(cont);
    all.push(...results);
    cont = nextContinue;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  } while (cont);
  return all;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): RawDomain[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(data: RawDomain[]) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Cache saved (${data.length} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeDomainFiles(domains: RawDomain[], versionFilter?: string[]) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const filtered = versionFilter?.length
    ? domains.filter((d) => versionFilter.includes(d.releaseVersion))
    : domains;

  // Nom des paliers de qualité pour les récompenses hebdomadaires (Talent Books).
  // Pour d'autres types de domaines (Weapon Ascension Materials, Artifacts),
  // ces libellés ne s'appliquent pas forcément — à adapter si besoin.
  const QUALITY_PREFIX: Record<number, string> = {
    2: 'Teachings of',
    3: 'Guide to',
    4: 'Philosophies of',
  };

  let written = 0;
  for (const domain of filtered) {
    const filename = `${slugify(domain.title)}.json`;
    const totalLevels = domain.levels.length;

    const rewardsByDay: Record<string, unknown> = {};
    for (const [day, info] of Object.entries(domain.rewardsByWeekday)) {
      rewardsByDay[day] = {
        name: info.name,
        reward: Object.entries(info.materialsByQuality).map(
          ([quality, materialName]) => ({
            quality: Number(quality),
            // Si materialName est déjà un nom complet (ex: "Teachings of Moonlight"),
            // on le garde tel quel ; sinon on préfixe avec le libellé de qualité.
            name: /^(teachings of|guide to|philosophies of)/i.test(materialName)
              ? materialName
              : `${QUALITY_PREFIX[Number(quality)] ?? ''} ${materialName}`.trim(),
          }),
        ),
      };
    }

    const levels = domain.levels.map((level, idx) => {
      const levelIndex = idx + 1;
      const teamLevelRecommanded = domain.recLevels[idx];
      const reward = getRewardForLevel(
        domain.domainTypeRaw,
        levelIndex,
        totalLevels,
      );

      return {
        level: levelIndex,
        name: `${domain.title} ${toRoman(levelIndex)}`,
        description: level.target,
        teamLevelRecommanded,
        rewards: reward
          ? [
              { name: 'Adventure EXP', quantity: reward.adventureExp },
              { name: 'Mora', quantity: reward.mora },
              { name: 'Companionship EXP', quantity: reward.companionshipExp },
            ]
          : [], // type de domaine sans table de référence (ex: Trounce) → à compléter
        waves: level.waves.map((wave, waveIdx) => ({
          wave: waveIdx + 1,
          enemies: wave.map((enemy) => ({
            name: enemy.name,
            number: enemy.number,
            level: teamLevelRecommanded,
          })),
        })),
      };
    });

    const output = {
      name: domain.title,
      domainType: domainTypeLabel(domain.domainTypeRaw),
      location: {
        mainLocation: domain.mainLocation,
        subLocation: domain.subLocation,
      },
      description: domain.description,
      recommendedElements: domain.recommendedElements,
      releaseVersion: domain.releaseVersion,
      rewards: rewardsByDay,
      levels,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      JSON.stringify(output, null, 2),
      'utf-8',
    );
    written++;
  }

  console.log(`✅ Wrote ${written} domain files to ${OUTPUT_DIR}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache'].includes(args[0])) {
    console.error('Usage:');
    console.error(
      '  Fetch + générer tout    : npx ts-node ... scrape-domains.ts --fetch',
    );
    console.error(
      '  Cache + générer tout     : npx ts-node ... scrape-domains.ts --cache',
    );
    console.error(
      '  Filtrer par version(s)   : ... --cache "Luna I" "Luna II"',
    );
    process.exit(1);
  }

  const useCache = args[0] === '--cache';
  const versionFilter = args.slice(1);

  let domains: RawDomain[];

  if (useCache) {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch first.');
      process.exit(1);
    }
    domains = cached;
    console.log(`Loaded ${domains.length} domains from cache.`);
  } else {
    console.log(
      'Fetching all domains from wiki (this will take a few minutes)...',
    );
    domains = await fetchAll();
    saveCache(domains);
  }

  writeDomainFiles(domains, versionFilter.length ? versionFilter : undefined);
}

main();
