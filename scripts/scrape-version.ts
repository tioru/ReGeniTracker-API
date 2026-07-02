import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import * as path from 'node:path';
import https from 'node:https';

const BASE_URL = 'https://genshin-impact.fandom.com/wiki/Version';
const OUTPUT_DIR = path.resolve(__dirname, '../prisma/data/versions/en');

type $ = ReturnType<typeof cheerio.load>;

interface VersionData {
  number: string;
  name: string;
  releaseDate: string;
  endDate: string;
  newCharacters: string[];
  newWeapons: Partial<Record<'1Star' | '2Star' | '3Star' | '4Star' | '5Star', string[]>>;
  newBosses: string[];
  banners: { characters: string[]; weapons: string[] };
  events: string[];
  newDomains: string[];
  newArtifacts: string[];
  newMonsters: string[];
  newQuests: {
    archonQuests: { chapter: string; chapterName: string; acts: { act: number; name: string }[] }[];
    storyQuests: { chapter: string; character: string; acts: { act: number; name: string }[] }[];
    worldQuests: string[];
    hangoutQuests: { character: string; acts: { act: number; name: string }[] }[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRarity(text: string): '1Star' | '2Star' | '3Star' | '4Star' | '5Star' | null {
  const match = text.match(/(\d)-Star/);
  if (!match) return null;
  const map: Record<string, '1Star' | '2Star' | '3Star' | '4Star' | '5Star'> = {
    '1': '1Star', '2': '2Star', '3': '3Star', '4': '4Star', '5': '5Star',
  };
  return map[match[1]] ?? null;
}

function extractCharacterName(text: string): string {
  // Format: "Title" Name (X-Star Element Weapon)
  // ou : Name (X-Star Element Weapon)
  const match = text.match(/"[^"]*"\s+([^(]+)\s+\(/);
  if (match) return match[1].trim();
  const fallback = text.match(/^([^(]+)\s+\(/);
  return fallback ? fallback[1].trim() : text.trim();
}

function extractWeaponName(text: string): string {
  // Format: Name (X-Star Type)
  const match = text.match(/^([^(]+)\s+\(/);
  return match ? match[1].trim() : text.trim();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Parsers par section ───────────────────────────────────────────────────────

function parseNewCharacters($: $, section: any): string[] {
  const characters: string[] = [];
  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    if (text.includes('-Star')) {
      characters.push(extractCharacterName(text));
    }
  });
  return characters;
}

function parseNewWeapons($: $, section: any): VersionData['newWeapons'] {
  const weapons: VersionData['newWeapons'] = {};
  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    if (!text.includes('-Star')) return;
    const rarity = extractRarity(text);
    if (!rarity) return;
    const name = extractWeaponName(text);
    if (!weapons[rarity]) weapons[rarity] = [];
    weapons[rarity]!.push(name);
  });
  return weapons;
}

function parseEvents($: $, section: any): string[] {
  const events: string[] = [];
  section.find('> ul > li').each((_: number, el: any) => {
    const text = cleanText($(el).clone().children('ul').remove().end().text());
    if (text) events.push(text);
  });
  return events;
}

function parseDomains($: $, section: any): string[] {
  const domains: string[] = [];
  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    if (text && !text.includes('(') || text.match(/\(Trounce\)|\(One-Time\)|\(Blessing\)|\(Forgery\)|\(Mastery\)/)) {
      const name = text.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (name) domains.push(name);
    }
  });
  return domains;
}

function parseMonsters($: $, section: any): string[] {
  const monsters: string[] = [];
  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).clone().children('ul').remove().end().text());
    if (text) monsters.push(text);
  });
  return monsters;
}

function parseBanners($: $, section: any): VersionData['banners'] {
  const banners: VersionData['banners'] = { characters: [], weapons: [] };
  let currentPhase = '';

  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    if (text.startsWith('Phase')) {
      currentPhase = text;
      return;
    }
    // Les bannières sont des liens (noms de bannières)
    const link = $(el).find('a').first().text().trim();
    if (!link) return;

    const lowerText = text.toLowerCase();
    if (lowerText.includes('epitome') || lowerText.includes('weapon')) {
      banners.weapons.push(link);
    } else {
      banners.characters.push(link);
    }
  });

  return banners;
}

function parseArchonQuests($: $, section: any) {
  const quests: VersionData['newQuests']['archonQuests'] = [];

  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    // Format: "Chapter I: Act III - A New Star Approaches"
    // ou: "Interlude Chapter: Act I - The Crane Returns on the Wind"
    const match = text.match(/([^:]+):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i);
    if (!match) return;

    const chapterName = match[1].trim();
    const actNum = romanToInt(match[2].trim());
    const actName = match[3].replace(/\(.*?\)/g, '').trim(); // retire "(Tartaglia)" etc.

    // Cherche si le chapitre existe déjà
    let chapter = quests.find(q => q.chapterName === chapterName);
    if (!chapter) {
      chapter = {
        chapter: chapterNameToKey(chapterName),
        chapterName,
        acts: [],
      };
      quests.push(chapter);
    }
    chapter.acts.push({ act: actNum, name: actName });
  });

  return quests;
}

function parseStoryQuests($: $, section: any) {
  const quests: VersionData['newQuests']['storyQuests'] = [];

  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    // Format: "Monoceros Caeli Chapter: Act I - Mighty Cyclops' Adventure! (Tartaglia)"
    const match = text.match(/([^:]+Chapter):\s*Act\s+([IVX\d]+)\s*[-–]\s*([^(]+)\(?([^)]*)\)?/i);
    if (!match) return;

    const chapter = match[1].trim();
    const actNum = romanToInt(match[2].trim());
    const actName = match[3].trim();
    const character = match[4].trim() || '';

    quests.push({
      chapter,
      character,
      acts: [{ act: actNum, name: actName }],
    });
  });

  return quests;
}

function parseWorldQuests($: $, section: any): string[] {
  const quests: string[] = [];
  section.find('li').each((_: number, el: any) => {
    // Exclut les sous-listes (world quest series)
    if ($(el).parents('li').length > 0) return;
    const text = cleanText($(el).clone().children('ul').remove().end().text());
    if (text) quests.push(text);
  });
  return quests;
}

function parseHangoutQuests($: $, section: any) {
  const quests: VersionData['newQuests']['hangoutQuests'] = [];

  section.find('li').each((_: number, el: any) => {
    const text = cleanText($(el).text());
    // Format: "Ningguang: Act I - The Jade Chamber's Returning Guest"
    const match = text.match(/([^:]+):\s*Act\s+([IVX\d]+)\s*[-–]\s*(.+)/i);
    if (!match) return;

    const character = match[1].trim();
    const actNum = romanToInt(match[2].trim());
    const actName = match[3].trim();

    let existing = quests.find(q => q.character === character);
    if (!existing) {
      existing = { character, acts: [] };
      quests.push(existing);
    }
    existing.acts.push({ act: actNum, name: actName });
  });

  return quests;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  // Vérifie si c'est déjà un nombre
  if (/^\d+$/.test(s)) return parseInt(s);
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const curr = map[s[i]] ?? 0;
    const next = map[s[i + 1]] ?? 0;
    result += curr < next ? -curr : curr;
  }
  return result;
}

function chapterNameToKey(chapterName: string): string {
  if (chapterName.toLowerCase().includes('prologue')) return 'prologue';
  if (chapterName.toLowerCase().includes('interlude')) return 'interlude';
  const match = chapterName.match(/Chapter\s+([IVX\d]+)/i);
  return match ? String(romanToInt(match[1])) : chapterName.toLowerCase().replace(/\s+/g, '_');
}

function parseDateFromPage($: $): string {
  // La date est dans le tableau "Release Date"
  const dateText = $('table').find('td, th').filter((_, el) => {
    return $(el).text().includes('Release Date') || $(el).text().includes('January') ||
           $(el).text().includes('November') || $(el).text().includes('2020') ||
           $(el).text().includes('2021') || $(el).text().includes('2022');
  }).first().text();
  // Essaie de parser une date du format "January 5, 2022"
  const match = dateText.match(/(\w+ \d+, \d{4})/);
  if (match) {
    return new Date(match[1]).toISOString().split('T')[0];
  }
  return '';
}

// ── Scraper principal ─────────────────────────────────────────────────────────

async function scrapeVersion(versionNumber: string): Promise<VersionData> {
  const url = `${BASE_URL}/${versionNumber}`;
  console.log(`Fetching ${url}...`);

  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GenshinDataBot/1.0)',
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });

  const $ = cheerio.load(data);

  // Titre de la version (ex: "A New Star Approaches")
  const name = $('h2').first().next('h2').text().trim() || 
               $('.page-header__title').text().trim();

  // Date de release depuis le tableau d'infos
  const releaseDate = parseDateFromPage($);

  // Structure principale : on navigue par les titres H3 dans "New Content"
  const result: VersionData = {
    number: versionNumber,
    name: '',
    releaseDate,
    endDate: '',
    newCharacters: [],
    newWeapons: {},
    newBosses: [],
    banners: { characters: [], weapons: [] },
    events: [],
    newDomains: [],
    newArtifacts: [],
    newMonsters: [],
    newQuests: {
      archonQuests: [],
      storyQuests: [],
      worldQuests: [],
      hangoutQuests: [],
    },
  };

  // Récupère le nom de la version depuis le H2 de sous-titre
  const allH2 = $('h2');
  allH2.each((_: number, el: any) => {
    const text = $(el).text().trim().replace(/\[.*\]/, '').trim();
    if (text && !['New Content', 'Optimizations', 'Adjustments', 'Fixes', 'Bug Fixes', 'Gallery', 'Navigation', 'Other Languages', 'Contents', 'Post-patch'].some(s => text.includes(s))) {
      if (!result.name && text.length > 3) result.name = text;
    }
  });

  // Navigue dans les sections par H3
  $('h3, h4').each((_, heading) => {
    const headingText = $(heading).text().replace(/\[.*\]/g, '').trim();
    
    // Collecte les éléments suivants jusqu'au prochain H3/H4
    const sectionContent = $(heading).nextUntil('h3, h4, h2');

    if (headingText === 'New Characters') {
      result.newCharacters = parseNewCharacters($, sectionContent);
    } else if (headingText === 'New Weapons') {
      result.newWeapons = parseNewWeapons($, sectionContent);
    } else if (headingText === 'New Events') {
      result.events = parseEvents($, sectionContent);
    } else if (headingText === 'New Domains') {
      result.newDomains = parseDomains($, sectionContent);
    } else if (headingText === 'New Monsters' || headingText === 'New Enemies') {
      result.newMonsters = parseMonsters($, sectionContent);
    } else if (headingText === 'New Artifact Sets' || headingText === 'New Artifacts') {
      result.newArtifacts = parseMonsters($, sectionContent); // même structure liste simple
    } else if (headingText === 'Event Wishes') {
      result.banners = parseBanners($, sectionContent);
    }
  });

  // Les quêtes sont sous "New Quests" > listes imbriquées
  $('h3').each((_, heading) => {
    if (!$(heading).text().includes('New Quests')) return;
    const section = $(heading).nextUntil('h3, h2');

    // Archon Quests
    const archonItems = section.find('li').filter((_, el) => {
      return $(el).text().includes('Chapter') && $(el).text().includes('Act') &&
             $(el).text().includes('-') && !$(el).text().includes('Story');
    });
    result.newQuests.archonQuests = parseArchonQuests($, archonItems.parent());

    // Story Quests
    const storyItems = section.find('li').filter((_, el) => {
      return $(el).text().includes('Chapter') && $(el).text().includes('Act') &&
             !$(el).text().includes('Chapter I') && !$(el).text().includes('Chapter II');
    });
    result.newQuests.storyQuests = parseStoryQuests($, storyItems.parent());

    // World Quests — sous-liste "New World Quests"
    section.find('li').each((_: number, el: any) => {
      const text = $(el).text().trim();
      if (!text.includes('Chapter') && !text.includes('Act') && 
          !text.includes('Phase') && !text.includes('Series')) {
        result.newQuests.worldQuests.push(cleanText($(el).clone().children('ul').remove().end().text()));
      }
    });

    // Hangout Quests
    const hangoutItems = section.find('li').filter((_, el) => {
      const text = $(el).text();
      return text.includes('Act') && text.includes('-') && !text.includes('Chapter');
    });
    result.newQuests.hangoutQuests = parseHangoutQuests($, hangoutItems.parent());
  });

  return result;
}

// ── Entrée principale ─────────────────────────────────────────────────────────

async function main() {
  const versions = process.argv.slice(2);

  if (versions.length === 0) {
    console.error('Usage: npx ts-node scripts/scrape-version.ts 1.1 1.2 2.0');
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
      console.log(`✅ Version ${version} saved to ${filePath}`);
      // Pause entre les requêtes pour ne pas surcharger le serveur
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`❌ Failed to scrape version ${version}:`, err);
    }
  }
}

main();