// scripts/scrape-food.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN_API_URL = 'https://genshin-impact.fandom.com/api.php';
const FR_API_URL = 'https://genshin-impact.fandom.com/fr/api.php';

const OUTPUT_DIR = (lang: 'en' | 'fr') => path.resolve(__dirname, `../prisma/data/food/${lang}`);
const CACHE_PATH = path.resolve(__dirname, './cache/food-raw-cache.json');

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// Category:Food (EN) / Catégorie:Nourriture (FR) mélange 3 sortes de pages
// sous un même {{Food Infobox}} : des plats cuisinables à qualité variable
// (Suspicious/Normal/Delicious), des potions/huiles essentielles à qualité
// fixe (craftées via Alchimie, jamais "cuisinées"), et des ingrédients bruts
// consommables tels quels (ex: Apple, Sunsettia — qualité fixe également).
// Elle contient aussi 3 pages de présentation ("Food", "Potion", "Special
// Dish") qui utilisent {{Terminology Infobox}}, pas {{Food Infobox}} : elles
// sont naturellement exclues (parseFoodInfoboxEn retourne null).
//
// ── Qualité Suspicious/Normal/Delicious ──────────────────────────────────
// Contrairement aux matériaux, la quasi-totalité des champs utiles est dans
// le wikitext brut, PAS dans le HTML rendu (contrairement à
// scrape-materials.ts) — seul `sellers` (Shop Availability) nécessite le
// rendu, exactement comme pour les matériaux.
//
// Le champ `description` de l'infobox n'est PAS la description complète :
// c'est un FRAGMENT de début de phrase, complété par `desc_basic` (qualité
// Normal), `desc_delicious` ou `desc_suspicious` selon l'onglet. Vérifié en
// comparant le wikitext d'Almond Tofu au HTML rendu (action=parse) : le tab
// "Normal" affiche exactement `${description} ${desc_basic}`. Un plat sans
// paliers de qualité (potion, ingrédient brut) n'a que `description`, qui
// est alors la phrase complète à elle seule (desc_basic/suspicious/delicious
// absents).
//
// Le champ `effect` contient des placeholders `(var1)`, `(var2)`, ... (au
// plus 2 observés, ex: Golden Crab "DEF +(var1) et soins +(var2)%") dont les
// valeurs par palier sont dans des triplets `eff_suspicious{n}` /
// `eff_basic{n}` / `eff_delicious{n}`. Sur un objet sans palier, le nombre
// est déjà écrit en dur dans `effect` (ex: Apple "Restores '''300''' HP.") et
// aucun triplet n'existe : le texte est alors identique pour les 3 qualités.
//
// ── Special Dish ─────────────────────────────────────────────────────────
// Le plat "de base" référence sa variante spéciale de 2 façons redondantes :
// le champ infobox `variant` (nom seul) et le template `{{Special Dish|
// Personnage|Nom}}` dans le corps de page (nom + personnage). On utilise ce
// 2e format (specialDish) car il porte l'info complète en une seule page,
// sans dépendre du scraping d'une autre page. La page de la variante
// elle-même porte `character`/`base` dans son propre infobox.
//
// ── Ingrédients de recette ───────────────────────────────────────────────
// `{{Recipe|type=Cooking|Milk=3|Sugar=1|Almond=1|sort=...}}` (plats, section
// ==Recipe==) ou `{{Recipe|type=Crafting|...}}` (potions, section
// ==Alchemy==) : même template, cherché dans tout le wikitext plutôt que
// localisé par heading, pour couvrir les deux cas identiquement (repris du
// principe de scrape-materials.ts pour {{Recipe}}).
//
// ── Noms de fichiers ──────────────────────────────────────────────────────
// Contrairement aux matériaux/créatures, plusieurs pages de la catégorie
// partagent le même NOM AFFICHÉ que leur plat "de base" tout en étant des
// pages distinctes : récompenses de quête/évènement exclusives (ex: "Apple
// Cider (Mika: Deliver By Hand)" a pour champ `name` = "Apple Cider", comme
// la page "Apple Cider" elle-même). Utiliser slugify(name) comme les autres
// scripts provoquerait donc une collision de fichier silencieuse. Le nom de
// fichier est donc dérivé du TITRE DE PAGE (pageTitle), toujours unique sur
// le wiki, jamais du nom affiché.
//
// ── FR ────────────────────────────────────────────────────────────────────
// Le wiki FR utilise {{Infobox objet}} (même template générique que les
// matériaux/poissons, cf. scrape-materials.ts / scrape-creatures.ts), avec
// des champs dédiés par qualité (`description`/`effet`, `suspect`/
// `effet_suspect`, `délicieux`/`effet_délicieux`) déjà écrits en texte
// complet (pas de fragment à recombiner, pas de placeholders `(varN)` à
// résoudre — le texte final est directement dans le wikitext FR). En
// revanche, `effectVariables` (valeurs numériques par variable d'effet),
// `ingredients`, `sources` et `sellers` n'ont pas d'équivalent structuré
// fiable côté FR : réutilisés tels quels depuis l'EN, comme le fait déjà
// scrape-materials.ts pour ses propres champs non traduisibles.
// ─────────────────────────────────────────────────────────────────────────────

type RestockType = 'NEVER' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'THREE_DAYS';

interface RecipeIngredient {
  item: string;
  quantity: number;
}

interface FoodQualityValues {
  suspicious: number | null;
  normal: number | null;
  delicious: number | null;
}

interface FoodEffectVariable {
  label: string;
  values: FoodQualityValues;
}

interface FoodTieredText {
  suspicious: string | null;
  normal: string;
  delicious: string | null;
}

interface FoodSpecialDish {
  character: string;
  name: string;
}

interface FoodSellerData {
  name: string;
  currency: string;
  cost: number;
  stock: number;
  restock: RestockType;
}

interface FoodOutput {
  // Titre de la page wiki (EN) : sert de clé technique stable côté DB, car
  // plusieurs récompenses de quête/évènement réutilisent le nom affiché de
  // leur plat "de base" (ex: "Apple Cider" vs "Apple Cider (Mika: Deliver By
  // Hand)", toutes deux `name: "Apple Cider"`) — cf. NOTE en tête de fichier.
  pageTitle: string;
  name: string;
  rarity: number;
  category: string;
  effectType: string;
  descriptions: FoodTieredText;
  effectTexts: FoodTieredText;
  effectVariables: FoodEffectVariable[];
  region: string | null;
  recipeHint: string | null;
  recipeSubtype: 'COOKING' | 'CRAFTING' | null;
  ingredients: RecipeIngredient[];
  sources: string[];
  sellers: FoodSellerData[];
  specialDish: FoodSpecialDish | null;
  character: string | null;
  baseDish: string | null;
}

interface CachedFood {
  pageTitle: string;
  en: FoodOutput;
  fr: FoodOutput | null;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ReGeniTracker/1.0)' };
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
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

async function fetchWikitextWithLanglink(
  pageTitle: string,
): Promise<{ content: string | null; frTitle: string | null }> {
  try {
    return await withRetry(`fetch wikitext+langlink EN "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'revisions|langlinks',
          rvprop: 'content',
          rvslots: 'main',
          lllang: 'fr',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return { content: null, frTitle: null };
      return {
        content: page.revisions?.[0]?.slots?.main?.content ?? null,
        frTitle: page.langlinks?.[0]?.title ?? null,
      };
    });
  } catch (err) {
    console.warn(
      `⚠️  Échec du fetch wikitext+langlink EN pour "${pageTitle}" après plusieurs tentatives: ${err}`,
    );
    return { content: null, frTitle: null };
  }
}

async function fetchWikitext(apiUrl: string, pageTitle: string): Promise<string | null> {
  try {
    return await withRetry(`fetch wikitext "${pageTitle}"`, async () => {
      const response = await axios.get(apiUrl, {
        params: {
          action: 'query',
          titles: pageTitle,
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      const page = response.data?.query?.pages?.[0];
      if (!page || page.missing) return null;
      return page.revisions?.[0]?.slots?.main?.content ?? null;
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch wikitext pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return null;
  }
}

async function fetchHtml(pageTitle: string): Promise<string> {
  try {
    return await withRetry(`fetch HTML "${pageTitle}"`, async () => {
      const response = await axios.get(EN_API_URL, {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          format: 'json',
          formatversion: '2',
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      });
      return response.data?.parse?.text ?? '';
    });
  } catch (err) {
    console.warn(`⚠️  Échec du fetch HTML pour "${pageTitle}" après plusieurs tentatives: ${err}`);
    return '';
  }
}

async function fetchCategoryMembers(category: string): Promise<string[]> {
  const titles: string[] = [];
  let continueParams: Record<string, string> | undefined;

  do {
    const response = await withRetry(`fetch category "${category}"`, () =>
      axios.get(EN_API_URL, {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${category}`,
          cmlimit: '500',
          format: 'json',
          formatversion: '2',
          ...continueParams,
        },
        headers: HTTP_HEADERS,
        httpsAgent,
      }),
    );
    for (const member of response.data?.query?.categorymembers ?? []) {
      if (member.ns === 0) titles.push(member.title);
    }
    continueParams = response.data?.continue;
    await sleep(300);
  } while (continueParams);

  return titles;
}

// ── Wikitext helpers (repris à l'identique des autres scripts scrape-*) ────

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

interface FieldMarker {
  key: string;
  markerStart: number;
  valueStart: number;
}

// Repère les "|clé = " du bloc, mais UNIQUEMENT à la profondeur 1 (directement
// sous le {{Infobox...}} englobant, pas dans un template imbriqué dans une
// valeur de champ). Une simple regex sans suivi de profondeur confond
// n'importe quel "|clé=" imbriqué avec un vrai séparateur de champ — ex:
// "desc_suspicious = ... {{Sic|have|hide=1}} ..." sur Braised Meat : le
// "|hide=1" DANS le template {{Sic}} coupait la vraie valeur de
// desc_suspicious en plein milieu de phrase. Bien plus grave que la
// troncature du "}}" final gérée par isLastField ci-dessous, puisque ça peut
// survenir n'importe où dans une valeur, pas seulement en fin de bloc.
function scanTopLevelMarkers(block: string, keyPattern: RegExp): FieldMarker[] {
  const markers: FieldMarker[] = [];
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === '{' && block[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (block[i] === '}' && block[i + 1] === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && block[i] === '|') {
      const match = keyPattern.exec(block.slice(i + 1));
      if (match && match.index === 0) {
        markers.push({ key: match[1].trim(), markerStart: i, valueStart: i + 1 + match[0].length });
      }
    }
  }
  return markers;
}

function fieldsFromMarkers(block: string, markers: FieldMarker[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let i = 0; i < markers.length; i++) {
    const isLastField = i + 1 >= markers.length;
    const valueEnd = isLastField ? block.length : markers[i + 1].markerStart;
    let value = block.slice(markers[i].valueStart, valueEnd);
    // Seul le DERNIER champ du bloc englobe, dans sa tranche, les "}}" de
    // fermeture de l'infobox elle-même (valueEnd === block.length) : les
    // retirer inconditionnellement pour CHAQUE champ corrompait toute valeur
    // se terminant par son propre template complet (ex: "recipe = {{Sold
    // By|Recipe: X}}" sur Noodles with Mountain Delicacies, dont le "}}"
    // légitime du template se faisait amputer, laissant un fragment
    // `{{Sold By|Recipe: X` non refermé — que cleanWikitext ne peut plus
    // reconnaître comme template et laisse tel quel).
    if (isLastField) value = value.replace(/\}\}\s*$/, '');
    fields[markers[i].key] = value.trim();
  }
  return fields;
}

// La classe de caractères doit inclure les parenthèses : des clés
// d'ingrédient de {{Recipe}} en contiennent (ex: "Frog (Material)" dans la
// recette de Flaming Essential Oil) ; sans ça, la ligne entière est
// silencieusement absorbée dans la valeur du champ précédent (ex: "type").
function parseInfoboxFields(block: string): Record<string, string> {
  return fieldsFromMarkers(block, scanTopLevelMarkers(block, /^\s*([\w'() -]+?)\s*=\s*/));
}

// Variante accentuée pour l'infobox FR ({{Infobox objet}}, champs "délicieux",
// "spécial", ...), non couverts par \w en mode non-unicode.
function parseInfoboxFieldsAccented(block: string): Record<string, string> {
  return fieldsFromMarkers(block, scanTopLevelMarkers(block, /^\s*([^=|]+?)\s*=\s*/));
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''''/g, '')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    // {{Color|Pyro DMG}} colore juste le texte pour l'affichage (très courant
    // dans les descriptions/effets des plats à dégâts élémentaires) : il faut
    // garder le texte, pas le supprimer comme un template générique.
    .replace(/\{\{Color\|([^{}|]*)\}\}/gi, '$1')
    // {{Sic|have|hide=1}} marque une tournure du texte original du jeu comme
    // volontaire (pas une coquille du wiki) ; hide=1 supprime juste
    // l'annotation "[sic]" visuelle. Le mot lui-même (1er paramètre
    // positionnel) doit rester dans la phrase (ex: "the ingredients just
    // {{Sic|have|hide=1}} been bundled..." sur Braised Meat) — un strip
    // générique le supprimerait, cassant la description.
    .replace(/\{\{Sic\|([^{}|]*)(?:\|[^{}]*)?\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/&shy;/gi, '')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`, 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// "ATK-Boosting Dishes" -> "ATK_BOOSTING_DISHES"
function toCategoryKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Une poignée de pages (ex: "Drink 455", "Harbor Fish Burger") ont un champ
// `type` au singulier ("Recovery Dish") au lieu du pluriel utilisé partout
// ailleurs ("Recovery Dishes") — incohérence du wiki lui-même, comme le
// singulier/pluriel déjà géré pour "Dropped By" dans scrape-materials.ts.
// Normalisé ici pour ne pas fragmenter la taxonomie de catégories.
function normalizeFoodType(type: string): string {
  return type.replace(/\bDish\b/i, 'Dishes');
}

// ── HTML helpers (Shop Availability, repris de scrape-materials.ts) ────────

function extractSectionHtml(html: string, id: string): string | null {
  const idx = html.indexOf(`id="${id}"`);
  if (idx === -1) return null;

  const lastH2Before = html.lastIndexOf('<h2', idx);
  const lastH3Before = html.lastIndexOf('<h3', idx);
  const isH2 = lastH2Before > lastH3Before;

  const searchFrom = idx + `id="${id}"`.length;
  const nextH2 = html.indexOf('<h2', searchFrom);
  const nextH3 = html.indexOf('<h3', searchFrom);
  const candidates = isH2 ? [nextH2] : [nextH2, nextH3];
  const validCandidates = candidates.filter((n) => n !== -1);
  const end = validCandidates.length ? Math.min(...validCandidates) : html.length;
  return html.slice(idx, end);
}

function parseNumber(raw: string): number {
  const n = parseInt(raw.replace(/[,\s ]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

function mapRestock(note: string): RestockType {
  const n = note.trim().toLowerCase();
  // "Everyday" (ex: Rainbow Aster) est un synonyme observé de "Daily" dans la
  // colonne Notes de certaines tables Shop Availability.
  if (n.includes('daily') || n.includes('everyday') || n.includes('every day')) return 'DAILY';
  if (n.includes('weekly')) return 'WEEKLY';
  if (n.includes('monthly')) return 'MONTHLY';
  if (n.includes('three') || n.includes('3 day')) return 'THREE_DAYS';
  if (n.length === 0 || n === '—' || n === '-') return 'NEVER';
  console.warn(`⚠️  Fréquence de restock inconnue: "${note}" → NEVER par défaut.`);
  return 'NEVER';
}

function parseCostCell(text: string, headerCurrency: string): { currency: string; cost: number } | null {
  const trimmed = text.trim();
  const itemMatch = trimmed.match(/^(.+?)\s*[×x]\s*(\d+)$/);
  if (itemMatch) {
    return { currency: cleanWikitext(itemMatch[1]), cost: parseInt(itemMatch[2], 10) };
  }
  const numeric = trimmed.replace(/[,\s ]/g, '');
  if (/^\d+$/.test(numeric)) {
    return { currency: headerCurrency, cost: parseInt(numeric, 10) };
  }
  return null;
}

function parseShopAvailabilityHtml(html: string, foodTitle: string): FoodSellerData[] {
  const section = extractSectionHtml(html, 'Shop_Availability');
  if (!section) return [];

  const $ = cheerio.load(section);
  const table = $('table.article-table').first();
  if (!table.length) return [];

  const rows = table.find('tr').toArray();
  if (rows.length < 2) return [];

  const headers = $(rows[0])
    .find('th')
    .toArray()
    .map((th) => $(th).text().trim());
  const npcIdx = headers.findIndex((h) => /npc/i.test(h));
  const costIdx = headers.findIndex((h) => /cost$/i.test(h));
  const stockIdx = headers.findIndex((h) => /stock/i.test(h));
  const notesIdx = headers.findIndex((h) => /notes?/i.test(h));
  const headerCurrency = costIdx !== -1 ? headers[costIdx].replace(/\s*cost$/i, '').trim() : 'Mora';

  const sellers: FoodSellerData[] = [];
  for (const row of rows.slice(1)) {
    const cells = $(row).find('td').toArray();
    if (!cells.length) continue;

    const name = npcIdx !== -1 ? $(cells[npcIdx]).text().trim() : '';
    if (!name) continue;

    const cost =
      costIdx !== -1 ? parseCostCell($(cells[costIdx]).text(), headerCurrency) : { currency: headerCurrency, cost: 0 };
    if (!cost) {
      console.warn(
        `⚠️  "${foodTitle}": coût de vente illisible pour "${name}" ("${$(cells[costIdx]).text().trim()}") — vendeur ignoré.`,
      );
      continue;
    }

    sellers.push({
      name,
      currency: cost.currency,
      cost: cost.cost,
      stock: stockIdx !== -1 ? parseNumber($(cells[stockIdx]).text()) : 0,
      restock: mapRestock(notesIdx !== -1 ? $(cells[notesIdx]).text() : ''),
    });
  }
  return sellers;
}

// ── Recipe ({{Recipe|type=Cooking|...}} / {{Recipe|type=Crafting|...}}) ────
// Même template pour plats (==Recipe==) et potions (==Alchemy==) : cherché
// dans tout le wikitext plutôt que localisé par heading (cf. NOTE en tête).

function parseRecipe(content: string): { subtype: 'COOKING' | 'CRAFTING' | null; ingredients: RecipeIngredient[] } {
  const block = extractBracedBlock(content, '{{Recipe');
  if (!block) return { subtype: null, ingredients: [] };

  const fields = parseInfoboxFields(block);
  const rawType = (fields['type'] ?? '').trim().toLowerCase();
  const subtype: 'COOKING' | 'CRAFTING' = rawType === 'crafting' ? 'CRAFTING' : 'COOKING';

  const ingredients: RecipeIngredient[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'type' || key === 'sort' || key === 'character') continue;
    const quantity = parseInt(value, 10);
    if (Number.isNaN(quantity)) continue;
    ingredients.push({ item: key, quantity });
  }

  return { subtype, ingredients };
}

// ── {{Special Dish|Character|Name}} ─────────────────────────────────────

function parseSpecialDish(content: string): FoodSpecialDish | null {
  const match = content.match(/\{\{Special Dish\|([^|}]+)\|([^}]+)\}\}/);
  if (!match) return null;
  return { character: cleanWikitext(match[1]), name: cleanWikitext(match[2]) };
}

// ── EN: {{Food Infobox}} ────────────────────────────────────────────────

function parseTieredText(base: string, suspicious: string | undefined, basic: string | undefined, delicious: string | undefined): FoodTieredText {
  const join = (suffix: string | undefined) => cleanWikitext(suffix !== undefined ? `${base} ${suffix}` : base);
  // Un champ desc_suspicious/desc_delicious peut exister mais être VIDE (ex:
  // "Faith Eternal", un plat spécial dont le template a gardé les 3 champs de
  // qualité en blanc au lieu de les omettre) : présence seule ne suffit pas à
  // dire que le palier s'applique, il faut aussi du contenu réel — sinon
  // on obtient un palier "" au lieu de null, alors que le FR (qui checke la
  // troncature) l'omet correctement pour la même page.
  const hasTier = (suffix: string | undefined) => suffix !== undefined && suffix.trim() !== '';
  return {
    normal: join(basic),
    suspicious: hasTier(suspicious) ? join(suspicious) : null,
    delicious: hasTier(delicious) ? join(delicious) : null,
  };
}

function parseVal(v: string | undefined): number | null {
  if (v === undefined) return null;
  // Certaines valeurs à 4 chiffres utilisent un séparateur de milliers (ex:
  // "eff_delicious2 = 1,200" sur Apple Roly Poly) : parseFloat("1,200")
  // s'arrête à la virgule et renverrait silencieusement 1 au lieu de 1200.
  const num = parseFloat(v.replace(/,/g, ''));
  return Number.isNaN(num) ? null : num;
}

// Le champ `eff_att{n}` (libellé, ex: "ATK") est absent sur certaines pages
// (ex: Braised Meatball, Apple Roly Poly) alors que les valeurs
// `eff_suspicious{n}`/`eff_basic{n}`/`eff_delicious{n}` sont bien présentes :
// une variable existe donc dès qu'AU MOINS un des 4 champs existe, pas
// seulement `eff_att{n}` — sous peine de perdre la variable entière et de
// laisser un placeholder `(varN)` non résolu dans le texte d'effet.
function countEffectVariables(fields: Record<string, string>): number {
  let n = 1;
  while (
    fields[`eff_att${n}`] !== undefined ||
    fields[`eff_suspicious${n}`] !== undefined ||
    fields[`eff_basic${n}`] !== undefined ||
    fields[`eff_delicious${n}`] !== undefined
  ) {
    n++;
  }
  return n - 1;
}

function rawEffectValue(fields: Record<string, string>, n: number, tier: keyof FoodQualityValues): string | undefined {
  const key = tier === 'normal' ? `eff_basic${n}` : `eff_${tier}${n}`;
  return fields[key];
}

function parseEffectVariablesEn(fields: Record<string, string>): FoodEffectVariable[] {
  const variables: FoodEffectVariable[] = [];
  for (let n = 1; n <= countEffectVariables(fields); n++) {
    variables.push({
      label: fields[`eff_att${n}`] ? cleanWikitext(fields[`eff_att${n}`]) : '',
      values: {
        suspicious: parseVal(rawEffectValue(fields, n, 'suspicious')),
        normal: parseVal(rawEffectValue(fields, n, 'normal')),
        delicious: parseVal(rawEffectValue(fields, n, 'delicious')),
      },
    });
  }
  return variables;
}

function resolveEffectTexts(fields: Record<string, string>): FoodTieredText {
  const rawEffect = fields['effect'] ?? '';
  const variableCount = countEffectVariables(fields);

  const resolve = (tier: keyof FoodQualityValues): string | null => {
    let text = rawEffect;
    let hasAllValues = true;
    for (let n = 1; n <= variableCount; n++) {
      const raw = rawEffectValue(fields, n, tier);
      if (raw === undefined || raw.trim() === '') {
        hasAllValues = false;
        continue;
      }
      // Presque toujours numérique, mais pas systématiquement : sur Goulash,
      // "(var1)" vaut "Slightly decreases"/"Somewhat decreases"/"Decreases"
      // (verbe, pas un nombre) — substitué tel quel dans ce cas plutôt que
      // laissé non résolu.
      const numeric = parseVal(raw);
      text = text.replace(`(var${n})`, numeric !== null ? String(numeric) : cleanWikitext(raw));
    }
    if (!hasAllValues && /\(var\d+\)/.test(text)) return null;
    return cleanWikitext(text);
  };

  const tierApplies = (tier: 'suspicious' | 'delicious') =>
    Array.from({ length: variableCount }, (_, i) => rawEffectValue(fields, i + 1, tier)).some(
      (v) => v !== undefined && v.trim() !== '',
    );

  return {
    normal: resolve('normal') ?? cleanWikitext(rawEffect),
    suspicious: tierApplies('suspicious') ? resolve('suspicious') : null,
    delicious: tierApplies('delicious') ? resolve('delicious') : null,
  };
}

interface RawFoodEn {
  pageTitle: string;
  title: string;
  rarity: number;
  category: string;
  effectType: string;
  descriptions: FoodTieredText;
  effectTexts: FoodTieredText;
  effectVariables: FoodEffectVariable[];
  region: string | null;
  recipeHint: string | null;
  recipeSubtype: 'COOKING' | 'CRAFTING' | null;
  ingredients: RecipeIngredient[];
  sources: string[];
  specialDish: FoodSpecialDish | null;
  character: string | null;
  baseDish: string | null;
  frTitle: string | null;
  content: string;
}

function parseFoodInfoboxEn(pageTitle: string, content: string, frTitle: string | null): RawFoodEn | null {
  const block = extractBracedBlock(content, '{{Food Infobox');
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const rarity = parseInt(fields['quality'] ?? '', 10);
  const description = fields['description'] ?? '';
  const descriptions = parseTieredText(description, fields['desc_suspicious'], fields['desc_basic'], fields['desc_delicious']);
  const effectVariables = parseEffectVariablesEn(fields);
  const effectTexts = resolveEffectTexts(fields);
  const recipe = parseRecipe(content);

  const rawSources: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`source${i}`];
    if (value === undefined) break;
    if (/\{\{Sold By/i.test(value)) continue; // cf. sellers, extrait du HTML rendu
    const cleaned = cleanWikitext(value);
    if (cleaned) rawSources.push(cleaned);
  }

  return {
    pageTitle,
    title: cleanWikitext(fields['name'] ?? pageTitle) || pageTitle,
    rarity: Number.isNaN(rarity) ? 0 : rarity,
    category: toCategoryKey(normalizeFoodType(cleanWikitext(fields['type'] ?? ''))),
    effectType: cleanWikitext(fields['effectType'] ?? ''),
    descriptions,
    effectTexts,
    effectVariables,
    region: fields['region'] ? cleanWikitext(fields['region']) : null,
    // Peut être "null-after-clean" quand la valeur brute n'est qu'un
    // {{Sold By|...}} (ex: Noodles with Mountain Delicacies) : ce template
    // générique disparaît entièrement au nettoyage, ne laissant aucun texte
    // libre exploitable (cette info est de toute façon déjà couverte par
    // `sellers`, extrait séparément du HTML rendu).
    recipeHint: cleanWikitext(fields['recipe'] ?? fields['formula'] ?? '') || null,
    recipeSubtype: recipe.subtype,
    ingredients: recipe.ingredients,
    sources: rawSources,
    specialDish: parseSpecialDish(content),
    character: fields['character'] ? cleanWikitext(fields['character']) : null,
    baseDish: fields['base'] ? cleanWikitext(fields['base']) : null,
    frTitle,
    content,
  };
}

// ── FR: {{Infobox objet}} (description/effet uniquement — cf. NOTE) ────────

function parseFrFoodFields(content: string): {
  descriptions: FoodTieredText;
  effectTexts: FoodTieredText;
  recipeHint: string | null;
  character: string | null;
  baseDish: string | null;
  specialDishName: string | null;
} | null {
  const block = extractBracedBlock(content, '{{Infobox objet');
  if (!block) return null;
  const fields = parseInfoboxFieldsAccented(block);

  // Un champ peut être présent mais VIDE après nettoyage (ex:
  // "effet_délicieux = \n\n<!--plat suspect-->" sur les pages FR qui laissent
  // les 3 champs de qualité en blanc avec juste un commentaire de template en
  // dessous : la tranche capturée par parseInfoboxFieldsAccented pour
  // "effet_délicieux" avale ce commentaire jusqu'au champ suivant, donc la
  // valeur BRUTE est non-vide/"truthy" mais se nettoie en "" — même classe de
  // bug que celle corrigée côté EN dans parseTieredText (cf. "Faith
  // Eternal") : il faut tester le résultat nettoyé, pas la présence brute.
  const cleanedOrNull = (raw: string | undefined): string | null => cleanWikitext(raw ?? '') || null;

  return {
    descriptions: {
      normal: cleanWikitext(fields['description'] ?? ''),
      suspicious: cleanedOrNull(fields['suspect']),
      delicious: cleanedOrNull(fields['délicieux']),
    },
    effectTexts: {
      normal: cleanWikitext(fields['effet'] ?? ''),
      suspicious: cleanedOrNull(fields['effet_suspect']),
      delicious: cleanedOrNull(fields['effet_délicieux']),
    },
    recipeHint: cleanedOrNull(fields['recette']),
    character: cleanedOrNull(fields['perso']),
    baseDish: cleanedOrNull(fields['base']),
    // Nom (traduit) de la variante spéciale sur la page du plat "de base"
    // (ex: "Beau songe" sur "Tofu aux amandes") — le personnage associé n'a
    // pas besoin de traduction (même orthographe FR/EN).
    specialDishName: cleanedOrNull(fields['spécial']),
  };
}

// ── Construction de la sortie finale ─────────────────────────────────────

// Le wiki FR remplit parfois `effet_suspect`/`effet_délicieux` avec le même
// texte générique que `effet` (ex: "Harvest's Boon"/"Récolte favorable" :
// "Une petite surprise du Collectif de l'abondance." dupliqué sur les 3
// champs), même quand le plat n'a AUCUN vrai palier de qualité — l'EN, qui
// détermine l'existence d'un palier à partir de variables numériques
// (`eff_suspicious{n}`/`eff_delicious{n}`, cf. `resolveEffectTexts`), fait
// alors autorité : si l'EN dit qu'un palier n'existe pas (null), on ignore le
// texte FR même présent, pour ne pas exposer un palier fantôme identique aux
// deux autres. Si l'EN a un palier réel mais que le wiki FR ne l'a pas
// renseigné (ex: "Nine-Fruit Nectar"/suspicious), le null FR reste tel quel :
// c'est un vrai trou de traduction côté wiki, pas une donnée à inventer.
function buildFrEffectTexts(raw: RawFoodEn, frFields: NonNullable<ReturnType<typeof parseFrFoodFields>>): FoodTieredText {
  return {
    normal: frFields.effectTexts.normal,
    suspicious: raw.effectTexts.suspicious !== null ? frFields.effectTexts.suspicious : null,
    delicious: raw.effectTexts.delicious !== null ? frFields.effectTexts.delicious : null,
  };
}

function buildFoodOutput(
  raw: RawFoodEn,
  lang: 'en' | 'fr',
  frName: string | null,
  frFields: ReturnType<typeof parseFrFoodFields>,
  sellers: FoodSellerData[],
): FoodOutput {
  const name = lang === 'fr' && frName ? frName : raw.title;

  return {
    pageTitle: raw.pageTitle,
    name,
    rarity: raw.rarity,
    category: raw.category,
    effectType: raw.effectType,
    descriptions: lang === 'fr' && frFields ? frFields.descriptions : raw.descriptions,
    effectTexts: lang === 'fr' && frFields ? buildFrEffectTexts(raw, frFields) : raw.effectTexts,
    // Pas d'équivalent FR fiable pour ces champs (cf. NOTE en tête de fichier) :
    // réutilisés tels quels depuis l'EN.
    effectVariables: raw.effectVariables,
    region: raw.region,
    // NOTE: `recipeHint` documente le déblocage de la RECETTE, pas le
    // vendeur du plat déjà préparé (`sellers`) — les deux peuvent légitimement
    // différer (ex: "Candied Ajilenakh Nut" : recette vendue par Enteka,
    // plat vendu par Azalai ET Enteka). Vérifié aussi que le wiki FR peut
    // citer un vendeur de recette absent de la table Shop Availability EN
    // actuelle (ex: "Xiaobai" sur "Nouilles aux délices de la montagne",
    // recette-inconnue côté EN) : ne PAS combler le null EN depuis `sellers`,
    // ça injecterait une donnée non vérifiée/potentiellement fausse.
    recipeHint: (lang === 'fr' && frFields?.recipeHint) || raw.recipeHint,
    recipeSubtype: raw.recipeSubtype,
    ingredients: raw.ingredients,
    sources: raw.sources,
    sellers,
    specialDish:
      lang === 'fr' && frFields?.specialDishName && raw.specialDish
        ? { character: raw.specialDish.character, name: frFields.specialDishName }
        : raw.specialDish,
    character: (lang === 'fr' && frFields?.character) || raw.character,
    baseDish: (lang === 'fr' && frFields?.baseDish) || raw.baseDish,
  };
}

// ── Pipeline: 1 plat ──────────────────────────────────────────────────────

async function scrapeFood(pageTitle: string): Promise<CachedFood | null> {
  const { content, frTitle } = await fetchWikitextWithLanglink(pageTitle);
  if (!content) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return null;
  }

  const raw = parseFoodInfoboxEn(pageTitle, content, frTitle);
  if (!raw) {
    // Pages de présentation ("Food", "Potion", "Special Dish") sans
    // {{Food Infobox}} : pas un plat individuel, ignorées silencieusement.
    return null;
  }

  const html = await fetchHtml(pageTitle);
  const sellers = parseShopAvailabilityHtml(html, raw.title);

  const en = buildFoodOutput(raw, 'en', null, null, sellers);

  let fr: FoodOutput | null = null;
  if (frTitle) {
    const frContent = await fetchWikitext(FR_API_URL, frTitle);
    const frFields = frContent ? parseFrFoodFields(frContent) : null;
    if (frFields && frFields.descriptions.normal) {
      fr = buildFoodOutput(raw, 'fr', frTitle, frFields, sellers);
    } else {
      console.warn(`⚠️  "${pageTitle}": page FR "${frTitle}" trouvée mais infobox incomplète — fichier fr/ non généré.`);
    }
  } else {
    console.warn(`⚠️  "${pageTitle}": pas de langlink FR — fichier fr/ non généré.`);
  }

  return { pageTitle, en, fr };
}

async function scrapeAll(pageTitles: string[]): Promise<CachedFood[]> {
  const results: CachedFood[] = [];
  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    try {
      const food = await scrapeFood(pageTitles[i]);
      if (food) results.push(food);
    } catch (err) {
      console.warn(`⚠️  Échec du scraping de "${pageTitles[i]}": ${err}`);
    }
    await sleep(300);
  }
  return results;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function loadCache(): CachedFood[] | null {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCache(newData: CachedFood[]) {
  const existing = loadCache() ?? [];
  const merged = new Map(existing.map((f) => [f.pageTitle, f]));
  for (const food of newData) merged.set(food.pageTitle, food);
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify([...merged.values()], null, 2), 'utf-8');
  console.log(`✅ Cache saved (${merged.size} entries)`);
}

// ── Output ────────────────────────────────────────────────────────────────────
// Le nom de fichier vient du TITRE DE PAGE, pas du nom affiché (cf. NOTE en
// tête de fichier — collisions entre plats "de base" et leurs variantes de
// quête/évènement partageant le même nom affiché).

function writeFoodFiles(foods: CachedFood[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  let written = 0;
  let skippedFr = 0;
  for (const food of foods) {
    const filename = `${slugify(food.pageTitle)}.json`;
    // Toujours resynchronisé depuis la clé de haut niveau de CachedFood, même
    // en régénérant depuis un cache écrit par une version antérieure du
    // script (ex: avant l'ajout du champ `pageTitle` sur FoodOutput).
    const en: FoodOutput = { ...food.en, pageTitle: food.pageTitle };
    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(en, null, 2), 'utf-8');

    if (food.fr) {
      const fr: FoodOutput = { ...food.fr, pageTitle: food.pageTitle };
      fs.writeFileSync(path.join(frDir, filename), JSON.stringify(fr, null, 2), 'utf-8');
    } else {
      skippedFr++;
    }
    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} plat(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} food files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--cache', '--fetch-category'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch une liste de pages    : npx ts-node -r tsconfig-paths/register scripts/scrape-food.ts --fetch "Almond Tofu" "\\"Sweet Dream\\""');
    console.error('  Fetch toute la catégorie     : npx ts-node -r tsconfig-paths/register scripts/scrape-food.ts --fetch-category');
    console.error('  Régénérer depuis le cache    : npx ts-node -r tsconfig-paths/register scripts/scrape-food.ts --cache');
    process.exit(1);
  }

  let foods: CachedFood[];

  if (args[0] === '--cache') {
    const cached = loadCache();
    if (!cached) {
      console.error('❌ No cache found. Run with --fetch or --fetch-category first.');
      process.exit(1);
    }
    foods = cached;
    console.log(`Loaded ${foods.length} food items from cache.`);
  } else {
    let pageTitles: string[];
    if (args[0] === '--fetch-category') {
      console.log('Fetching "Category:Food" members...');
      pageTitles = await fetchCategoryMembers('Food');
      console.log(`Found ${pageTitles.length} pages in category.`);
    } else {
      pageTitles = args.slice(1);
    }

    if (pageTitles.length === 0) {
      console.error('❌ Aucune page à scraper (liste vide).');
      process.exit(1);
    }

    foods = await scrapeAll(pageTitles);
    saveCache(foods);
  }

  writeFoodFiles(foods);
}

main();
