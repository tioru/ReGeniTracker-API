// scripts/scrape-books.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  FR_API_URL,
  sleep,
  fetchCategoryMembers,
  fetchWikitext,
  fetchWikitextWithLanglink,
} from './lib/wiki-fetch';

const OUTPUT_DIR = (lang: 'en' | 'fr') =>
  path.resolve(__dirname, `../prisma/data/books/${lang}`);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE
//
// La page https://genshin-impact.fandom.com/wiki/Book référence deux
// catégories de pages, chacune avec son propre template d'infobox :
//   - "Book Collections" ({{Book Collection Infobox}}) : livres à volumes
//     multiples rangés dans l'Archive (ex: Diary of Roald the Adventurer),
//     avec author/publisher/illustrator optionnels et volN = localisation du
//     tome N.
//   - "Books" ({{Book Infobox}}) : livres à volume unique, objets de quête
//     rangés dans l'inventaire, avec description + sourceN = provenance.
// Les deux templates partagent les champs quality/region_lore/region_location,
// donc scrapeBook() détecte simplement lequel des deux blocs est présent sur
// la page plutôt que de dépendre de la catégorie d'où vient le titre — les
// deux modes de fetch (--fetch-category "Books" / "Book Collections")
// utilisent le même pipeline.
//
// Contrairement à scrape-materials.ts, tout ce qui est extrait ici vient du
// wikitext brut (aucun rendu HTML nécessaire) : les infobox contiennent déjà
// tous les champs structurés utiles. Le texte intégral des tomes (sections
// "==Vol. N==" / "==Tome N==" + {{Description|...}}) n'est PAS repris : son
// découpage (numérotation romaine/arabe, "Vol."/"Volume"/"Part" selon la
// page) est trop hétérogène pour être extrait de façon fiable — seules les
// données structurées de l'infobox le sont, dans le même esprit que
// buildSourceEntries qui ignore les sources non modélisées plutôt que de
// produire une donnée peu fiable.
//
// ── FR ────────────────────────────────────────────────────────────────────
// Le wiki FR utilise un template unique {{Infobox livre}} pour les deux
// catégories (distinguées par son champ "type": "Livre" / "Collection de
// livres"). Il expose les mêmes champs tomeN (localisation traduite, même
// numérotation que volN en EN) et auteur, mais ni publisher/illustrator ni
// description pour les collections (uniquement pour les livres à volume
// unique) : repris tels quels depuis l'EN quand absents côté FR.
// ─────────────────────────────────────────────────────────────────────────────

type BookCategory = 'BOOK' | 'BOOK_COLLECTION';

interface BookVolume {
  number: number;
  location: string;
}

interface BookOutput {
  name: string;
  category: BookCategory;
  rarity: number;
  region: string | null;
  author: string | null;
  publisher: string | null;
  illustrator: string | null;
  description: string | null; // BOOK uniquement
  source: string | null; // BOOK uniquement
  volumes: BookVolume[]; // BOOK_COLLECTION uniquement
}

interface CachedBook {
  pageTitle: string;
  en: BookOutput;
  fr: BookOutput | null;
}

// ── Wikitext helpers (repris à l'identique de scrape-materials.ts) ─────────

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

function parseInfoboxFields(block: string): Record<string, string> {
  // Certaines pages FR (ex: les "Books" à volume unique, {{Infobox objet}})
  // mettent tous les champs sur UNE seule ligne séparés par "|" au lieu d'un
  // champ par ligne (format utilisé partout ailleurs) : un parsing ligne par
  // ligne ne verrait alors jamais aucun champ (aucune ligne ne commence par
  // "|"). On repère donc chaque marqueur "|clé=" dans le bloc entier plutôt
  // que ligne par ligne, ce qui couvre les deux formats indifféremment.
  // Un <ref>...</ref> inséré dans une valeur de champ (ex: author = [[Leucade]]
  // <ref>{{Ref/NPC|Aratani||s = ...}}</ref>) peut contenir un "|clé=" interne
  // qui, sinon retiré avant le scan des marqueurs, est pris à tort pour un
  // nouveau champ et tronque la valeur légitime en cours.
  const cleanedBlock = block.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '');
  const fields: Record<string, string> = {};
  const markers = [...cleanedBlock.matchAll(/\|\s*([\w' -]+?)\s*=\s*/g)];
  for (let i = 0; i < markers.length; i++) {
    const key = markers[i][1].trim();
    const valueStart = markers[i].index! + markers[i][0].length;
    const valueEnd = i + 1 < markers.length ? markers[i + 1].index! : cleanedBlock.length;
    const value = cleanedBlock
      .slice(valueStart, valueEnd)
      .replace(/\}\}\s*$/, '')
      .trim();
    fields[key] = value;
  }
  return fields;
}

function cleanWikitext(text: string): string {
  if (!text) return '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    // {{Quest|Name}} (ex: vol1 de "The Tale of Qoyllor and Ukuku") : repris
    // avant le nettoyage générique des templates, sinon le nom de quête
    // disparaît entièrement au lieu d'être affiché comme du texte simple.
    .replace(/\{\{Quest\|([^{}|]*)(?:\|[^{}]*)?\}\}/gi, '$1')
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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// "None" est utilisé littéralement par le wiki pour un champ region_lore/
// region_location non applicable (ex: A Legend of Sword) : traité comme
// l'absence de valeur plutôt que comme une région nommée "None".
function cleanOptionalField(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = cleanWikitext(raw);
  if (!cleaned || /^none$/i.test(cleaned)) return null;
  return cleaned;
}

// ── Parsing d'un bloc d'infobox EN (commun aux deux templates) ─────────────

function parseVolumesEn(fields: Record<string, string>): BookVolume[] {
  const volumes: BookVolume[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`vol${i}`];
    if (value === undefined) break;
    volumes.push({ number: i, location: cleanWikitext(value) });
  }
  // Un champ volN vide est parfois laissé en réserve pour un futur tome au-delà
  // du compte annoncé par le champ "volumes" (ex: Fables de Fontaine a
  // "volumes = 3" mais un "vol4 = " vide en trop) : on retire ces entrées
  // finales sans localisation plutôt que de publier une donnée vide.
  while (volumes.length && !volumes[volumes.length - 1].location) {
    volumes.pop();
  }
  return volumes;
}

function parseSourcesEn(fields: Record<string, string>): string | null {
  const sources: string[] = [];
  for (let i = 1; ; i++) {
    const value = fields[`source${i}`];
    if (value === undefined) break;
    const cleaned = cleanWikitext(value);
    if (cleaned) sources.push(cleaned);
  }
  return sources.length ? sources.join('; ') : null;
}

function parseBookInfoboxEn(pageTitle: string, content: string): BookOutput | null {
  const collectionBlock = extractBracedBlock(content, '{{Book Collection Infobox');
  if (collectionBlock) {
    const fields = parseInfoboxFields(collectionBlock);
    return {
      name: pageTitle,
      category: 'BOOK_COLLECTION',
      rarity: parseInt(fields['quality'] ?? '', 10) || 0,
      region: cleanOptionalField(fields['region_location'] ?? fields['region_lore']),
      author: cleanOptionalField(fields['author']),
      publisher: cleanOptionalField(fields['publisher']),
      illustrator: cleanOptionalField(fields['illustrator']),
      description: null,
      source: null,
      volumes: parseVolumesEn(fields),
    };
  }

  const bookBlock = extractBracedBlock(content, '{{Book Infobox');
  if (bookBlock) {
    const fields = parseInfoboxFields(bookBlock);
    return {
      name: pageTitle,
      category: 'BOOK',
      rarity: parseInt(fields['quality'] ?? '', 10) || 0,
      region: cleanOptionalField(fields['region_location'] ?? fields['region_lore']),
      author: cleanOptionalField(fields['author']),
      publisher: null,
      illustrator: null,
      description: cleanWikitext(fields['description'] ?? '') || null,
      source: parseSourcesEn(fields),
      volumes: [],
    };
  }

  return null;
}

// ── FR: {{Infobox livre}} ou {{Infobox objet}} (nom vient du langlink) ────
// Les collections ("Book Collections") utilisent systématiquement
// {{Infobox livre}} côté FR, mais les livres à volume unique ("Books") sont
// répartis entre les deux templates selon la page (ex: "Guide de planage"
// utilise {{Infobox livre|type=Livre}}, "Chroniques de Sangonomiya" utilise
// {{Infobox objet|type=Livre}} — le même template que les matériaux) : les
// deux sont donc essayés, dans cet ordre.
//
// Beaucoup de pages "Books" FR n'ont NI champ "description" NI champ
// "source" dans l'infobox (contrairement à l'EN) : la description est alors
// le premier paragraphe suivant l'infobox (en italique, parfois sous un
// titre "==Description==" dédié — ex: "A Preliminary Study of Sangonomiya
// Folk Belief"), et la provenance est stockée dans le champ "tome1" (repris
// tel quel du template collection alors même que ces pages n'ont qu'un seul
// tome) — ex: "1000 Years of Loneliness". Sans ce repli, ~2/3 des livres
// FR se retrouvaient avec la description et la source de l'EN non traduites.

function extractFrDescriptionFallback(content: string, block: string): string | null {
  const idx = content.indexOf(block);
  if (idx === -1) return null;
  const after = content.slice(idx + block.length, idx + block.length + 4000);

  // Le premier paragraphe suivant l'infobox peut être précédé d'une phrase
  // d'intro générique (ex: "'''X''' est un objet de quête...") avant la
  // véritable section de description, dont le titre varie selon la page
  // ("==Description==", "==Texte==", ...) — on prend donc le contenu du
  // premier titre de section rencontré, quel que soit son nom, plutôt que de
  // chercher spécifiquement "Description" (ce qui faisait remonter le titre
  // "==Texte==" lui-même comme description sur les pages qui l'utilisent).
  //
  // Exception : "==Historique==" ({{Historique|...}}, changelog de version)
  // est présent en fin de page sur quasiment tous les articles du wiki. Sur
  // les pages sans section de description dédiée (juste un paragraphe en
  // italique après l'infobox, cf. ci-dessus), c'était alors le premier — et
  // seul — titre rencontré dans la fenêtre de recherche, ce qui faisait
  // remonter le changelog vide à la place du paragraphe italique déjà
  // correct (ex: "Ancient Investigation Journal: Part II").
  const headingMatch = [...after.matchAll(/==+\s*([^=\n]+?)\s*==+\s*\n+([\s\S]+?)(?:\n\s*\n|\n==|$)/g)].find(
    (m) => m[1].trim().toLowerCase() !== 'historique',
  );
  const target = headingMatch ? headingMatch[2] : after.match(/^\s*([\s\S]+?)(?:\n\s*\n|\n==|$)/)?.[1];
  if (!target) return null;
  return cleanWikitext(target) || null;
}

// previousFr: dernière traduction FR connue (cache), utilisée en repli avant
// l'EN quand le wiki FR a retiré le champ structuré (description/source/
// tomeN) correspondant — cf. preserveKnownFields, même logique que pour
// author/publisher/illustrator mais appliquée ici aux champs qui, sinon,
// retombent silencieusement sur du texte anglais non traduit plutôt que sur
// null (donc invisibles à preserveKnownFields, qui ne réagit qu'à null).
function parseBookInfoboxFr(
  frTitle: string,
  content: string,
  en: BookOutput,
  previousFr: BookOutput | null | undefined,
): BookOutput | null {
  const block =
    extractBracedBlock(content, '{{Infobox livre') ?? extractBracedBlock(content, '{{Infobox objet');
  if (!block) return null;
  const fields = parseInfoboxFields(block);

  const rarity = parseInt(fields['star'] ?? '', 10);

  return {
    name: frTitle,
    category: en.category,
    rarity: Number.isNaN(rarity) ? en.rarity : rarity,
    // Pas d'équivalent FR pour region_lore/region_location : repris de l'EN.
    region: en.region,
    author: cleanOptionalField(fields['auteur']) || en.author,
    publisher: en.publisher,
    illustrator: en.illustrator,
    description:
      en.category === 'BOOK'
        ? cleanWikitext(fields['description'] ?? '') ||
          extractFrDescriptionFallback(content, block) ||
          previousFr?.description ||
          en.description
        : null,
    source:
      en.category === 'BOOK'
        ? cleanWikitext(fields['source'] ?? '') ||
          cleanOptionalField(fields['tome1']) ||
          previousFr?.source ||
          en.source
        : en.source,
    volumes:
      en.category === 'BOOK_COLLECTION'
        ? en.volumes.map((v) => ({
            number: v.number,
            location:
              cleanWikitext(fields[`tome${v.number}`] ?? '') ||
              previousFr?.volumes.find((pv) => pv.number === v.number)?.location ||
              v.location,
          }))
        : [],
  };
}

// ── Repli nom FR: {{Other Languages|fr=...}} sur la page EN ────────────────
// Quelques livres n'ont aucune page FR dédiée (donc pas de langlink) mais le
// wiki EN documente quand même le nom officiel FR via {{Other Languages}}
// (même mécanisme que scrape-enemies.ts) : faute de page FR, il n'y a de
// toute façon aucun autre contenu traduisible (description/source/volumes)
// — seul le nom change, tout le reste reste celui de l'EN.

function extractOtherLanguagesFrName(content: string): string | null {
  const block = extractBracedBlock(content, '{{Other Languages');
  if (!block) return null;
  const fields = parseInfoboxFields(block);
  return cleanOptionalField(fields['fr']);
}

// ── Repli auteur/éditeur/illustrateur: conserve la valeur déjà connue ──────
// Le wiki retire parfois le champ author/publisher/illustrator d'une
// infobox lors d'une réorganisation (l'info reste alors seulement noyée
// dans le texte de description, ex: "written by the folklorist Ella Musk")
// sans que la donnée soit fausse ou obsolète pour autant. Plutôt que de
// tenter de la ré-extraire depuis la description en prose libre (peu
// fiable, cf. NOTE en tête de fichier), on garde la dernière valeur connue
// du cache tant que le nouveau scrape n'en fournit aucune.
function preserveKnownFields(fresh: BookOutput, previous: BookOutput | undefined): BookOutput {
  if (!previous) return fresh;
  return {
    ...fresh,
    author: fresh.author ?? previous.author,
    publisher: fresh.publisher ?? previous.publisher,
    illustrator: fresh.illustrator ?? previous.illustrator,
  };
}

// "previous" vient désormais du fichier de sortie déjà écrit en repo
// (prisma/data/books/<lang>/*.json), pas d'un cache disposable.
function readPreviousOutput(lang: 'en' | 'fr', name: string): BookOutput | undefined {
  const filePath = path.join(OUTPUT_DIR(lang), `${slugify(name)}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

// ── Pipeline: 1 livre ────────────────────────────────────────────────────

async function scrapeBook(pageTitle: string): Promise<CachedBook | null> {
  const { content, frTitle } = await fetchWikitextWithLanglink(pageTitle);
  if (!content) {
    console.warn(`⚠️  "${pageTitle}": page introuvable ou vide, ignorée.`);
    return null;
  }

  let en = parseBookInfoboxEn(pageTitle, content);
  if (!en) {
    console.warn(`⚠️  "${pageTitle}": ni {{Book Infobox}} ni {{Book Collection Infobox}} trouvé, ignorée.`);
    return null;
  }
  en = preserveKnownFields(en, readPreviousOutput('en', en.name));

  let fr: BookOutput | null = null;
  if (frTitle) {
    const frContent = await fetchWikitext(frTitle, FR_API_URL);
    fr = frContent ? parseBookInfoboxFr(frTitle, frContent, en, readPreviousOutput('fr', frTitle)) : null;
    if (!fr) {
      console.warn(`⚠️  "${pageTitle}": page FR "${frTitle}" trouvée mais infobox illisible — fichier fr/ non généré.`);
    }
  } else {
    const frName = extractOtherLanguagesFrName(content);
    if (frName) {
      fr = { ...en, name: frName };
    } else {
      console.warn(`⚠️  "${pageTitle}": pas de langlink FR ni de nom FR documenté — fichier fr/ non généré.`);
    }
  }
  if (fr) fr = preserveKnownFields(fr, readPreviousOutput('fr', fr.name));

  return { pageTitle, en, fr };
}

async function scrapeAll(pageTitles: string[]): Promise<CachedBook[]> {
  const results: CachedBook[] = [];

  for (let i = 0; i < pageTitles.length; i++) {
    console.log(`Scraping "${pageTitles[i]}" (${i + 1}/${pageTitles.length})...`);
    const book = await scrapeBook(pageTitles[i]);
    if (book) results.push(book);
    await sleep(300);
  }

  return results;
}

// ── Bulk (optionnel): catégorie du wiki ──────────────────────────────────
// "Books" et "Book Collections" sont deux catégories distinctes sur le wiki
// (cf. NOTE en tête de fichier) : --fetch-category ne couvre qu'une seule à
// la fois, à lancer séparément pour couvrir l'ensemble de la page Book.

// ── Output ────────────────────────────────────────────────────────────────

function writeBookFiles(books: CachedBook[]) {
  const enDir = OUTPUT_DIR('en');
  const frDir = OUTPUT_DIR('fr');
  fs.mkdirSync(enDir, { recursive: true });
  fs.mkdirSync(frDir, { recursive: true });

  let written = 0;
  let skippedFr = 0;
  for (const book of books) {
    const filename = `${slugify(book.en.name)}.json`;

    fs.writeFileSync(path.join(enDir, filename), JSON.stringify(book.en, null, 2), 'utf-8');

    if (book.fr) {
      fs.writeFileSync(path.join(frDir, filename), JSON.stringify(book.fr, null, 2), 'utf-8');
    } else {
      skippedFr++;
    }
    written++;
  }

  if (skippedFr > 0) {
    console.warn(`⚠️  ${skippedFr} livre(s) sans page FR trouvée (fichier fr/ non écrit).`);
  }
  console.log(`✅ Wrote ${written} book files (en/) to ${enDir}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['--fetch', '--fetch-category'].includes(args[0])) {
    console.error('Usage:');
    console.error('  Fetch une liste de pages   : npx ts-node ... scrape-books.ts --fetch "Nom 1" "Nom 2"');
    console.error('  Fetch une catégorie entière: npx ts-node ... scrape-books.ts --fetch-category "Books"');
    console.error('                               npx ts-node ... scrape-books.ts --fetch-category "Book Collections"');
    process.exit(1);
  }

  const pageTitles =
    args[0] === '--fetch-category' ? await fetchCategoryMembers(args[1]) : args.slice(1);

  if (pageTitles.length === 0) {
    console.error('❌ Aucune page à scraper (liste vide).');
    process.exit(1);
  }

  const books = await scrapeAll(pageTitles);

  writeBookFiles(books);
}

main();
