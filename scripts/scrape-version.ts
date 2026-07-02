// scripts/scrape-version.ts
import axios from 'axios';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_URL = 'https://genshin-impact.fandom.com/api.php';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/versions/en');

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionData {
  number: string;
  name: string;
  releaseDate: string;
  endDate: string;
  newCharacters: string[];
  newWeapons: Partial<
    Record<'1Star' | '2Star' | '3Star' | '4Star' | '5Star', string[]>
  >;
  newBosses: string[];
  banners: { characters: string[]; weapons: string[] };
  events: string[];
  newDomains: string[];
  newArtifacts: string[];
  newEnnemies: string[];
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

async function fetchWikitext(versionNumber: string): Promise<string> {
  const response = await axios.get(API_URL, {
    params: {
      action: 'query',
      titles: `Version/${versionNumber}`,
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
  const content = pages[0]?.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error('No content found');
  return content;
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

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseCharacters(section: string): string[] {
  return section
    .split('\n')
    .filter((line) => /^\*{1}\s/.test(line))
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

  section
    .split('\n')
    .filter((line) => /^\*{1}\s/.test(line))
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      const rarityMatch = clean.match(/\((\d)-Star/);
      if (!rarityMatch) return;

      const rarityKey = rarityMap[rarityMatch[1]];
      if (!rarityKey) return;

      const nameMatch = clean.match(/^([^(]+)\s*\(/);
      const name = nameMatch ? nameMatch[1].trim() : clean;

      if (!weapons[rarityKey]) weapons[rarityKey] = [];
      weapons[rarityKey]!.push(name);
    });

  return weapons;
}

function parseBanners(section: string): VersionData['banners'] {
  const banners: VersionData['banners'] = { characters: [], weapons: [] };

  section
    .split('\n')
    .filter((line) => /^\*{2}\s/.test(line)) // seulement niveau 2 (**) = les vraies bannières
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      // Retire le personnage entre parenthèses "(Dehya)" à la fin
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
    .filter((line) => /^\*{1}\s/.test(line))
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

function parseArchonQuests(
  section: string,
): VersionData['newQuests']['archonQuests'] {
  const result: VersionData['newQuests']['archonQuests'] = [];

  section
    .split('\n')
    .filter((line) => /^\*+\s/.test(line))
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      // Format: "Archon Quest Chapter III: Act III - Dreams, Emptiness, Deception"
      // ou: "Interlude Chapter: Act I - The Crane Returns on the Wind"
      const match = clean.match(
        /(?:Archon Quest\s+)?(.+(?:Chapter\s+[IVX\d]+|Prologue|Interlude Chapter).*):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i,
      );
      if (!match) return;

      const chapterName = match[1].trim();
      const actNum = romanToInt(match[2]);
      const actName = match[3].replace(/\(.*?\)/g, '').trim();

      let chapter = result.find((q) => q.chapterName === chapterName);
      if (!chapter) {
        chapter = { chapter: chapterToKey(chapterName), chapterName, acts: [] };
        result.push(chapter);
      }
      chapter.acts.push({ act: actNum, name: actName });
    });

  return result;
}

function parseStoryQuests(
  section: string,
): VersionData['newQuests']['storyQuests'] {
  const result: VersionData['newQuests']['storyQuests'] = [];

  section
    .split('\n')
    .filter((line) => /^\*+\s/.test(line))
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      // Format: "Story Quest Mantichora Chapter: Act I - Lionsblood (Dehya)"
      const match = clean.match(
        /(?:Story Quest\s+)?([^:]+Chapter):\s*Act\s+([IVX\d]+)\s*[-–]\s*([^(]+)\(([^)]+)\)/i,
      );
      if (!match) return;

      const chapter = match[1].trim();
      const actNum = romanToInt(match[2]);
      const actName = match[3].trim();
      const character = match[4].trim();

      let existing = result.find((q) => q.chapter === chapter);
      if (!existing) {
        existing = { chapter, character, acts: [] };
        result.push(existing);
      }
      existing.acts.push({ act: actNum, name: actName });
    });

  return result;
}

function parseHangoutQuests(
  section: string,
): VersionData['newQuests']['hangoutQuests'] {
  const result: VersionData['newQuests']['hangoutQuests'] = [];

  section
    .split('\n')
    .filter((line) => /^\*{2}\s/.test(line)) // niveau 2 seulement
    .forEach((line) => {
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      // Format: "Faruzan: Act I - A Confounding Conundrum"
      const match = clean.match(/^([^:]+):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i);
      if (!match) return;

      const character = match[1].trim();
      const actNum = romanToInt(match[2]);
      const actName = match[3].trim();

      let existing = result.find((q) => q.character === character);
      if (!existing) {
        existing = { character, acts: [] };
        result.push(existing);
      }
      existing.acts.push({ act: actNum, name: actName });
    });

  return result;
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
      console.log(`Fetching next version (${next}) for endDate...`);
      const nextWikitext = await fetchWikitext(next);
      const { date: nextDate } = parseTemplate(nextWikitext);
      endDate = nextDate;
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      console.warn(`⚠️  Could not fetch next version ${next} for endDate`);
    }
  }

  const newContentSection = extractMainSection(wikitext, 'New Content');

  // Sous-sections quêtes séparées
  const archonSection = extractSubsection(newContentSection, 'Archon Quests');
  const storySection = extractSubsection(newContentSection, 'Story Quests');
  const worldSection = extractSubsection(newContentSection, 'World Quests');
  const hangoutSection = extractSubsection(newContentSection, 'Hangout Events');

  console.log('--- DEBUG ---');
  console.log('newContentSection length:', newContentSection.length);
  console.log(
    'Event Wishes section:',
    extractSubsection(newContentSection, 'Event Wishes').slice(0, 300),
  );
  console.log(
    'Archon Quests section:',
    extractSubsection(newContentSection, 'Archon Quests').slice(0, 300),
  );
  console.log(
    'Story Quests section:',
    extractSubsection(newContentSection, 'Story Quests').slice(0, 300),
  );
  console.log(
    'World Quests section:',
    extractSubsection(newContentSection, 'World Quests').slice(0, 300),
  );
  console.log('--- END DEBUG ---');

  return {
    number: versionNumber,
    name,
    releaseDate: date,
    endDate,
    newCharacters: parseCharacters(
      extractSubsection(newContentSection, 'New Characters'),
    ),
    newWeapons: parseWeapons(
      extractSubsection(newContentSection, 'New Weapons'),
    ),
    newBosses: [], // non distinguable automatiquement — à compléter manuellement si besoin
    banners: parseBanners(extractSubsection(newContentSection, 'Event Wishes')),
    events: parseSimpleList(extractSubsection(newContentSection, 'New Events')),
    newDomains: parseSimpleList(
      extractSubsection(newContentSection, 'New Domains'),
    ).map(cleanDomainName),
    newArtifacts: parseSimpleList(
      extractSubsection(newContentSection, 'New Artifact Sets'),
    ).concat(
      parseSimpleList(extractSubsection(newContentSection, 'New Artifacts')),
    ),
    newEnnemies: parseSimpleList(
      extractSubsection(newContentSection, 'New Monsters'),
    ),
    newQuests: {
      archonQuests: parseArchonQuests(archonSection),
      storyQuests: parseStoryQuests(storySection),
      worldQuests: parseSimpleList(worldSection),
      hangoutQuests: parseHangoutQuests(hangoutSection),
    },
  };
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

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const version of versions) {
    try {
      const data = await scrapeVersion(version);
      const filePath = path.join(OUTPUT_DIR, `${version}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✅ Version ${version} → ${filePath}`);
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.error(`❌ Failed to scrape version ${version}:`, err.message);
    }
  }
}

main();
