// scripts/scrape-version.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';
const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/versions/${lang}`);
const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── Types ─────────────────────────────────────────────────────────────────────

type EnemyCategory =
  | 'common'
  | 'elite'
  | 'normalBoss'
  | 'weeklyBoss'
  | 'unknown';

interface MapExpansion {
  mainRegion: string;
  subRegion: string[];
}

interface EnemiesData {
  common: string[];
  elite: string[];
  boss: {
    normal: string[];
    weekly: string[];
  };
}

interface VersionData {
  number: string;
  name: string;
  releaseDate: string;
  endDate: string;
  mapExpansion: MapExpansion[];
  newCharacters: string[];
  newWeapons: Partial<
    Record<'1Star' | '2Star' | '3Star' | '4Star' | '5Star', string[]>
  >;
  banners: { characters: string[]; weapons: string[] };
  events: string[];
  newDomains: string[];
  newArtifacts: string[];
  newEnnemies: EnemiesData;
  newQuests: {
    archonQuests: {
      chapter: string;
      chapterName: string;
      acts: { act: number; name: string }[];
    }[];
    storyQuests: {
      chapter: string;
      character: string;
      acts: { act: number; name: string }[];
    }[];
    worldQuests: string[];
    hangoutQuests: {
      character: string;
      acts: { act: number; name: string }[];
    }[];
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchPageWikitext(
  pageTitle: string,
  apiUrl: string = EN_API_URL,
): Promise<string> {
  const response = await axios.get(apiUrl, {
    params: {
      action: 'query',
      titles: pageTitle, // ← titre brut, sans préfixe
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2',
    },
    headers: { ...HTTP_HEADERS, Accept: 'application/json' },
    httpsAgent,
  });

  const pages = response.data?.query?.pages;
  if (!pages || pages.length === 0) throw new Error('Page not found');
  const content = pages[0]?.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error('No content found');
  return content;
}

async function fetchWikitext(versionNumber: string): Promise<string> {
  return fetchPageWikitext(`Version/${versionNumber}`);
}

// ── FR: traduction des noms via les langlinks du wiki EN ────────────────────
//
// Les pages "Version/X.Y" partagent le même titre sur le wiki EN et le wiki
// FR (vérifié sur Version/5.0 et Version/5.8), donc pas besoin de langlinks
// pour la page de version elle-même. En revanche, chaque entité citée dans
// son contenu (personnage, arme, domaine, artefact, ennemi, région, quête...)
// a sa PROPRE page avec un titre FR différent : on résout ces traductions en
// lot via les langlinks des pages EN déjà identifiées par le scraping normal,
// même pattern que resolveFrMaterialNamesToEnglish dans scrape-weapons.ts
// (mais dans l'autre sens : EN → FR).
//
// Limite connue : ça suppose que le nom nettoyé (cleanWikiLink) correspond au
// titre réel de la page EN, ce qui est vrai pour les liens simples
// "[[Nom]]" (cas très majoritaire ici) mais pas pour les liens à alias
// "[[Page|Alias affiché]]" où l'alias est perdu dès le parsing initial. Dans
// ce cas (ou si la page n'a simplement pas de version FR), la traduction
// échoue silencieusement (avec warning) et on retombe sur le nom EN.
async function fetchLangLinksFr(names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(names)].filter(Boolean);
  const chunkSize = 50;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    // MediaWiki pagine les langlinks au sein même d'un lot de titres (lllimit
    // par défaut = 10) : sur un lot de 29 titres, seuls les premiers
    // renvoient déjà leur langlinks, les suivants nécessitent de rejouer la
    // requête avec les paramètres "continue" jusqu'à ce qu'il n'y en ait
    // plus plus — sinon la traduction échoue silencieusement pour la
    // majorité du lot.
    let continueParams: Record<string, string> | undefined;
    do {
      try {
        const response = await axios.get(EN_API_URL, {
          params: {
            action: 'query',
            titles: chunk.join('|'),
            prop: 'langlinks',
            lllang: 'fr',
            lllimit: 'max',
            format: 'json',
            formatversion: '2',
            ...continueParams,
          },
          headers: { ...HTTP_HEADERS, Accept: 'application/json' },
          httpsAgent,
        });
        const pages = response.data?.query?.pages ?? [];
        for (const page of pages) {
          const frTitle = page.langlinks?.[0]?.title;
          if (frTitle) map.set(page.title, frTitle);
        }
        continueParams = response.data?.continue;
      } catch (err) {
        console.warn(`⚠️  Échec de la résolution des noms FR pour un lot: ${err}`);
        continueParams = undefined;
      }
      await new Promise((r) => setTimeout(r, 300));
    } while (continueParams);
  }
  return map;
}

function translate(name: string, map: Map<string, string>): string {
  const translated = map.get(name);
  if (!translated) {
    console.warn(`⚠️  Pas de traduction FR trouvée pour "${name}", conservé en anglais.`);
  }
  return translated ?? name;
}

// Titre narratif de la version ('''Titre''' est la version X.Y de
// [[Genshin Impact]].), constaté identique en structure sur toutes les pages
// FR de version (cf. Version/5.0, Version/5.8). Le champ infobox "nom" ne
// contient lui que "Version X.Y", pas le titre narratif souhaité ici.
function extractStoryTitleFr(wikitext: string): string | null {
  const match = wikitext.match(/'''([^']+)'''\s+est la version/);
  return match ? cleanWikiLink(match[1]).trim() : null;
}

// "Chapter X" → "Chapitre X" : les noms de chapitre d'Archon Quest ne sont
// pas de véritables pages wiki traduisibles via langlinks (ce sont des
// libellés génériques), donc simple substitution plutôt qu'une résolution.
function translateArchonChapterName(chapterName: string): string {
  return chapterName.replace(/Chapter/gi, 'Chapitre');
}

// "Xxx Chapter" → "Xxx" : constaté sur fr/1.0.json (ex: "Pavo Ocellus
// Chapter" → "Pavo Ocellus") — le nom latin du chapitre de Story Quest n'est
// lui-même jamais traduit, seul le suffixe générique "Chapter" est retiré.
function translateStoryChapter(chapter: string): string {
  return chapter.replace(/\s+Chapter$/i, '').trim();
}

function translateQuestsFr(
  quests: VersionData['newQuests'],
  map: Map<string, string>,
): VersionData['newQuests'] {
  return {
    archonQuests: quests.archonQuests.map((q) => ({
      chapter: q.chapter,
      chapterName: translateArchonChapterName(q.chapterName),
      acts: q.acts.map((a) => ({ act: a.act, name: translate(a.name, map) })),
    })),
    storyQuests: quests.storyQuests.map((q) => ({
      chapter: translateStoryChapter(q.chapter),
      character: translate(q.character, map),
      acts: q.acts.map((a) => ({ act: a.act, name: translate(a.name, map) })),
    })),
    worldQuests: quests.worldQuests.map((name) => translate(name, map)),
    hangoutQuests: quests.hangoutQuests.map((q) => ({
      character: translate(q.character, map),
      acts: q.acts.map((a) => ({ act: a.act, name: translate(a.name, map) })),
    })),
  };
}

// Construit la version FR à partir des données EN déjà scrapées : même
// structure, noms traduits via langlinks (repli sur le nom EN si la
// traduction échoue). Retourne null si la page FR de la version elle-même
// est introuvable (version pas encore traduite sur le wiki FR).
async function buildFrVersionData(
  enData: VersionData,
  versionNumber: string,
): Promise<VersionData | null> {
  let frWikitext: string | null = null;
  try {
    frWikitext = await fetchPageWikitext(`Version/${versionNumber}`, FR_API_URL);
  } catch {
    frWikitext = null;
  }

  const frName = frWikitext ? extractStoryTitleFr(frWikitext) : null;
  if (!frWikitext) {
    console.warn(
      `⚠️  "Version/${versionNumber}": page FR introuvable, fichier fr/ non généré.`,
    );
    return null;
  }
  if (!frName) {
    console.warn(
      `⚠️  "Version/${versionNumber}": titre narratif FR introuvable, repli sur le nom EN.`,
    );
  }

  const namesToTranslate = new Set<string>([
    ...enData.newCharacters,
    ...Object.values(enData.newWeapons).flat(),
    ...enData.banners.characters,
    ...enData.banners.weapons,
    ...enData.newDomains,
    ...enData.newArtifacts,
    ...enData.newEnnemies.common,
    ...enData.newEnnemies.elite,
    ...enData.newEnnemies.boss.normal,
    ...enData.newEnnemies.boss.weekly,
    ...enData.mapExpansion.flatMap((m) => [m.mainRegion, ...m.subRegion]),
    ...enData.events,
    ...enData.newQuests.worldQuests,
    ...enData.newQuests.archonQuests.flatMap((q) => q.acts.map((a) => a.name)),
    ...enData.newQuests.storyQuests.flatMap((q) => q.acts.map((a) => a.name)),
    ...enData.newQuests.hangoutQuests.flatMap((q) => q.acts.map((a) => a.name)),
  ]);

  console.log(`Translating ${namesToTranslate.size} names to French...`);
  const map = await fetchLangLinksFr([...namesToTranslate]);

  const translateList = (names: string[]) => names.map((n) => translate(n, map));
  const translateWeapons = (
    weapons: VersionData['newWeapons'],
  ): VersionData['newWeapons'] => {
    const result: VersionData['newWeapons'] = {};
    for (const [key, names] of Object.entries(weapons) as [
      keyof typeof weapons,
      string[],
    ][]) {
      result[key] = translateList(names);
    }
    return result;
  };

  return {
    number: enData.number,
    name: frName ?? enData.name,
    releaseDate: enData.releaseDate,
    endDate: enData.endDate,
    newCharacters: translateList(enData.newCharacters),
    mapExpansion: enData.mapExpansion.map((m) => ({
      mainRegion: translate(m.mainRegion, map),
      subRegion: translateList(m.subRegion),
    })),
    newWeapons: translateWeapons(enData.newWeapons),
    banners: {
      characters: translateList(enData.banners.characters),
      weapons: translateList(enData.banners.weapons),
    },
    events: translateList(enData.events),
    newDomains: translateList(enData.newDomains),
    newArtifacts: translateList(enData.newArtifacts),
    newEnnemies: {
      common: translateList(enData.newEnnemies.common),
      elite: translateList(enData.newEnnemies.elite),
      boss: {
        normal: translateList(enData.newEnnemies.boss.normal),
        weekly: translateList(enData.newEnnemies.boss.weekly),
      },
    },
    newQuests: translateQuestsFr(enData.newQuests, map),
  };
}

async function fetchEnemyType(enemyName: string): Promise<EnemyCategory> {
  try {
    const wikitext = await fetchPageWikitext(enemyName.replace(/ /g, '_'));
    const match = wikitext.match(/\|type\s*=\s*([^\n|]+)/);
    if (!match) return 'unknown';

    const type = match[1].trim().toLowerCase();

    if (type.includes('weekly boss')) return 'weeklyBoss';
    if (type.includes('normal boss')) return 'normalBoss';
    if (type.includes('elite')) return 'elite';
    if (type.includes('common')) return 'common';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Nettoyage wikitext ────────────────────────────────────────────────────────

function cleanWikiLink(text: string): string {
  return text
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[Image:[^\]]+\]\]/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/{{[^}]+}}/g, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/\[\d+px\|[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Extraction de sections ────────────────────────────────────────────────────

function extractMainSection(wikitext: string, sectionTitle: string): string {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `={2,3}\\s*${escaped}\\s*={2,3}([\\s\\S]*?)(?===|$)`,
    'i',
  );
  const match = wikitext.match(regex);
  return match ? match[1] : '';
}

/**
 * Extrait une sous-section délimitée par ";Label"
 * Supporte ";New Characters\n* items" jusqu'au prochain ";Label" ou "==" ou fin
 */
function extractSubsection(wikitext: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `;\\s*${escaped}[^\n]*\n([\\s\\S]*?)(?=\n;[^;]|\n==|$)`,
    'i',
  );
  const match = wikitext.match(regex);
  return match ? match[1] : '';
}

function extractMonsterNames(section: string): string[] {
  const names: string[] = [];
  const lines = section.split('\n').filter((l) => /^\*+\s*/.test(l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const depth = (line.match(/^\*+/) ?? [''])[0].length;
    const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''))
      .replace(/\s*\(Boss\)\s*/i, '')
      .trim();
    if (!clean) continue;

    if (depth === 1) {
      const nextLine = lines[i + 1] ?? '';
      const nextDepth = (nextLine.match(/^\*+/) ?? [''])[0].length;
      if (nextDepth === 2) continue; // label de groupe, ignore
      names.push(clean);
    } else if (depth === 2) {
      names.push(clean);
    }
    // depth >= 3 ignoré
  }

  return names;
}

// ── Template parser ───────────────────────────────────────────────────────────

function parseTemplate(wikitext: string): {
  name: string;
  date: string;
  next: string;
} {
  const get = (key: string): string => {
    const match = wikitext.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^\n|]+)`));
    return match ? match[1].trim() : '';
  };
  return {
    name: get('title'),
    date: get('date'),
    next: get('next'),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function classifyEnnemies(ennemies: string[]): Promise<EnemiesData> {
  const result: EnemiesData = {
    common: [],
    elite: [],
    boss: {
      normal: [],
      weekly: [],
    },
  };

  for (const ennemy of ennemies) {
    const category = await fetchEnemyType(ennemy);
    console.log(`  "${ennemy}" → ${category}`);

    switch (category) {
      case 'common':
        result.common.push(ennemy);
        break;
      case 'elite':
        result.elite.push(ennemy);
        break;
      case 'normalBoss':
        result.boss.normal.push(ennemy);
        break;
      case 'weeklyBoss':
        result.boss.weekly.push(ennemy);
        break;
      default:
        // Type inconnu ou page introuvable — met dans common par défaut
        console.warn(`⚠️  Type inconnu pour "${ennemy}", classé en common`);
        result.common.push(ennemy);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  return result;
}

function mergeWeapons(
  a: VersionData['newWeapons'],
  b: VersionData['newWeapons'],
): VersionData['newWeapons'] {
  const result = { ...a };
  for (const [key, names] of Object.entries(b) as [
    keyof typeof b,
    string[],
  ][]) {
    if (!result[key]) result[key] = [];
    result[key] = [...result[key]!, ...names];
  }
  return result;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseCharacters(section: string): string[] {
  return section
    .split('\n')
    .filter((line) => /^\*{1}\s*/.test(line))
    .map((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      // Format: "Title" Name (X-Star Element Weapon)
      const withQuote = clean.match(/"[^"]*"\s+([^(]+)\s*\(/);
      if (withQuote) return withQuote[1].trim();
      // Format: Name (X-Star Element Weapon)
      const withoutQuote = clean.match(/^([^(]+)\s*\(\d-Star/);
      if (withoutQuote) return withoutQuote[1].trim();
      // Fallback : avant parenthèse
      const fallback = clean.match(/^([^(]+)/);
      return fallback ? fallback[1].trim() : clean;
    })
    .filter(Boolean);
}

function parseWeapons(section: string): VersionData['newWeapons'] {
  const weapons: VersionData['newWeapons'] = {};
  const rarityMap: Record<string, keyof typeof weapons> = {
    '1': '1Star',
    '2': '2Star',
    '3': '3Star',
    '4': '4Star',
    '5': '5Star',
  };

  // Prend TOUS les niveaux (1 et 2) qui contiennent un pattern de rareté
  section
    .split('\n')
    .filter((line) => /^\*+\s*/.test(line))
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));

      // Supporte "(X-Star ...)", "X-Star ...", "X-Star Forgeable ..."
      const rarityMatch = clean.match(/[\[(]?(\d)-Star/);
      if (!rarityMatch) return; // ligne sans rareté = label de groupe, on ignore

      const rarityKey = rarityMap[rarityMatch[1]];
      if (!rarityKey) return;

      // Nom = tout ce qui précède le pattern de rareté
      const nameMatch = clean.match(/^([^(]+?)\s*(?:\(?\d-Star|\d-Star)/);
      const name = nameMatch ? nameMatch[1].trim() : clean;
      if (!name) return;

      if (!weapons[rarityKey]) weapons[rarityKey] = [];
      weapons[rarityKey]!.push(name);
    });

  return weapons;
}

// 1. Bannières : nettoyer les lignes [[File:...]] avant de parser
function parseBanners(section: string): VersionData['banners'] {
  const banners: VersionData['banners'] = {
    characters: [],
    weapons: ['Epitome Invocation'],
  };

  // Filtre uniquement les lignes ** (niveau 2) et ignore les [[File:...]]
  section
    .split('\n')
    .filter((line) => /^\*{2}\s*/.test(line) && !line.includes('[[File:'))
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      const bannerName = clean.replace(/\s*\([^)]+\)\s*$/, '').trim();
      if (!bannerName) return;

      if (bannerName.toLowerCase().includes('epitome')) {
        banners.weapons.push(bannerName);
      } else {
        banners.characters.push(bannerName);
      }
    });

  return banners;
}

function parseSimpleList(section: string): string[] {
  return section
    .split('\n')
    .filter((line) => /^\*{1}\s*/.test(line))
    .map((line) => cleanWikiLink(line.replace(/^\*+\s*/, '')))
    .filter(Boolean);
}

function cleanDomainName(name: string): string {
  // Retire les suffixes "(One-Time Domain)", "(Trounce Domain)", etc.
  return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function romanToInt(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const curr = map[s[i]] ?? 0;
    const next = map[s[i + 1]] ?? 0;
    result += curr < next ? -curr : curr;
  }
  return result;
}

function chapterToKey(chapterName: string): string {
  if (/prologue/i.test(chapterName)) return 'prologue';
  if (/interlude/i.test(chapterName)) return 'interlude';
  const match = chapterName.match(/Chapter\s+([IVX\d]+)/i);
  return match
    ? String(romanToInt(match[1]))
    : chapterName.toLowerCase().replace(/\s+/g, '_');
}

// 2. Quêtes : tout parser depuis la section "New Quests" en vrac
// en distinguant archon/story/hangout/world par le contenu de chaque ligne
function parseQuests(section: string): VersionData['newQuests'] {
  const result: VersionData['newQuests'] = {
    archonQuests: [],
    storyQuests: [],
    worldQuests: [],
    hangoutQuests: [],
  };

  const lines = section.split('\n').filter((l) => /^\*+\s*/.test(l));

  let currentChapterName = '';
  let currentSection = '';

  for (const line of lines) {
    const depth = (line.match(/^\*+/) ?? [''])[0].length;
    const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
    if (!clean) continue;

    // ── Détection des labels de section (niveau 1) ────────────────────────────
    if (depth === 1) {
      const lower = clean.toLowerCase();
      if (lower.includes('archon quest')) {
        currentSection = 'archon';
        currentChapterName = '';
        continue;
      }
      if (lower.includes('story quest')) {
        currentSection = 'story';
        currentChapterName = '';
        continue;
      }
      if (lower.includes('world quest')) {
        currentSection = 'world';
        currentChapterName = '';
        continue;
      }
      if (lower.includes('hangout')) {
        currentSection = 'hangout';
        currentChapterName = '';
        continue;
      }
    }

    // ── Format inline (3.5 et versions récentes) ──────────────────────────────

    // Archon Quest inline : "Archon Quest Chapter III: Act VI - Caribert"
    const archonInlineMatch = clean.match(
      /(?:Archon Quest\s+)?(.+(?:Chapter\s+[IVX\d]+|Prologue|Interlude Chapter).*):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i,
    );
    if (archonInlineMatch) {
      const chapterName = archonInlineMatch[1]
        .replace(/^Archon Quest\s+/i, '')
        .trim();
      const actNum = romanToInt(archonInlineMatch[2]);
      const actName = archonInlineMatch[3].replace(/\(.*?\)/g, '').trim();

      let chapter = result.archonQuests.find(
        (q) => q.chapterName === chapterName,
      );
      if (!chapter) {
        chapter = { chapter: chapterToKey(chapterName), chapterName, acts: [] };
        result.archonQuests.push(chapter);
      }
      chapter.acts.push({ act: actNum, name: actName });
      continue;
    }

    // Story Quest inline : "Story Quest Xxx Chapter: Act I - Name (Character)"
    const storyInlineMatch = clean.match(
      /(?:Story Quest\s+)?([^:]+Chapter):\s*Act\s+([IVX\d]+)\s*[-–]\s*([^(]+)\(([^)]+)\)/i,
    );
    if (storyInlineMatch) {
      const chapter = storyInlineMatch[1].trim();
      const actNum = romanToInt(storyInlineMatch[2]);
      const actName = storyInlineMatch[3].trim();
      const character = storyInlineMatch[4].trim();

      let existing = result.storyQuests.find((q) => q.chapter === chapter);
      if (!existing) {
        existing = { chapter, character, acts: [] };
        result.storyQuests.push(existing);
      }
      existing.acts.push({ act: actNum, name: actName });
      continue;
    }

    // Hangout Quest inline (niveau >= 2) : "Faruzan: Act I - A Confounding Conundrum"
    if (depth >= 2 && currentSection !== 'world') {
      const hangoutInlineMatch = clean.match(
        /^([^:]+):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i,
      );
      if (hangoutInlineMatch && !hangoutInlineMatch[1].match(/Chapter/i)) {
        const character = hangoutInlineMatch[1].trim();
        const actNum = romanToInt(hangoutInlineMatch[2]);
        const actName = hangoutInlineMatch[3].trim();

        let existing = result.hangoutQuests.find(
          (q) => q.character === character,
        );
        if (!existing) {
          existing = { character, acts: [] };
          result.hangoutQuests.push(existing);
        }
        existing.acts.push({ act: actNum, name: actName });
        continue;
      }
    }

    // ── Format imbriqué version 2.0 ───────────────────────────────────────────

    // Niveau 1 section archon : "* Archon Quests Chapter II" (chapitre inline au niveau 1)
    if (depth === 1 && currentSection === 'archon') {
      const chapterInlineMatch = clean.match(
        /Archon Quests?\s+(Chapter\s+[IVX\d]+|Prologue|Interlude Chapter)/i,
      );
      if (chapterInlineMatch) {
        currentChapterName = chapterInlineMatch[1].trim();
        continue;
      }
    }

    // Niveau 2 section archon format 2.0 : "** Act I: Name" (deux-points, sans tiret)
    if (depth === 2 && currentSection === 'archon' && currentChapterName) {
      const actColonMatch = clean.match(/Act\s+([IVX\d]+):\s*(.+)/i);
      if (actColonMatch) {
        const actNum = romanToInt(actColonMatch[1]);
        const actName = actColonMatch[2].replace(/\(.*?\)/g, '').trim();

        let chapter = result.archonQuests.find(
          (q) => q.chapterName === currentChapterName,
        );
        if (!chapter) {
          chapter = {
            chapter: chapterToKey(currentChapterName),
            chapterName: currentChapterName,
            acts: [],
          };
          result.archonQuests.push(chapter);
        }
        chapter.acts.push({ act: actNum, name: actName });
        continue;
      }
    }

    // ── Format imbriqué version 3.0 ───────────────────────────────────────────

    // Niveau 2 section archon : "** Chapter III" (chapitre seul)
    if (depth === 2 && currentSection === 'archon') {
      if (clean.match(/^(?:Chapter\s+[IVX\d]+|Prologue|Interlude Chapter)/i)) {
        currentChapterName = clean.trim();
        continue;
      }
    }

    // Niveau 3 section archon : "*** Act I - Name"
    if (depth === 3 && currentSection === 'archon' && currentChapterName) {
      const actMatch = clean.match(/Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i);
      if (actMatch) {
        const actNum = romanToInt(actMatch[1]);
        const actName = actMatch[2].replace(/\(.*?\)/g, '').trim();

        let chapter = result.archonQuests.find(
          (q) => q.chapterName === currentChapterName,
        );
        if (!chapter) {
          chapter = {
            chapter: chapterToKey(currentChapterName),
            chapterName: currentChapterName,
            acts: [],
          };
          result.archonQuests.push(chapter);
        }
        chapter.acts.push({ act: actNum, name: actName });
        continue;
      }
    }

    // ── World Quests ──────────────────────────────────────────────────────────

    // Niveau 2 section world : world quests (premier niveau de quête)
    if (depth === 2 && currentSection === 'world') {
      if (
        !clean.match(/Act\s+[IVX\d]+\s*[-–]/i) &&
        !clean.match(/^Part\s+[IVX\d]+:/i)
      ) {
        const questName = clean.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (questName) result.worldQuests.push(questName);
      }
      continue;
    }

    // ── Hangout Quests ────────────────────────────────────────────────────────

    // Niveau 2 section hangout : "** Character: Act I - Name"
    if (depth === 2 && currentSection === 'hangout') {
      const hangoutMatch = clean.match(
        /^([^:]+):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i,
      );
      if (hangoutMatch) {
        const character = hangoutMatch[1].trim();
        const actNum = romanToInt(hangoutMatch[2]);
        const actName = hangoutMatch[3].trim();

        let existing = result.hangoutQuests.find(
          (q) => q.character === character,
        );
        if (!existing) {
          existing = { character, acts: [] };
          result.hangoutQuests.push(existing);
        }
        existing.acts.push({ act: actNum, name: actName });
      }
      continue;
    }

    // ── Fallback : world quest niveau 1 sans section explicite ────────────────
    if (
      depth === 1 &&
      currentSection === '' &&
      !clean.match(/Act\s+[IVX\d]+\s*[-–]/i) &&
      !clean.match(/(?:Archon|Story|Hangout)\s+(?:Quest|Event)/i)
    ) {
      result.worldQuests.push(clean);
    }
  }

  return result;
}

function parseMapExpansion(section: string): MapExpansion[] {
  const result: MapExpansion[] = [];
  let current: MapExpansion | null = null;

  section
    .split('\n')
    .filter((line) => /^\*+\s*/.test(line))
    .forEach((line) => {
      const depth = (line.match(/^\*+/) ?? [''])[0].length;
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      if (depth === 1) {
        const regionName = clean.replace(/\s+with.*$/i, '').trim(); // retire " with the following Areas:"
        current = { mainRegion: regionName, subRegion: [] };
        result.push(current);
      } else if (depth === 2 && current) {
        // Sous-région
        current.subRegion.push(clean);
      }
    });

  return result;
}

function parseDomains(section: string): string[] {
  const domains: string[] = [];

  section.split('\n').forEach((line) => {
    const depth = (line.match(/^\*+/) ?? [''])[0].length;
    if (!line.match(/^\*+\s/)) return;

    const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''))
      .replace(/\s*\([^)]+\)\s*$/, '') // retire les suffixes (One-Time Domain), etc.
      .trim();

    if (!clean) return;

    if (depth === 1) {
      // Format "Domain of Forgery: Court of Flowing Sand" → garder seulement "Court of Flowing Sand"
      const colonMatch = clean.match(
        /^(?:Domain of [^:]+|One-Time Domains?):\s*(.+)/i,
      );
      if (colonMatch) {
        domains.push(colonMatch[1].trim());
        return;
      }
      // Ignore les labels purs comme "One-Time Domains" (sans contenu après ":")
      if (clean.match(/^(?:Domain of [^:]+|One-Time Domains?)$/i)) return;

      domains.push(clean);
    } else if (depth === 2) {
      // Sous-domaines (One-Time Domains en 2.0)
      domains.push(clean);
    }
  });

  return domains;
}

// ── Scraper principal ─────────────────────────────────────────────────────────

async function scrapeVersion(versionNumber: string): Promise<VersionData> {
  console.log(`Fetching wikitext for version ${versionNumber}...`);
  const wikitext = await fetchWikitext(versionNumber);

  const { name, date, next } = parseTemplate(wikitext);

  // Récupère endDate depuis la prochaine version
  let endDate = '';
  if (next) {
    try {
      const nextWikitext = await fetchWikitext(next);
      const { date: nextDate } = parseTemplate(nextWikitext);
      endDate = nextDate;
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      console.warn(`⚠️  Could not fetch next version ${next} for endDate`);
    }
  }

  const newContentSection = extractMainSection(wikitext, 'New Content');

  // Classification des monstres en boss / monstres normaux
  const allEnnemies = extractMonsterNames(
    extractSubsection(newContentSection, 'New Monsters'),
  );
  console.log(`Classifying ${allEnnemies.length} monsters...`);
  const ennemies = await classifyEnnemies(allEnnemies);

  return {
    number: versionNumber,
    name,
    releaseDate: date,
    endDate,
    newCharacters: parseCharacters(
      extractSubsection(newContentSection, 'New Characters'),
    ),
    mapExpansion: parseMapExpansion(
      extractSubsection(newContentSection, 'New Region') ||
        extractSubsection(newContentSection, 'New Regions') ||
        extractSubsection(newContentSection, 'New Areas'),
    ),
    newWeapons: mergeWeapons(
      // "New Equipment" : libellé utilisé sur les pages de version ~1.2-1.6,
      // remplacé par "New Weapons" sur les versions plus récentes.
      mergeWeapons(
        parseWeapons(extractSubsection(newContentSection, 'New Weapons')),
        parseWeapons(extractSubsection(newContentSection, 'New Equipment')),
      ),
      parseWeapons(
        extractSubsection(newContentSection, 'New Forgeable Weapons'),
      ),
    ),
    banners: parseBanners(extractSubsection(newContentSection, 'Event Wishes')),
    events: parseSimpleList(
      extractSubsection(newContentSection, 'New Events'),
    ).map((e) => e.replace(/\s*\(Permanent\)\s*$/i, '').trim()),
    newDomains: parseDomains(
      extractSubsection(newContentSection, 'New Domains'),
    ),
    newArtifacts: parseSimpleList(
      extractSubsection(newContentSection, 'New Artifact Sets'),
    ).concat(
      parseSimpleList(extractSubsection(newContentSection, 'New Artifacts')),
    ),
    newEnnemies: ennemies,
    newQuests: parseQuests(extractSubsection(newContentSection, 'New Quests')),
  };
}

// Nom de fichier sûr pour les identifiants de version non numériques (ex:
// "Luna I" → "luna_i"), qui contiendraient sinon un espace dans le nom de
// fichier. Le champ "number" dans le JSON garde lui la valeur d'origine.
function slugifyVersionFilename(version: string): string {
  return version
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const versions = process.argv.slice(2);

  if (versions.length === 0) {
    console.error(
      'Usage: npx ts-node --project tsconfig.scripts.json scripts/scrape-version.ts 1.1 2.0 3.5',
    );
    process.exit(1);
  }

  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  for (const version of versions) {
    try {
      const data = await scrapeVersion(version);
      const filename = `${slugifyVersionFilename(version)}_generated.json`;
      const enPath = path.join(enDir, filename);
      fs.writeFileSync(enPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✅ Version ${version} (en) → ${enPath}`);

      const frData = await buildFrVersionData(data, version);
      if (frData) {
        const frPath = path.join(frDir, filename);
        fs.writeFileSync(frPath, JSON.stringify(frData, null, 2), 'utf-8');
        console.log(`✅ Version ${version} (fr) → ${frPath}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.error(`❌ Failed to scrape version ${version}:`, err.message);
    }
  }
}

main();
