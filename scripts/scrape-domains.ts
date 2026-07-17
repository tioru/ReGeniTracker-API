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
    .replace(/<!--[\s\S]*?-->/g, '') // commentaires HTML (ex: |requiredAR = <!-- 27/28/36/45 -->)
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
      rotations: parseRotations(content),
      levels: parseLevels(content),
      quest: cleanWikitext(fields['quest'] ?? ''),
      questType: cleanWikitext(fields['quest_type'] ?? ''),
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
  let written = 0;
  for (const domain of filtered) {
    const filename = `${slugify(domain.title)}.json`;

    // Chaque rotation est active ses 2 jours de base + le dimanche (règle du
    // jeu : le dimanche, TOUS les jeux de matériaux sont disponibles en même
    // temps). Encodé ici plutôt que dupliqué : "sunday" apparaît dans les 3
    // rotations sans qu'on ait à créer une 4e entrée séparée.
    const rewards = domain.rotations.map((rotation) => ({
      days: [...rotation.baseDays, 'sunday'],
      name: rotation.name,
      // Les valeurs du wiki sont déjà les noms complets des matériaux
      // (ex: "Teachings of Moonlight", "Artful Device Fragment") : pas de
      // préfixage à faire, contrairement à ce qu'on pensait au départ.
      reward: Object.entries(rotation.materialsByQuality).map(
        ([quality, materialName]) => ({
          quality: Number(quality),
          name: materialName,
        }),
      ),
    }));

    const levels = domain.levels.map((level, idx) => {
      const levelIndex = idx + 1;
      const teamLevelRecommanded = domain.recLevels[idx];
      const reward = getRewardForPartyLevel(
        teamLevelRecommanded,
        `${domain.title} ${toRoman(levelIndex)}`,
      );

      return {
        level: levelIndex,
        name: `${domain.title} ${toRoman(levelIndex)}`,
        teamLevelRecommanded,
        rewards: reward
          ? [
              { name: 'Adventure EXP', quantity: reward.adventureExp },
              { name: 'Mora', quantity: reward.mora },
              { name: 'Companionship EXP', quantity: reward.companionshipExp },
            ]
          : [], // partyLevel absent de PARTY_LEVEL_REWARDS → table à compléter (voir warning console)
        // La description (objectif) est propre à chaque vague : la plupart
        // des niveaux n'ont qu'une vague donc ça revient au même que avant,
        // mais certains niveaux (ex: Cecilia Garden IV) ont un objectif
        // différent par vague (vague normale puis vague "boss").
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
      // Uniquement présent pour les Quest Domains (absent partout ailleurs).
      ...(domain.quest
        ? { quest: { name: domain.quest, type: domain.questType || undefined } }
        : {}),
      rewards,
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
