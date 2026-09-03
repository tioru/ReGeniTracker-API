// scripts/scrape-artifacts.ts
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
  fetchWikitext,
  fetchHtml,
} from './lib/wiki-fetch';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/artifacts/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Structure de sortie alignée sur prisma/data/artifacts/en/heart_of_depth.json
// (rédigé à la main puis validé) :
//   { name, obtaining: [{ rarity, sources: [{ <TYPE>: name }, ...] }, ...],
//     flowerOfLife, plumeOfDeath, sandsOfEon, gobletOfEonothem, circletOfLogos,
//     setBonuses: { "<N>pieces": "...", ..., effects: [...] }, releaseVersion }
//
// ── EN (wikitext brut) ───────────────────────────────────────────────────────
//
// La page d'un set ({{Artifact Set Infobox}}) donne TOUT ce dont on a besoin
// sans passer par du HTML rendu :
// - flower/plume/sands/goblet/circlet : titres de page en clair (pas des
//   wikiliens) des 5 pièces du set.
// - NpcBonus (1pcBonus/2pcBonus/3pcBonus/4pcBonus) : texte du bonus, parfois
//   vide (ex: Adventurer a un "1pcBonus" vide car il utilise 2pc/4pc comme la
//   plupart des sets modernes) — on ignore les valeurs vides.
// - sourceN.M : la source M (dans l'ordre d'affichage du wiki) pour obtenir le
//   set à la rareté N étoiles. Un set à 2 sources en 5★ (domaine + coffre
//   d'artéfacts) donne source5.1/source5.2 — c'est cette numérotation qui nous
//   donne directement le regroupement par rareté de "obtaining".
// - eff_attN : tags de catégorisation du bonus (repris tel quel dans
//   "setBonuses.effects", comme "effects" sur les armes, cf. scrape-weapons.ts).
// - {{Change History|X}} : version de sortie, identique aux autres scripts.
//
// Chaque page de PIÈCE ({{Artifact Infobox}}) donne le nom (titre de la page)
// et le lore complet dans la section "==Description==" (plusieurs paragraphes
// séparés par des <br>/lignes vides, à plat comme pour l'historique d'arme).
//
// ── Classification des sources ───────────────────────────────────────────────
//
// On ne peut pas deviner le "type" d'une source depuis son seul texte : un
// domaine (ex: "Peak of Vindagnyr") et un coffre ("Artifact Strongbox: Heart
// of Depth") sont tous deux de simples wikiliens. Trois cas se résolvent par
// simple préfixe sur le titre de page lié, fiable à 100% (nom de page
// standardisé du wiki) :
// - "Artifact Strongbox: " → STRONGBOX
// - "Domain Reliquary: "   → RELIQUARY (échange de fragments contre une pièce
//   choisie — mécanique proche du Strongbox mais désignée séparément par le
//   wiki, ex: "Domain Reliquary: Tier II")
// Trois libellés génériques (jamais déclinés en boss/monstres précis sur le
// wiki, contrairement à "Normal Boss(es)" qui l'est PARFOIS via "Dropped By",
// cf. plus bas) se résolvent par égalité exacte de titre :
// "Normal Boss(es)" (repli quand aucune liste "Dropped By" n'existe) →
// NORMAL_BOSS, "Weekly Boss(es)" → WEEKLY_BOSS, "Elite Enem(y|ies)" →
// ELITE_ENEMY.
// Pour le reste (DOMAIN vs SHOP vs OTHER), on vérifie l'appartenance de la
// page liée à Category:Domains / Category:Shops via une requête dédiée par
// lot — même pattern que filterOutQuestExclusiveWeapons dans
// scrape-weapons.ts. Tout ce qui ne matche rien de tout ça retombe sur
// "OTHER" (texte affiché conservé tel quel, y compris le suffixe hors-lien
// éventuel, ex: "Adventure Rank Rewards (7, 8, 9, 11)").
//
// Note : certains sets ont une pièce UNIQUE (pas le set entier) obtenable via
// une branche de dialogue d'un PNJ précis (ex: "Stevens" pour Blizzard
// Strayer, "Brother Qian" pour Gambler) — une récompense de quête ponctuelle,
// pas un achat en boutique. Ce cas reste volontairement en OTHER : le modèle
// "obtaining" actuel raisonne au niveau du SET, pas d'une pièce individuelle,
// donc le distinguer proprement demanderait de faire porter la source sur une
// pièce plutôt que sur le set — un changement de structure à valider avant de
// l'implémenter, pas une simple classification supplémentaire.
//
// ── FR ────────────────────────────────────────────────────────────────────
//
// La page FR d'un set ({{Infobox Artéfact}}) donne le nom traduit et le texte
// des bonus ("2 pieces"/"4 pieces", avec un espace — contrairement à l'EN),
// MAIS liste les sources dans un seul champ "source"/"source2"/... SANS le
// regroupement par rareté de l'EN (confirmé sur "Âme des profondeurs" : une
// seule liste de 2 sources pour les paliers 4★ et 5★ confondus, alors que l'EN
// distingue bien source4.1 vs source5.1/5.2). Reconstituer l'association
// source ↔ rareté depuis ce champ FR serait donc une supposition, pas une
// lecture fiable. On réutilise à la place la structure "obtaining" calculée
// côté EN (regroupement par rareté + type de source, un fait indépendant de la
// langue) et on traduit uniquement le NOM affiché de chaque source, en
// résolvant le langlink FR de sa page wiki (même principe que
// resolveFrMaterialNamesToEnglish dans scrape-weapons.ts, direction inversée
// EN→FR). Une source sans page wiki dédiée (texte libre attaché à un lien, ex:
// le "(7, 8, 9, 11)" d'un intitulé de récompense de rang d'aventure) reste en
// anglais pour cette portion : aucune traduction fiable n'existe pour ce genre
// de fragment.
//
// Chaque pièce FR est retrouvée via le langlink FR de sa page EN (pas en
// reparsant l'infobox du set FR, qui donnerait un ordre à recaler à la main) :
// son nom est le titre de page FR, son lore vient de la section "==Histoire=="
// (équivalent FR de "==Description=="), comme observé sur "Broche plaquée".
//
// "setBonuses.effects" n'a pas d'équivalent dans l'infobox FR (ce sont des
// tags internes au wiki EN, pas du texte affiché) : réutilisé tel quel côté
// FR, comme "effects" est déjà réutilisé tel quel côté armes.
//
// ── Cas particulier : boss précis derrière "Normal Boss(es)" ───────────────
//
// Sur 8 des 57 sets (ex: Adventurer, Gladiator's Finale, Traveling Doctor...),
// l'infobox se contente d'un lien générique "[[Normal Boss]]es"/
// "[[Normal Bosses]]" alors que la page liste, dans une section dédiée
// "==Dropped By==", les boss précis qui droppent CE set (ex: 15 boss nommés
// pour Adventurer). Cette liste n'existe QUE dans le rendu HTML : elle est
// produite par un module Lua ({{Dropped By}}, sans paramètre en wikitext),
// pas accessible en lisant le wikitext brut — contrairement à tout le reste
// de ce script. On ne fetch ce HTML que pour les sets où
// "==Dropped By==" est détecté dans le wikitext (8/57), afin de ne pas
// alourdir le run pour rien sur les 49 autres sets.
//
// La liste de boss n'est PAS déclinée par rareté (un même monde-boss drop
// aussi bien la version 2★ que 3★ de "Adventurer", par exemple) : on
// remplace donc l'entrée générique "Normal Boss(es)" par TOUTE la liste de
// boss, à CHAQUE palier de rareté où elle apparaît dans l'infobox (repris tel
// quel, sans dédoublonnage arbitraire par palier).
// ─────────────────────────────────────────────────────────────────────────────

type ArtifactSourceType =
  | 'DOMAIN'
  | 'STRONGBOX'
  | 'RELIQUARY'
  | 'SHOP'
  | 'BOSS'
  | 'NORMAL_BOSS'
  | 'WEEKLY_BOSS'
  | 'ELITE_ENEMY'
  | 'OTHER';

interface ArtifactPieceData {
  name: string;
  description: string;
}

interface ArtifactObtainingTierData {
  rarity: number;
  sources: Record<string, string>[]; // ex: [{ DOMAIN: "Peak of Vindagnyr" }]
}

interface ArtifactSetOutput {
  name: string;
  obtaining: ArtifactObtainingTierData[];
  flowerOfLife: ArtifactPieceData;
  plumeOfDeath: ArtifactPieceData;
  sandsOfEon: ArtifactPieceData;
  gobletOfEonothem: ArtifactPieceData;
  circletOfLogos: ArtifactPieceData;
  setBonuses: Record<string, string | string[]>;
  releaseVersion: string;
}

interface CachedArtifactSet {
  pageTitle: string;
  releaseVersion: string;
  en: ArtifactSetOutput;
  fr: ArtifactSetOutput | null;
}

// ── Wikitext helpers (repris des autres scripts scrape-*) ───────────────────

function extractBracedBlock(content: string, startMarker: string): string | null {
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

// Les champs [\w -] "classiques" ne suffisent pas ici : les clés
// sourceN.M (ex: "source4.1", "source5.2") contiennent un point, absent des
// infobox d'armes/domaines d'où cette regex est reprise.
function parseInfoboxFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([\w. -]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Variante utilisée pour l'infobox FR : les noms de champs peuvent contenir
// des accents (ex: "diadème"), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

// Comme cleanWikitext des autres scripts, avec en plus le déballage de
// {{Color|X}}/{{Color2|X}} (utilisé dans les bonus 2pc/4pc pour styliser un
// nom de dégât élémentaire, ex: "{{Color|[[Hydro DMG Bonus]]}} +15%") : sans
// cette règle, le strip générique de {{...}} supprimerait tout le texte
// coloré au lieu de ne retirer que le wrapper.
function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\{\{Color2?\|([^{}]*)\}\}/gi, '$1')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/&shy;/gi, '')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSection(content: string, heading: string): string | null {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const marker = `==${heading}==`;
  const start = withoutComments.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const rest = withoutComments.slice(from);
  const nextMatch = rest.match(/\n==[^=]/);
  const end = nextMatch ? from + (nextMatch.index ?? rest.length) : withoutComments.length;
  return withoutComments.slice(from, end).trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractWikiLinkTarget(raw: string): string | null {
  const m = raw.match(/\[\[([^\]|]+)/);
  return m ? m[1].trim() : null;
}

// ── EN: infobox du set ({{Artifact Set Infobox}}) ───────────────────────────

interface RawSourceEntry {
  rarity: number;
  order: number;
  raw: string; // valeur brute du champ sourceN.M (avec wikilien éventuel)
  linkTitle: string | null;
  // Forcé pour les entrées "boss" issues de l'expansion de "Dropped By" (cf.
  // NOTE en tête de fichier) : ces pages n'ont aucune raison d'appartenir à
  // Category:Domains, donc classifySourceType ne les détecterait pas.
  forcedType?: ArtifactSourceType;
}

const PIECE_SLOT_KEYS: Record<'flower' | 'plume' | 'sands' | 'goblet' | 'circlet', keyof Pick<ArtifactSetOutput, 'flowerOfLife' | 'plumeOfDeath' | 'sandsOfEon' | 'gobletOfEonothem' | 'circletOfLogos'>> = {
  flower: 'flowerOfLife',
  plume: 'plumeOfDeath',
  sands: 'sandsOfEon',
  goblet: 'gobletOfEonothem',
  circlet: 'circletOfLogos',
};

interface RawArtifactSetEn {
  pageTitle: string;
  pieceTitles: Record<keyof typeof PIECE_SLOT_KEYS, string>;
  bonusesRaw: Record<string, string>; // "1"|"2"|"3"|"4" -> texte nettoyé
  effects: string[];
  sources: RawSourceEntry[];
  hasDroppedBySection: boolean;
  releaseVersion: string;
  frTitle: string | null;
}

function parseArtifactSetPageEn(
  pageTitle: string,
  content: string,
  frTitle: string | null,
): RawArtifactSetEn | null {
  const infoboxMatch = /\{\{Artifact Set Infobox/i.exec(content);
  if (!infoboxMatch) return null;

  const block = extractBracedBlock(content, infoboxMatch[0]);
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const pieceTitles: Record<string, string> = {};
  for (const slot of Object.keys(PIECE_SLOT_KEYS) as (keyof typeof PIECE_SLOT_KEYS)[]) {
    const value = cleanWikitext(fields[slot] ?? '');
    if (!value) return null; // set incomplet côté wiki (rare, cas encore en travaux) : ignoré
    pieceTitles[slot] = value;
  }

  const bonusesRaw: Record<string, string> = {};
  for (let n = 1; n <= 4; n++) {
    const value = cleanWikitext(fields[`${n}pcBonus`] ?? '');
    if (value) bonusesRaw[String(n)] = value;
  }

  const effects: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`eff_att${i}`];
    if (!value) break;
    effects.push(cleanWikitext(value));
  }

  const sources: RawSourceEntry[] = [];
  for (const key of Object.keys(fields)) {
    const m = key.match(/^source(\d+)\.(\d+)$/);
    if (!m) continue;
    const raw = fields[key];
    sources.push({
      rarity: parseInt(m[1], 10),
      order: parseInt(m[2], 10),
      raw,
      linkTitle: extractWikiLinkTarget(raw),
    });
  }
  sources.sort((a, b) => a.rarity - b.rarity || a.order - b.order);

  const versionMatch = /\{\{Change History\|([^}|]+)/.exec(content);

  return {
    pageTitle,
    pieceTitles: pieceTitles as Record<keyof typeof PIECE_SLOT_KEYS, string>,
    bonusesRaw,
    effects,
    sources,
    hasDroppedBySection: /==Dropped By==/.test(content),
    releaseVersion: versionMatch ? versionMatch[1].trim() : '',
    frTitle,
  };
}

// ── Boss précis derrière "Normal Boss(es)" (section "Dropped By", HTML) ────

const NORMAL_BOSS_LINK_TITLES = new Set(['Normal Boss', 'Normal Bosses']);

// Repris de extractSectionHtml (scrape-weapons.ts/scrape-enemies.ts), simplifié
// : "Dropped By" est toujours la 1ère section de la page (jamais de h3
// imbriqué à gérer ici, contrairement aux pages d'arme).
function extractSectionHtmlById(html: string, id: string): string | null {
  const idx = html.indexOf(`id="${id}"`);
  if (idx === -1) return null;
  const nextH2 = html.indexOf('<h2', idx);
  return html.slice(idx, nextH2 === -1 ? html.length : nextH2);
}

async function fetchDroppedByBosses(pageTitle: string): Promise<{ name: string; linkTitle: string }[]> {
  const html = await fetchHtml(pageTitle);
  const section = extractSectionHtmlById(html, 'Dropped_By');
  if (!section) return [];

  const $ = cheerio.load(section);
  const bosses: { name: string; linkTitle: string }[] = [];
  $('.card-container').each((_, el) => {
    const link = $(el).find('.card-caption a[title]').first();
    const linkTitle = link.attr('title')?.trim();
    const name = link.text().trim() || linkTitle;
    if (linkTitle && name) bosses.push({ name, linkTitle });
  });
  return bosses;
}

// Remplace CHAQUE entrée "Normal Boss(es)" générique (à tout palier de
// rareté où elle apparaît) par la liste complète des boss précis — cf. NOTE
// en tête de fichier sur le fait que cette liste ne se décline pas par
// rareté.
function expandNormalBossSources(
  sources: RawSourceEntry[],
  bosses: { name: string; linkTitle: string }[],
): RawSourceEntry[] {
  const result: RawSourceEntry[] = [];
  let nextOrder = Math.max(0, ...sources.map((s) => s.order)) + 1;

  for (const source of sources) {
    if (!source.linkTitle || !NORMAL_BOSS_LINK_TITLES.has(source.linkTitle)) {
      result.push(source);
      continue;
    }
    for (const boss of bosses) {
      result.push({
        rarity: source.rarity,
        order: nextOrder++,
        raw: `[[${boss.linkTitle}]]`,
        linkTitle: boss.linkTitle,
        forcedType: 'BOSS',
      });
    }
  }
  return result;
}

// ── Classification des sources ──────────────────────────────────────────────

const STRONGBOX_PREFIX = 'Artifact Strongbox:';
const RELIQUARY_PREFIX = 'Domain Reliquary:';

// Libellés génériques (jamais déclinés par boss/monstre précis sur le wiki,
// contrairement à "Normal Boss(es)" qui l'est PARFOIS via "Dropped By" — cf.
// expandNormalBossSources) : distingués de OTHER pour permettre un filtrage
// futur, même sans liste détaillée derrière.
const WEEKLY_BOSS_LINK_TITLES = new Set(['Weekly Boss', 'Weekly Bosses']);
const ELITE_ENEMY_LINK_TITLES = new Set(['Elite Enemy', 'Elite Enemies']);

interface SourceCategoryMembership {
  isDomain: boolean;
  isShop: boolean;
}

// Une seule requête (par lot) pour vérifier à la fois Category:Domains et
// Category:Shops : clcategories accepte une liste "|"-séparée, MediaWiki ne
// renvoie que les catégories demandées qui matchent réellement pour chaque
// page.
async function resolveSourceCategoryMembership(
  linkTitles: string[],
): Promise<Map<string, SourceCategoryMembership>> {
  const unique = [...new Set(linkTitles)];
  const result = new Map<string, SourceCategoryMembership>();
  const chunkSize = 50;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: chunk.join('|'),
          prop: 'categories',
          clcategories: 'Category:Domains|Category:Shops',
          cllimit: 'max',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const pages = response.data?.query?.pages ?? [];
      for (const page of pages) {
        const categories: string[] = (page.categories ?? []).map((c: { title: string }) => c.title);
        result.set(page.title, {
          isDomain: categories.includes('Category:Domains'),
          isShop: categories.includes('Category:Shops'),
        });
      }
    } catch (err) {
      console.warn(`⚠️  Échec de la vérification des catégories pour un lot de sources: ${err}`);
    }
    await sleep(300);
  }
  return result;
}

function classifySourceType(
  linkTitle: string | null,
  categoryMembership: Map<string, SourceCategoryMembership>,
): ArtifactSourceType {
  if (!linkTitle) return 'OTHER';
  if (linkTitle.startsWith(STRONGBOX_PREFIX)) return 'STRONGBOX';
  if (linkTitle.startsWith(RELIQUARY_PREFIX)) return 'RELIQUARY';
  if (NORMAL_BOSS_LINK_TITLES.has(linkTitle)) return 'NORMAL_BOSS'; // pas de liste "Dropped By" exploitable pour ce set
  if (WEEKLY_BOSS_LINK_TITLES.has(linkTitle)) return 'WEEKLY_BOSS';
  if (ELITE_ENEMY_LINK_TITLES.has(linkTitle)) return 'ELITE_ENEMY';
  const membership = categoryMembership.get(linkTitle);
  if (membership?.isDomain) return 'DOMAIN';
  if (membership?.isShop) return 'SHOP';
  return 'OTHER';
}

// ── FR: traduction du nom affiché des sources via langlinks ─────────────────
//
// On ne traduit que la partie "wikilien" de la source (cf. NOTE en tête de
// fichier) : un éventuel suffixe hors-lien (ex: " (Shop)") est recopié tel
// quel après traduction du lien.
async function resolveSourceNamesToFrench(
  entries: { linkTitle: string; displayName: string }[],
): Promise<Map<string, string>> {
  const uniqueLinkTitles = [...new Set(entries.map((e) => e.linkTitle))];
  const linkTranslations = new Map<string, string>();
  const chunkSize = 50;

  for (let i = 0; i < uniqueLinkTitles.length; i += chunkSize) {
    const chunk = uniqueLinkTitles.slice(i, i + chunkSize);
    try {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: chunk.join('|'),
          prop: 'langlinks',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const pages = response.data?.query?.pages ?? [];
      for (const page of pages) {
        const frTitle = page.langlinks?.[0]?.title;
        if (frTitle) linkTranslations.set(page.title, frTitle);
      }
    } catch (err) {
      console.warn(`⚠️  Échec de la résolution FR d'un lot de sources: ${err}`);
    }
    await sleep(300);
  }

  const displayTranslations = new Map<string, string>();
  for (const { linkTitle, displayName } of entries) {
    const frLink = linkTranslations.get(linkTitle);
    if (!frLink) {
      // Pas de page FR dédiée (ex: coffres d'artéfacts, souvent non traduits) :
      // on retombe sur le texte EN plutôt que de deviner une traduction.
      displayTranslations.set(displayName, displayName);
      continue;
    }
    const suffix = displayName.startsWith(linkTitle) ? displayName.slice(linkTitle.length) : '';
    displayTranslations.set(displayName, `${frLink}${suffix}`);
  }
  return displayTranslations;
}

// ── Pièces ────────────────────────────────────────────────────────────────────

interface PieceBundleEntry {
  content: string;
  frTitle: string | null;
}

// Une seule requête combinée pour les 5 pièces d'un set (contenu + langlink
// FR), comme fetchRawWeaponPages combine prop=revisions|langlinks.
async function fetchPiecesBundle(pieceTitles: string[]): Promise<Map<string, PieceBundleEntry>> {
  const result = new Map<string, PieceBundleEntry>();
  try {
    const response = await withRetry(`fetch pièces "${pieceTitles.join(', ')}"`, async () =>
      axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pieceTitles.join('|'),
          prop: 'revisions|langlinks',
          rvprop: 'content',
          rvslots: 'main',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      }),
    );
    const pages = response.data?.query?.pages ?? [];
    for (const page of pages) {
      if (page.missing) continue;
      const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
      result.set(page.title, {
        content,
        frTitle: page.langlinks?.[0]?.title ?? null,
      });
    }
  } catch (err) {
    console.warn(`⚠️  Échec du fetch des pièces "${pieceTitles.join(', ')}": ${err}`);
  }
  return result;
}

function parsePieceEn(content: string): { description: string } {
  return { description: cleanWikitext(extractSection(content, 'Description') ?? '') };
}

function parsePieceFr(content: string): { description: string } {
  return { description: cleanWikitext(extractSection(content, 'Histoire') ?? '') };
}

// ── Construction des sorties (EN / FR) ──────────────────────────────────────

function buildObtainingOutput(
  sources: RawSourceEntry[],
  categoryMembership: Map<string, SourceCategoryMembership>,
  frNameByDisplay?: Map<string, string>,
): ArtifactObtainingTierData[] {
  const byRarity = new Map<number, RawSourceEntry[]>();
  for (const source of sources) {
    const list = byRarity.get(source.rarity) ?? [];
    list.push(source);
    byRarity.set(source.rarity, list);
  }

  return [...byRarity.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rarity, entries]) => ({
      rarity,
      sources: entries.map((entry) => {
        const type = entry.forcedType ?? classifySourceType(entry.linkTitle, categoryMembership);
        const displayName = cleanWikitext(entry.raw);
        const name = frNameByDisplay ? (frNameByDisplay.get(displayName) ?? displayName) : displayName;
        return { [type]: name };
      }),
    }));
}

function buildSetBonusesOutput(bonusesRaw: Record<string, string>, effects: string[]): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [n, text] of Object.entries(bonusesRaw)) {
    output[`${n}pieces`] = text;
  }
  output.effects = effects;
  return output;
}

// ── Pipeline: liste des sets (EN) ────────────────────────────────────────────

async function fetchRawArtifactSetPages(continueParams?: Record<string, string>): Promise<{
  pages: any[];
  nextContinueParams?: Record<string, string>;
}> {
  const params: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: 'Category:Artifact Sets',
    gcmtype: 'page',
    gcmlimit: '50',
    prop: 'revisions|langlinks',
    rvprop: 'content',
    rvslots: 'main',
    lllang: 'fr',
    format: 'json',
    formatversion: '2',
    ...continueParams,
  };

  const response = await axios.get(EN_API_URL, { params, headers: HTTP_HEADERS, httpsAgent });
  return {
    pages: response.data?.query?.pages ?? [],
    nextContinueParams: response.data?.continue,
  };
}

async function fetchAllArtifactSetPages(): Promise<RawArtifactSetEn[]> {
  const byPageTitle = new Map<string, RawArtifactSetEn>();
  let continueParams: Record<string, string> | undefined;
  let round = 1;

  do {
    console.log(`Fetching artifact set list batch ${round}...`);
    const { pages, nextContinueParams } = await fetchRawArtifactSetPages(continueParams);

    for (const page of pages) {
      const frTitle: string | null = page.langlinks?.[0]?.title ?? null;
      const existing = byPageTitle.get(page.title);
      if (existing) {
        if (frTitle) existing.frTitle = frTitle;
        continue;
      }

      const content: string = page?.revisions?.[0]?.slots?.main?.content ?? '';
      const parsed = parseArtifactSetPageEn(page.title, content, frTitle);
      if (parsed) byPageTitle.set(page.title, parsed);
    }

    continueParams = nextContinueParams;
    round++;
    await sleep(500);
  } while (continueParams);

  return Array.from(byPageTitle.values());
}

// Repli identique à scrape-domains.ts : si le langlink groupé n'a rien donné,
// on retente en dédié avant d'abandonner sur le nom EN.
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
      return page?.langlinks?.[0]?.title ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch langlink FR pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

// ── Enrichissement d'un set ──────────────────────────────────────────────────

async function enrichArtifactSet(raw: RawArtifactSetEn): Promise<CachedArtifactSet> {
  const pieceTitleList = Object.values(raw.pieceTitles);
  const piecesBundle = await fetchPiecesBundle(pieceTitleList);

  // categoryMembership est calculé sur les sources BRUTES (avant expansion
  // "Dropped By") : les pages de boss n'ont aucune raison d'appartenir à
  // Category:Domains/Category:Shops, pas la peine de les inclure ici.
  const linkTitles = raw.sources.map((s) => s.linkTitle).filter((t): t is string => !!t);
  const categoryMembership = await resolveSourceCategoryMembership(linkTitles);

  let sources = raw.sources;
  if (raw.hasDroppedBySection) {
    const bosses = await fetchDroppedByBosses(raw.pageTitle);
    if (bosses.length) {
      sources = expandNormalBossSources(raw.sources, bosses);
    } else {
      console.warn(`⚠️  "${raw.pageTitle}": section "Dropped By" détectée mais aucun boss extrait du HTML rendu.`);
    }
  }

  const enPieces: Record<string, ArtifactPieceData> = {};
  for (const slot of Object.keys(PIECE_SLOT_KEYS) as (keyof typeof PIECE_SLOT_KEYS)[]) {
    const title = raw.pieceTitles[slot];
    const bundle = piecesBundle.get(title);
    enPieces[PIECE_SLOT_KEYS[slot]] = {
      name: title,
      description: bundle ? parsePieceEn(bundle.content).description : '',
    };
    if (!bundle) {
      console.warn(`⚠️  "${raw.pageTitle}": pièce "${title}" introuvable sur le wiki EN.`);
    }
  }

  const en: ArtifactSetOutput = {
    name: raw.pageTitle,
    obtaining: buildObtainingOutput(sources, categoryMembership),
    ...(enPieces as {
      flowerOfLife: ArtifactPieceData;
      plumeOfDeath: ArtifactPieceData;
      sandsOfEon: ArtifactPieceData;
      gobletOfEonothem: ArtifactPieceData;
      circletOfLogos: ArtifactPieceData;
    }),
    setBonuses: buildSetBonusesOutput(raw.bonusesRaw, raw.effects),
    releaseVersion: raw.releaseVersion,
  };

  // ── FR ──────────────────────────────────────────────────────────────────
  let frTitle = raw.frTitle;
  if (!frTitle) frTitle = await fetchFrTitleDirect(raw.pageTitle);

  let fr: ArtifactSetOutput | null = null;
  if (frTitle) {
    const frContent = await fetchWikitext(frTitle, FR_API_URL);
    const frInfoboxBlock = frContent ? extractBracedBlock(frContent, '{{Infobox Artéfact') : null;
    const frFields = frInfoboxBlock ? parseInfoboxFieldsAccented(frInfoboxBlock) : {};

    const frBonusesRaw: Record<string, string> = {};
    for (let n = 1; n <= 4; n++) {
      const value = cleanWikitext(frFields[`${n} pieces`] ?? '');
      if (value) frBonusesRaw[String(n)] = value;
    }

    const sourceEntriesForTranslation = sources
      .filter((s): s is RawSourceEntry & { linkTitle: string } => !!s.linkTitle)
      .map((s) => ({ linkTitle: s.linkTitle, displayName: cleanWikitext(s.raw) }));
    const frNameByDisplay = await resolveSourceNamesToFrench(sourceEntriesForTranslation);

    const frPieces: Record<string, ArtifactPieceData> = {};
    for (const slot of Object.keys(PIECE_SLOT_KEYS) as (keyof typeof PIECE_SLOT_KEYS)[]) {
      const enTitle = raw.pieceTitles[slot];
      const bundle = piecesBundle.get(enTitle);
      const key = PIECE_SLOT_KEYS[slot];

      if (bundle?.frTitle) {
        const frPieceContent = await fetchWikitext(bundle.frTitle, FR_API_URL);
        frPieces[key] = {
          name: bundle.frTitle,
          description: frPieceContent ? parsePieceFr(frPieceContent).description : enPieces[key].description,
        };
      } else {
        // Pas de page FR dédiée pour cette pièce : on réutilise le nom/lore EN,
        // comme scrape-weapons.ts le fait pour les vendeurs sans équivalent FR.
        frPieces[key] = { ...enPieces[key] };
      }
      await sleep(200);
    }

    fr = {
      name: frTitle,
      obtaining: buildObtainingOutput(sources, categoryMembership, frNameByDisplay),
      ...(frPieces as {
        flowerOfLife: ArtifactPieceData;
        plumeOfDeath: ArtifactPieceData;
        sandsOfEon: ArtifactPieceData;
        gobletOfEonothem: ArtifactPieceData;
        circletOfLogos: ArtifactPieceData;
      }),
      // "effects" n'existe pas côté FR (cf. NOTE en tête de fichier) : repris
      // tel quel depuis l'EN.
      setBonuses: buildSetBonusesOutput(
        Object.keys(frBonusesRaw).length ? frBonusesRaw : raw.bonusesRaw,
        raw.effects,
      ),
      releaseVersion: raw.releaseVersion,
    };
  } else {
    console.warn(`⚠️  "${raw.pageTitle}": aucune page FR trouvée, fichier fr/ non écrit.`);
  }

  return { pageTitle: raw.pageTitle, releaseVersion: raw.releaseVersion, en, fr };
}

async function fetchAndEnrichAll(): Promise<CachedArtifactSet[]> {
  console.log('Fetching all artifact sets from wiki (this will take a while)...');
  const rawSets = await fetchAllArtifactSetPages();
  const enriched: CachedArtifactSet[] = [];

  for (let i = 0; i < rawSets.length; i++) {
    const set = rawSets[i];
    console.log(`Enriching "${set.pageTitle}" (${i + 1}/${rawSets.length})...`);
    try {
      enriched.push(await enrichArtifactSet(set));
    } catch (err) {
      console.warn(`⚠️  Échec de l'enrichissement de "${set.pageTitle}": ${err}`);
    }
    await sleep(300);
  }

  return enriched;
}

// ── Output ────────────────────────────────────────────────────────────────────

function writeArtifactFiles(sets: CachedArtifactSet[], versionFilter?: string[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  const filtered = versionFilter?.length
    ? sets.filter((s) => versionFilter.includes(s.releaseVersion))
    : sets;

  let written = 0;
  let skippedFr = 0;
  for (const set of filtered) {
    const filename = `${slugify(set.en.name)}.json`;

    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(set.en, null, 2), 'utf-8');

    if (set.fr) {
      fs.writeFileSync(path.join(frDir, filename), JSON.stringify(set.fr, null, 2), 'utf-8');
    } else {
      skippedFr++;
    }

    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} set(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} artifact set files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Utilitaire de debug : enrichit un seul set (sans parcourir toute la
// catégorie) et affiche le résultat sur stdout, sans écrire de fichier.
async function runSingle(pageTitle: string) {
  const content = await fetchWikitext(pageTitle);
  if (!content) {
    console.error(`❌ Page EN introuvable : "${pageTitle}"`);
    process.exit(1);
  }
  const frTitle = await fetchFrTitleDirect(pageTitle);
  const raw = parseArtifactSetPageEn(pageTitle, content!, frTitle);
  if (!raw) {
    console.error(`❌ "${pageTitle}" ne contient pas d'{{Artifact Set Infobox}} exploitable.`);
    process.exit(1);
  }
  const enriched = await enrichArtifactSet(raw);
  console.log(JSON.stringify({ en: enriched.en, fr: enriched.fr }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--single') {
    if (!args[1]) {
      console.error('Usage: ... scrape-artifacts.ts --single "Heart of Depth"');
      process.exit(1);
    }
    await runSingle(args[1]);
    return;
  }

  if (args.length === 0 || args[0] !== '--fetch') {
    console.error('Usage:');
    console.error('  Fetch + générer tout    : npx ts-node ... scrape-artifacts.ts --fetch');
    console.error('  Filtrer par version(s)   : ... --fetch "1.2" "2.0"');
    console.error('  Tester un seul set       : ... scrape-artifacts.ts --single "Heart of Depth"');
    process.exit(1);
  }

  const versionFilter = args.slice(1);
  const sets = await fetchAndEnrichAll();

  writeArtifactFiles(sets, versionFilter.length ? versionFilter : undefined);
}

main();
