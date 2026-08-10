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

const ELEMENT_NAMES = ['Pyro', 'Hydro', 'Anemo', 'Electro', 'Dendro', 'Cryo', 'Geo'];

// ── Helpers génériques ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
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
        console.warn(`⚠️  ${label} a échoué (tentative ${i + 1}/${attempts}), nouvel essai...`);
        await sleep(800 * (i + 1));
      }
    }
  }
  throw lastErr;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type EnemyCategory = 'common' | 'elite' | 'normalBoss' | 'weeklyBoss' | 'unknown';

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

// Les libellés de liens observés sur les pages de version varient énormément
// d'une version à l'autre (numérotation, dates embarquées : "Developer's
// Discussion 4/16", "Update Notice May 27"...) sans jamais changer de nature.
// On les normalise donc en catégories fixes plutôt que de garder le texte
// brut, OTHER servant de repli pour les libellés vraiment uniques (ex:
// "Serenitea Pot System Details").
enum LinkLabel {
  PATCH_NOTES = 'PATCH_NOTES',
  UPDATE_NOTICE = 'UPDATE_NOTICE',
  VERSION_HIGHLIGHTS = 'VERSION_HIGHLIGHTS',
  VERSION_WEBSITE = 'VERSION_WEBSITE',
  PREVIEW_PAGE = 'PREVIEW_PAGE',
  DEVELOPERS_DISCUSSION = 'DEVELOPERS_DISCUSSION',
  SYSTEM_UPDATE_OVERVIEW = 'SYSTEM_UPDATE_OVERVIEW',
  NEW_CONTENTS_DISPLAY_PAGE = 'NEW_CONTENTS_DISPLAY_PAGE',
  PAIMONS_VERSION_UPDATE_NOTES = 'PAIMONS_VERSION_UPDATE_NOTES',
  OTHER = 'OTHER',
}

function classifyLinkLabel(rawLabel: string): LinkLabel {
  const clean = rawLabel.trim();
  if (/^(Patch Notes|Update Details)$/i.test(clean)) return LinkLabel.PATCH_NOTES;
  if (/^Version Highlights$/i.test(clean)) return LinkLabel.VERSION_HIGHLIGHTS;
  if (/Update (Notice|Maintenance)/i.test(clean)) return LinkLabel.UPDATE_NOTICE;
  if (/Preview Page$/i.test(clean)) return LinkLabel.PREVIEW_PAGE;
  if (/Website$/i.test(clean)) return LinkLabel.VERSION_WEBSITE;
  if (/Developer'?s Discussion/i.test(clean)) return LinkLabel.DEVELOPERS_DISCUSSION;
  if (/System Update Overview/i.test(clean)) return LinkLabel.SYSTEM_UPDATE_OVERVIEW;
  if (/New Contents Display Page/i.test(clean)) return LinkLabel.NEW_CONTENTS_DISPLAY_PAGE;
  if (/Paimon'?s Version Update Notes/i.test(clean))
    return LinkLabel.PAIMONS_VERSION_UPDATE_NOTES;
  return LinkLabel.OTHER;
}

interface Link {
  label: LinkLabel;
  url: string;
}

interface CharacterEntry {
  name: string;
  rarity: 4 | 5 | null;
  element: string | null;
  weaponType: string | null;
}

interface OutfitEntry {
  name: string;
  character: string;
}

interface BannerCharacterEntry {
  name: string;
  featured: string;
  phase: number | null;
}

interface TcgCards {
  characterCards: string[];
  actionCards: string[];
}

interface ImaginariumTheater {
  startDateRaw: string | null;
  requiredElements: string[];
  openingCharacters: string[];
  guestCharacters: string[];
}

interface Floor12DisorderPeriod {
  FIRST_HALF: string;
  SECOND_HALF: string;
}

interface SpiralAbyssSeason {
  startDateRaw: string | null;
  floor11Disorder: string[];
  floor12Disorder: Floor12DisorderPeriod[];
  blessingName: string | null;
  blessingEffect: string | null;
}

interface AchievementCategory {
  category: string;
  achievements: string[];
}

interface QuestsData {
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
}

interface VersionData {
  number: string;
  cycleLabel: string | null;
  name: string;
  subtitle: string | null;
  description: string;
  releaseDate: string;
  endDate: string;
  previousVersion: string | null;
  nextVersion: string | null;
  links: Link[];
  images: string[];

  newCharacters: CharacterEntry[];
  newOutfits: OutfitEntry[];
  newWeapons: Partial<
    Record<'1Star' | '2Star' | '3Star' | '4Star' | '5Star', string[]>
  >;
  banners: { characters: BannerCharacterEntry[]; weapons: string[] };

  mapExpansion: MapExpansion[];
  newDomains: string[];
  newSystems: string[];
  newEnemies: EnemiesData;
  newCreatures: string[];

  newArtifacts: string[];
  newMaterials: string[];
  newMonsterDrops: string[];
  newTalentMaterials: string[];
  newWeaponAscensionMaterials: string[];

  newQuests: QuestsData;
  events: string[];

  newRecipes: string[];
  newFormulas: string[];
  newSpecialtyDishes: string[];
  newAchievements: AchievementCategory[];
  newNamecards: string[];
  newGadgets: string[];
  newFurnishings: string[];
  newFurnishingSets: string[];
  newBooks: string[];
  newTcgCards: TcgCards;

  imaginariumTheater: ImaginariumTheater | null;
  spiralAbyss: SpiralAbyssSeason | null;
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

// Retire les blocs <!-- ... --> avant tout parsing : sinon des libellés
// ";Section" laissés en commentaire (ex: ";New Domains" désactivé sur Luna
// VIII) ou des liens commentés (|link4 = <!--[...]-->) pollueraient
// l'extraction de sections/liens comme s'ils étaient réellement présents.
function stripComments(wikitext: string): string {
  return wikitext.replace(/<!--[\s\S]*?-->/g, '');
}

async function fetchWikitext(versionArg: string): Promise<string> {
  const raw = await withRetry(`fetch wikitext "Version/${versionArg}"`, () =>
    fetchPageWikitext(`Version/${versionArg}`),
  );
  return stripComments(raw);
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
        const response = await withRetry(`langlinks FR (lot de ${chunk.length})`, () =>
          axios.get(EN_API_URL, {
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
          }),
        );
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
      await sleep(300);
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

// Sous-titre narratif FR (ex: "Chant de l'astre de la nuit - Scherzo"),
// constaté sous la forme 'est la version Luna VIII, ou version « Xxx », de'
// dans la phrase d'intro FR — uniquement présent quand la version EN a un
// title2. Absent sinon (retombe sur null, jamais sur l'EN qui n'est pas une
// traduction valide en soi).
function extractSubtitleFr(wikitext: string): string | null {
  const match = wikitext.match(/ou version\s*«\s*([^»]+?)\s*»/);
  return match ? cleanWikiLink(match[1]).trim() : null;
}

// Description FR : le champ infobox "|description = " existe aussi bien sur
// {{Version}} (EN) que {{Infobox Version}} (FR), avec la même clé — pas
// besoin de langlinks, une simple relecture du wikitext FR suffit.
function extractDescriptionFr(wikitext: string): string | null {
  const match = wikitext.match(/\|\s*description\s*=\s*([^\n|]+)/);
  return match ? match[1].trim() : null;
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

function translateQuestsFr(quests: QuestsData, map: Map<string, string>): QuestsData {
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
//
// Champs volontairement NON traduits (comme "effects" pour les armes /
// artefacts ailleurs dans le projet) : les textes libres (banners.featured,
// imaginariumTheater/spiralAbyss hors noms de personnages, requiredElements)
// n'ont pas de page wiki correspondante à résoudre via
// langlinks — un vrai passage de traduction humaine ou un LLM serait
// nécessaire, hors scope d'un scraper. Les noms d'éléments (Hydro, Pyro...)
// restent identiques en FR dans le jeu, donc copiés tels quels.
async function buildFrVersionData(
  enData: VersionData,
  versionNumber: string,
): Promise<VersionData | null> {
  let frWikitext: string | null = null;
  try {
    frWikitext = stripComments(
      await withRetry(`fetch wikitext FR "Version/${versionNumber}"`, () =>
        fetchPageWikitext(`Version/${versionNumber}`, FR_API_URL),
      ),
    );
  } catch {
    frWikitext = null;
  }

  if (!frWikitext) {
    console.warn(
      `⚠️  "Version/${versionNumber}": page FR introuvable, fichier fr/ non généré.`,
    );
    return null;
  }

  const frName = extractStoryTitleFr(frWikitext);
  if (!frName) {
    console.warn(
      `⚠️  "Version/${versionNumber}": titre narratif FR introuvable, repli sur le nom EN.`,
    );
  }
  const frSubtitle = enData.subtitle ? extractSubtitleFr(frWikitext) : null;
  const frDescription = extractDescriptionFr(frWikitext);

  const namesToTranslate = new Set<string>([
    ...enData.newCharacters.map((c) => c.name),
    ...enData.newOutfits.flatMap((o) => [o.name, o.character]),
    ...Object.values(enData.newWeapons).flat(),
    ...enData.banners.characters.map((b) => b.name),
    ...enData.banners.weapons.map((w) => splitBannerNameDate(w).base),
    ...enData.newDomains,
    ...enData.newSystems,
    ...enData.newCreatures,
    ...enData.newArtifacts,
    ...enData.newMaterials,
    ...enData.newMonsterDrops,
    ...enData.newTalentMaterials,
    ...enData.newWeaponAscensionMaterials,
    ...enData.newEnemies.common,
    ...enData.newEnemies.elite,
    ...enData.newEnemies.boss.normal,
    ...enData.newEnemies.boss.weekly,
    ...enData.mapExpansion.flatMap((m) => [m.mainRegion, ...m.subRegion]),
    ...enData.events,
    ...enData.newQuests.worldQuests,
    ...enData.newQuests.archonQuests.flatMap((q) => q.acts.map((a) => a.name)),
    ...enData.newQuests.storyQuests.flatMap((q) => q.acts.map((a) => a.name)),
    ...enData.newQuests.hangoutQuests.flatMap((q) => q.acts.map((a) => a.name)),
    ...enData.newRecipes,
    ...enData.newFormulas,
    ...enData.newSpecialtyDishes,
    ...enData.newAchievements.map((a) => a.category),
    ...enData.newNamecards,
    ...enData.newGadgets,
    ...enData.newFurnishings,
    ...enData.newFurnishingSets,
    ...enData.newBooks,
    ...enData.newTcgCards.characterCards,
    ...enData.newTcgCards.actionCards,
    ...(enData.imaginariumTheater?.openingCharacters ?? []),
    ...(enData.imaginariumTheater?.guestCharacters ?? []),
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
    cycleLabel: enData.cycleLabel,
    name: frName ?? enData.name,
    subtitle: frSubtitle,
    description: frDescription ?? enData.description,
    releaseDate: enData.releaseDate,
    endDate: enData.endDate,
    previousVersion: enData.previousVersion,
    nextVersion: enData.nextVersion,
    links: enData.links,
    images: enData.images,

    newCharacters: enData.newCharacters.map((c) => ({
      ...c,
      name: translate(c.name, map),
    })),
    newOutfits: enData.newOutfits.map((o) => ({
      name: translate(o.name, map),
      character: translate(o.character, map),
    })),
    newWeapons: translateWeapons(enData.newWeapons),
    banners: {
      characters: enData.banners.characters.map((b) => ({
        ...b,
        name: translate(b.name, map),
      })),
      weapons: enData.banners.weapons.map((w) => {
        const { base, date } = splitBannerNameDate(w);
        return formatBannerNameWithDate(translate(base, map), date);
      }),
    },

    mapExpansion: enData.mapExpansion.map((m) => ({
      mainRegion: translate(m.mainRegion, map),
      subRegion: translateList(m.subRegion),
    })),
    newDomains: translateList(enData.newDomains),
    newSystems: translateList(enData.newSystems),
    newEnemies: {
      common: translateList(enData.newEnemies.common),
      elite: translateList(enData.newEnemies.elite),
      boss: {
        normal: translateList(enData.newEnemies.boss.normal),
        weekly: translateList(enData.newEnemies.boss.weekly),
      },
    },
    newCreatures: translateList(enData.newCreatures),

    newArtifacts: translateList(enData.newArtifacts),
    newMaterials: translateList(enData.newMaterials),
    newMonsterDrops: translateList(enData.newMonsterDrops),
    newTalentMaterials: translateList(enData.newTalentMaterials),
    newWeaponAscensionMaterials: translateList(enData.newWeaponAscensionMaterials),

    newQuests: translateQuestsFr(enData.newQuests, map),
    events: translateList(enData.events),

    newRecipes: translateList(enData.newRecipes),
    newFormulas: translateList(enData.newFormulas),
    newSpecialtyDishes: translateList(enData.newSpecialtyDishes),
    newAchievements: enData.newAchievements.map((a) => ({
      category: translate(a.category, map),
      achievements: a.achievements,
    })),
    newNamecards: translateList(enData.newNamecards),
    newGadgets: translateList(enData.newGadgets),
    newFurnishings: translateList(enData.newFurnishings),
    newFurnishingSets: translateList(enData.newFurnishingSets),
    newBooks: translateList(enData.newBooks),
    newTcgCards: {
      characterCards: translateList(enData.newTcgCards.characterCards),
      actionCards: translateList(enData.newTcgCards.actionCards),
    },

    imaginariumTheater: enData.imaginariumTheater && {
      startDateRaw: enData.imaginariumTheater.startDateRaw,
      requiredElements: enData.imaginariumTheater.requiredElements,
      openingCharacters: translateList(enData.imaginariumTheater.openingCharacters),
      guestCharacters: translateList(enData.imaginariumTheater.guestCharacters),
    },
    spiralAbyss: enData.spiralAbyss,
  };
}

async function fetchEnemyType(enemyName: string): Promise<EnemyCategory> {
  try {
    const wikitext = await withRetry(`fetch type ennemi "${enemyName}"`, () =>
      fetchPageWikitext(enemyName.replace(/ /g, '_')),
    );
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

// Résout les templates d'éléments ({{Cryo}}, {{Hydro}}...) en texte brut
// AVANT cleanWikiLink, qui sinon supprimerait purement et simplement tout
// template {{...}} — nécessaire pour extraire l'élément d'un personnage
// depuis une ligne du type "(5-Star {{Cryo}} Claymore)".
function resolveElementTemplates(text: string): string {
  const pattern = new RegExp(`\\{\\{(${ELEMENT_NAMES.join('|')})\\}\\}`, 'gi');
  return text.replace(pattern, '$1');
}

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

interface TemplateFields {
  title: string;
  title2: string;
  version: string;
  number: string;
  date: string;
  prev: string;
  next: string;
  description: string;
  links: Link[];
  images: string[];
}

function parseTemplateFields(wikitext: string): TemplateFields {
  const get = (key: string): string => {
    const match = wikitext.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^\n|]+)`));
    return match ? match[1].trim() : '';
  };

  const links: Link[] = [];
  for (let i = 1; i <= 9; i++) {
    const raw = get(`link${i}`);
    if (!raw) continue;
    const match = raw.match(/\[(\S+)\s+([^\]]+)\]/);
    if (match) links.push({ url: match[1], label: classifyLinkLabel(match[2]) });
  }

  const images: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const raw = get(`image${i}`);
    if (raw) images.push(raw);
  }

  return {
    title: get('title'),
    title2: get('title2'),
    version: get('version'),
    number: get('number'),
    date: get('date'),
    prev: get('prev'),
    next: get('next'),
    description: get('description'),
    links,
    images,
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

    await sleep(300);
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

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseCharacters(section: string): CharacterEntry[] {
  return section
    .split('\n')
    .filter((line) => /^\*{1}\s*/.test(line))
    .map((line) => {
      const clean = cleanWikiLink(
        resolveElementTemplates(line).replace(/^\*+\s*/, ''),
      );

      const meta = clean.match(/\((\d)-Star\s+(\w+)\s+(\w+)\)/);
      const rarity = meta ? ((parseInt(meta[1], 10) as 4 | 5) ?? null) : null;
      const element = meta ? meta[2] : null;
      const weaponType = meta ? meta[3] : null;

      // Format: "Title" Name (X-Star Element Weapon)
      const withQuote = clean.match(/"[^"]*"\s+([^(]+)\s*\(/);
      // Format: Name (X-Star Element Weapon)
      const withoutQuote = clean.match(/^([^(]+)\s*\(\d-Star/);
      // Fallback : avant parenthèse
      const fallback = clean.match(/^([^(]+)/);
      const name = (
        withQuote?.[1] ??
        withoutQuote?.[1] ??
        fallback?.[1] ??
        clean
      ).trim();

      return { name, rarity, element, weaponType };
    })
    .filter((c) => Boolean(c.name));
}

function parseOutfits(section: string): OutfitEntry[] {
  return section
    .split('\n')
    .filter((line) => /^\*+\s*/.test(line))
    .map((line) => cleanWikiLink(line.replace(/^\*+\s*/, '')))
    .filter(Boolean)
    .map((clean) => {
      const match = clean.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      return match
        ? { name: match[1].trim(), character: match[2].trim() }
        : { name: clean, character: '' };
    });
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

// "Epitome Invocation" revient à quasi chaque version sous le même nom : sans
// distinction, impossible de savoir à quelle occurrence appartient une entrée
// une fois toutes les versions rassemblées — même principe que le nommage
// "Nom Date.png" des fichiers de bannières dans scrape-banners.ts. On
// suffixe donc avec la date de sortie de la version. splitBannerNameDate fait
// l'inverse pour retrouver le nom brut avant résolution des langlinks FR (le
// nom suffixé ne correspond à aucun titre de page wiki).
function formatBannerNameWithDate(name: string, releaseDate: string): string {
  return releaseDate ? `${name} (${releaseDate})` : name;
}

function splitBannerNameDate(nameWithDate: string): { base: string; date: string } {
  const match = nameWithDate.match(/^(.*) \((\d{4}-\d{2}-\d{2})\)$/);
  return match ? { base: match[1], date: match[2] } : { base: nameWithDate, date: '' };
}

// Bannières : nettoyer les lignes [[File:...]] avant de parser, suivre le
// "Phase I"/"Phase II" (niveau 1) pour associer chaque bannière (niveau 2) à
// sa phase, et extraire le contenu entre parenthèses en tant que "featured"
// (personnage vedette, ou libellé de wish partagée — pas toujours un nom de
// personnage, cf. commentaire dans buildFrVersionData).
function parseBanners(section: string, releaseDate: string): VersionData['banners'] {
  const banners: VersionData['banners'] = {
    characters: [],
    weapons: [formatBannerNameWithDate('Epitome Invocation', releaseDate)],
  };
  let currentPhase: number | null = null;

  section
    .split('\n')
    .filter((line) => /^\*+\s*/.test(line) && !line.includes('[[File:'))
    .forEach((line) => {
      const depth = (line.match(/^\*+/) ?? [''])[0].length;
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      if (depth === 1) {
        const phaseMatch = clean.match(/^Phase\s+([IVX]+)/i);
        if (phaseMatch) currentPhase = romanToInt(phaseMatch[1]);
        return;
      }

      if (depth !== 2) return;

      const match = clean.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const bannerName = (match ? match[1] : clean).trim();
      const featured = match ? match[2].trim() : '';
      if (!bannerName) return;

      if (bannerName.toLowerCase().includes('epitome')) {
        banners.weapons.push(formatBannerNameWithDate(bannerName, releaseDate));
      } else {
        banners.characters.push({ name: bannerName, featured, phase: currentPhase });
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

// 2. Quêtes : tout parser depuis la section "New Quests" en vrac
// en distinguant archon/story/hangout/world par le contenu de chaque ligne
function parseQuests(section: string): QuestsData {
  const result: QuestsData = {
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

    // Archon Quest tout-en-un : "Archon Quest Chapter III: Act VI - Caribert",
    // ou même sans préfixe "Archon Quest " quand il est déjà sur une ligne
    // d'en-tête séparée : "Chapter I: Act III - A New Star Approaches" (1.1).
    // Ce cas doit être détecté AVANT la détection d'en-tête niveau 1
    // ci-dessous : la plupart des versions numérotées écrivent le chapitre ET
    // l'acte sur la MÊME ligne niveau 1 ("* Archon Quest Chapter III: Act VI
    // - Caribert"), et l'en-tête, en interceptant la ligne la première pour
    // n'en extraire que le nom de chapitre, ferait perdre l'acte qui n'existe
    // sur aucune autre ligne.
    // Le marqueur après le chapitre est presque toujours "Act N", mais
    // certaines quêtes spéciales de milieu de chapitre l'écrivent "Prologue"
    // ou "Interlude" à la place (1.6, 5.2) — traité comme acte 0.
    const archonInlineMatch = clean.match(
      /(?:Archon Quests?\s+)?(.*(?:Chapter\s+[IVX\d]+|Prologue|Interlude Chapter).*):\s*(?:Act\s+([IVX\d]+)|(Prologue|Interlude))\s*[-–]\s*(.+)/i,
    );
    if (archonInlineMatch) {
      const chapterName = archonInlineMatch[1]
        .replace(/^Archon Quests?\s*:?\s*/i, '')
        .trim();
      const actNum = archonInlineMatch[2] ? romanToInt(archonInlineMatch[2]) : 0;
      const actName = archonInlineMatch[4].replace(/\(.*?\)/g, '').trim();

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

    // ── Détection des labels de section (niveau 1) ────────────────────────────
    if (depth === 1) {
      const lower = clean.toLowerCase();
      if (lower.includes('archon quest')) {
        currentSection = 'archon';
        // Certaines pages (1.0, 2.0) combinent l'en-tête et le chapitre sur
        // une seule ligne niveau 1 ("Archon Quests Chapter II", ou avec ":"
        // comme séparateur sur 2.7 : "Archon Quests: Interlude Chapter") sans
        // acte sur cette même ligne (l'acte suit alors en profondeur 2/3) —
        // le cas où l'acte est aussi sur cette ligne est déjà couvert par
        // archonInlineMatch ci-dessus.
        const chapterInlineMatch = clean.match(
          /Archon Quests?\s*:?\s*(Chapter\s+[IVX\d]+|Prologue|Interlude Chapter)/i,
        );
        currentChapterName = chapterInlineMatch ? chapterInlineMatch[1].trim() : '';
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
    // (le chapitre inline niveau 1 "Archon Quests Chapter II" est déjà
    // extrait par la détection d'en-tête plus haut, cf. currentChapterName)

    // Niveau 2 section archon format 2.0 : "** Act I: Name" ou "** Act I - Name"
    if (depth === 2 && currentSection === 'archon' && currentChapterName) {
      const actColonMatch = clean.match(/Act\s+([IVX\d]+)\s*(?:[-–]|:)\s*(.+)/i);
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

    // Niveau 2 section archon : "** Chapter III" (chapitre seul, 3.0) ou nom
    // d'arc narratif sans le mot "Chapter" (cycle Luna, ex: "Song of the
    // Welkin Moon" — Luna I) : toute ligne niveau 2 qui n'est pas elle-même
    // un Act sert de nom de chapitre/arc pour les lignes suivantes.
    if (depth === 2 && currentSection === 'archon' && !/^Act\s+[IVX\d]+/i.test(clean)) {
      currentChapterName = clean.trim();
      continue;
    }

    // Niveau 3 section archon : "*** Act I - Name" ou "*** Act I: Name"
    if (depth === 3 && currentSection === 'archon' && currentChapterName) {
      const actMatch = clean.match(/Act\s+([IVX\d]+)\s*(?:[-–]|:)\s*(.+)/i);
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

    const clean = cleanDomainName(cleanWikiLink(line.replace(/^\*+\s*/, '')));

    if (!clean) return;

    if (depth === 1) {
      // Format "Domain of Forgery: Court of Flowing Sand" ou "Trounce Domain:
      // Confront Stormterror" (1.0) → garder seulement ce qui suit le ":".
      // Le mot "Domain(s)" avant le ":" identifie un libellé de groupe plutôt
      // qu'un nom de domaine à part entière.
      const colonMatch = clean.match(/^.*\bDomains?\b.*?:\s*(.+)/i);
      if (colonMatch) {
        domains.push(colonMatch[1].trim());
        return;
      }
      // Ignore les labels purs comme "One-Time Domains" ou "Domain of
      // Blessing:" (sans contenu après le ":", parfois suivi d'un ":" final
      // quand les sous-domaines sont listés en profondeur 2 à la place — 1.0)
      if (clean.match(/^.*\bDomains?\b.*?:?$/i)) return;

      domains.push(clean);
    } else if (depth === 2) {
      // Sous-domaines (One-Time Domains en 2.0)
      domains.push(clean);
    }
  });

  return domains;
}

function parseTcgCards(section: string): TcgCards {
  const result: TcgCards = { characterCards: [], actionCards: [] };
  let currentGroup: 'character' | 'action' | null = null;

  section
    .split('\n')
    .filter((line) => /^\*+\s*/.test(line))
    .forEach((line) => {
      const depth = (line.match(/^\*+/) ?? [''])[0].length;
      const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
      if (!clean) return;

      if (depth === 1) {
        if (/character cards/i.test(clean)) currentGroup = 'character';
        else if (/action cards/i.test(clean)) currentGroup = 'action';
        else currentGroup = null;
        return;
      }

      if (depth === 2 && currentGroup) {
        const list =
          currentGroup === 'character' ? result.characterCards : result.actionCards;
        list.push(clean);
      }
      // depth >= 3 (sous-cartes de talent, variantes...) ignoré
    });

  return result;
}

// Saison d'Imaginarium Theater : texte libre, on cherche les phrases-clés
// ("Required Elemental Types:", "Opening Characters:", "Special Guest
// Stars:") indépendamment de leur profondeur de puce exacte, qui a varié
// d'une version à l'autre. Retourne null si aucune de ces phrases n'est
// trouvée (mécanique absente ou wording totalement différent).
function parseImaginariumTheater(section: string): ImaginariumTheater | null {
  if (!section.trim()) return null;

  const lines = section
    .split('\n')
    .filter((l) => /^\*+\s*/.test(l))
    .map((l) => cleanWikiLink(resolveElementTemplates(l)));

  const dateLine = lines.find((l) => /available on|come online on/i.test(l));
  const dateMatch = dateLine?.match(
    /(?:available on|come online on)\s+([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)/i,
  );

  const splitList = (line: string | undefined, label: RegExp): string[] =>
    line
      ? line
          .replace(label, '')
          .split(/,|\band\b/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const requiredElements = splitList(
    lines.find((l) => /Required Elemental Types:/i.test(l)),
    /^.*Required Elemental Types:\s*/i,
  );
  const openingCharacters = splitList(
    lines.find((l) => /Opening Characters:/i.test(l)),
    /^.*Opening Characters:\s*/i,
  );
  const guestCharacters = splitList(
    lines.find((l) => /Special Guest Stars:/i.test(l)),
    /^.*Special Guest Stars:\s*/i,
  );

  if (!dateMatch && !requiredElements.length && !openingCharacters.length) {
    return null;
  }

  return {
    startDateRaw: dateMatch ? dateMatch[1] : null,
    requiredElements,
    openingCharacters,
    guestCharacters,
  };
}

// Saison de Spiral Abyss : la profondeur de nesting utilisée pour rattacher
// Floor 11/12 et la bénédiction saisonnière à leurs lignes de détail a varié
// d'une version à l'autre (ex: puce niveau 1 sur 5.0, niveau 2 sur Luna
// VIII) — on suit donc la profondeur de la ligne d'en-tête qui a ouvert le
// groupe courant ("groupDepth") plutôt qu'une profondeur absolue : toute
// ligne plus profonde appartient au groupe, toute ligne à profondeur égale
// ou moindre le referme. Le nom de la bénédiction elle-même a aussi changé
// de libellé au fil du temps ("Blessing of the Abyssal Moon", "Lunar
// Phase"...) : on prend la première ligne suivant "Updated the monster
// lineup" qui n'est pas une simple phrase de transition, quel que soit son
// libellé exact.
// Regroupe les lignes brutes de Floor 12 en périodes {FIRST_HALF, SECOND_HALF} :
// une saison Abyss dure 2 périodes (ex: luna_i, 5.4, 5.6 ont 4 lignes = 2
// paires First/Second Half, une par période). Une ligne "First Half:" ouvre
// une nouvelle période ; "Second Half:" complète la période ouverte (ou en
// ouvre une si aucune n'est en attente). Les anciennes versions dont le
// disorder n'est pas scindé en deux moitiés (simple phrase libre) sont
// conservées telles quelles dans FIRST_HALF, SECOND_HALF restant vide plutôt
// que de perdre l'information.
function buildFloor12Periods(lines: string[]): Floor12DisorderPeriod[] {
  const periods: Floor12DisorderPeriod[] = [];
  let pending: Floor12DisorderPeriod | null = null;

  for (const line of lines) {
    const firstMatch = line.match(/^First Half:\s*(.+)/i);
    if (firstMatch) {
      pending = { FIRST_HALF: firstMatch[1].trim(), SECOND_HALF: '' };
      periods.push(pending);
      continue;
    }

    const secondMatch = line.match(/^Second Half:\s*(.+)/i);
    if (secondMatch) {
      if (pending && !pending.SECOND_HALF) {
        pending.SECOND_HALF = secondMatch[1].trim();
      } else {
        pending = { FIRST_HALF: '', SECOND_HALF: secondMatch[1].trim() };
        periods.push(pending);
      }
      continue;
    }

    pending = { FIRST_HALF: line, SECOND_HALF: '' };
    periods.push(pending);
  }

  return periods;
}

function parseSpiralAbyssSeason(section: string): SpiralAbyssSeason | null {
  if (!section.trim()) return null;

  const lines = section.split('\n').filter((l) => /^\*+\s*/.test(l));
  const floor11Disorder: string[] = [];
  const floor12Lines: string[] = [];
  const blessingEffect: string[] = [];
  let blessingName: string | null = null;
  let dateRaw: string | null = null;

  let mode: 'floor11' | 'floor12' | 'blessing' | null = null;
  let groupDepth = 0;
  let awaitingBlessingHeader = false;

  for (const line of lines) {
    const depth = (line.match(/^\*+/) ?? [''])[0].length;
    const clean = cleanWikiLink(line.replace(/^\*+\s*/, ''));
    if (!clean) continue;

    if (!dateRaw) {
      const dateMatch = clean.match(
        /(?:come online on|will come online on|take effect after the Spiral Abyss update on)\s+([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)/i,
      );
      if (dateMatch) dateRaw = dateMatch[1];
    }

    // Une ligne à une profondeur <= à celle du groupe ouvert le referme.
    if (mode && depth <= groupDepth) mode = null;

    if (mode) {
      if (mode === 'floor11') floor11Disorder.push(clean);
      else if (mode === 'floor12') floor12Lines.push(clean);
      else if (mode === 'blessing') blessingEffect.push(clean);
      continue;
    }

    if (/Floor 11.*Disorder/i.test(clean)) {
      mode = 'floor11';
      groupDepth = depth;
      awaitingBlessingHeader = false;
      continue;
    }
    if (/Floor 12.*Disorders?/i.test(clean)) {
      mode = 'floor12';
      groupDepth = depth;
      awaitingBlessingHeader = false;
      continue;
    }
    if (/Updated the monster lineup/i.test(clean)) {
      awaitingBlessingHeader = true;
      continue;
    }
    if (
      awaitingBlessingHeader &&
      !blessingName &&
      !/^(?:Starting from|The above)/i.test(clean)
    ) {
      const labelMatch = clean.match(
        /^(?:Blessing of the Abyssal Moon|Lunar Phases?)\s*:?\s*(.*)$/i,
      );
      blessingName = (labelMatch ? labelMatch[1] : clean).trim() || clean;
      mode = 'blessing';
      groupDepth = depth;
      awaitingBlessingHeader = false;
      continue;
    }
  }

  if (!dateRaw && !floor11Disorder.length && !floor12Lines.length && !blessingName) {
    return null;
  }

  return {
    startDateRaw: dateRaw,
    floor11Disorder,
    floor12Disorder: buildFloor12Periods(floor12Lines),
    blessingName,
    blessingEffect: blessingEffect.length ? blessingEffect.join(' ') : null,
  };
}

// ── Scraper principal ─────────────────────────────────────────────────────────

async function scrapeVersion(versionArg: string): Promise<VersionData> {
  console.log(`Fetching wikitext for version ${versionArg}...`);
  const wikitext = await fetchWikitext(versionArg);
  const tpl = parseTemplateFields(wikitext);

  // Les pages du cycle "Luna" portent |version = "Luna VIII" (libellé narratif)
  // et |number = "6.7" (le vrai numéro de patch) ; les pages numériques
  // classiques n'ont que |version = "5.0" et pas de |number du tout.
  const isCyclePage = Boolean(tpl.number);
  const number = isCyclePage ? tpl.number : tpl.version;
  const cycleLabel = isCyclePage ? tpl.version : null;

  // Récupère endDate depuis la prochaine version
  let endDate = '';
  if (tpl.next) {
    try {
      const nextWikitext = await fetchWikitext(tpl.next);
      const nextTpl = parseTemplateFields(nextWikitext);
      endDate = nextTpl.date;
      await sleep(500);
    } catch {
      console.warn(`⚠️  Could not fetch next version ${tpl.next} for endDate`);
    }
  }

  // La page de la version 1.0 (lancement du jeu) n'a pas de section "New
  // Content" : tout le contenu de base est listé sous "Released Content",
  // avec des libellés de sous-section eux aussi différents ("Playable
  // Characters" au lieu de "New Characters", etc.) — cf. les alias passés à
  // `sub` ci-dessous.
  const newContentSection =
    extractMainSection(wikitext, 'New Content') ||
    extractMainSection(wikitext, 'Released Content');
  // Essaie chaque libellé dans l'ordre et retourne le premier non-vide :
  // gère les renommages de sous-section au fil des versions.
  const sub = (...labels: string[]) => {
    for (const label of labels) {
      const result = extractSubsection(newContentSection, label);
      if (result.trim()) return result;
    }
    return '';
  };

  // Classification des monstres en boss / monstres normaux. Sur la 1.0,
  // "Monsters" et "Bosses" sont deux sous-sections distinctes plutôt qu'une
  // seule "New Monsters" imbriquée — la classification par page individuelle
  // (fetchEnemyType) place chaque nom au bon endroit indépendamment de sa
  // section d'origine, donc on peut simplement concaténer les deux.
  const allEnnemies = extractMonsterNames(sub('New Monsters', 'Monsters')).concat(
    extractMonsterNames(sub('Bosses')),
  );
  console.log(`Classifying ${allEnnemies.length} monsters...`);
  const newEnemies = await classifyEnnemies(allEnnemies);

  return {
    number,
    cycleLabel,
    name: tpl.title,
    subtitle: tpl.title2 || null,
    description: tpl.description,
    releaseDate: tpl.date,
    endDate,
    previousVersion: tpl.prev || null,
    nextVersion: tpl.next || null,
    links: tpl.links,
    images: tpl.images,

    newCharacters: parseCharacters(sub('New Characters', 'Playable Characters')),
    newOutfits: parseOutfits(sub('New Outfits')),
    newWeapons: mergeWeapons(
      // "New Equipment" : libellé utilisé sur les pages de version ~1.2-1.6,
      // "Weapons" sur la 1.0, remplacés par "New Weapons" ensuite.
      mergeWeapons(
        parseWeapons(sub('New Weapons', 'Weapons')),
        parseWeapons(sub('New Equipment')),
      ),
      parseWeapons(sub('New Forgeable Weapons')),
    ),
    banners: parseBanners(sub('Event Wishes'), tpl.date),

    mapExpansion: parseMapExpansion(sub('New Region', 'New Regions', 'New Areas', 'Regions')),
    newDomains: parseDomains(sub('New Domains', 'Domains')),
    newSystems: parseSimpleList(sub('New Systems')),
    newEnemies,
    newCreatures: parseSimpleList(sub('New Wildlife')),

    newArtifacts: parseSimpleList(sub('New Artifact Sets'))
      .concat(parseSimpleList(sub('New Artifacts')))
      .concat(parseSimpleList(sub('Artifacts'))),
    newMaterials: parseSimpleList(sub('New Materials')),
    newMonsterDrops: parseSimpleList(sub('New Monster Drops')),
    newTalentMaterials: parseSimpleList(sub('New Talent Level-Up Materials')),
    newWeaponAscensionMaterials: parseSimpleList(
      sub('New Weapon Ascension Materials'),
    ),

    newQuests: parseQuests(sub('New Quests', 'Quests')),
    events: parseSimpleList(sub('New Events', 'Events')).map((e) =>
      e.replace(/\s*\(Permanent\)\s*$/i, '').trim(),
    ),

    newRecipes: parseSimpleList(sub('New Recipes')),
    newFormulas: parseSimpleList(sub('New Formula')),
    newSpecialtyDishes: parseSimpleList(sub('New Character Specialty Dishes')),
    newAchievements: parseSimpleList(sub('New Achievements'))
      .map((a) => a.replace(/^Additions to\s*:?\s*/i, '').trim())
      // "* Additions to:" seul (2.7+) n'est qu'un label introduisant les
      // catégories en profondeur 2 qui suivent — sans contenu propre une
      // fois le préfixe retiré, à exclure plutôt qu'à garder comme catégorie
      // vide.
      .filter(Boolean)
      .map((category) => ({ category, achievements: [] })),
    newNamecards: parseSimpleList(sub('New Namecards')),
    newGadgets: parseSimpleList(sub('New Gadgets')),
    newFurnishings: parseSimpleList(sub('New Furnishings')),
    newFurnishingSets: parseSimpleList(sub('New Furnishing Sets')),
    newBooks: parseSimpleList(sub('New Books')),
    newTcgCards: parseTcgCards(sub('New Genius Invokation TCG Cards')),

    imaginariumTheater: parseImaginariumTheater(sub('Imaginarium Theater')),
    spiralAbyss: parseSpiralAbyssSeason(sub('Spiral Abyss')),
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

      await sleep(1500);
    } catch (err: any) {
      console.error(`❌ Failed to scrape version ${version}:`, err.message);
    }
  }
}

main();
