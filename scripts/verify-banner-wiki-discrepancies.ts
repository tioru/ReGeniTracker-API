// scripts/verify-banner-wiki-discrepancies.ts
//
// Reprend l'audit EN/FR des bannières (89 écarts de contenu recensés le
// 2026-07-28, cf. artefact "État de prisma/data") et tranche chaque cas non
// vérifié en re-scrapant les pages wiki EN+FR ACTUELLES avec la même logique
// que scrape-banners.ts (mêmes fonctions, réutilisées via import — aucune
// donnée de jeu minée n'entre en jeu : la composition d'une bannière n'a
// jamais existé dans AnimeGameData, vérifié par recherche plein texte et par
// historique de commit sur ExcelBinOutput/GachaConfigExcelConfigData.json,
// 0 résultat les deux fois, aujourd'hui comme historiquement).
//
// Méthode identique à celle déjà utilisée manuellement pour les 2 cas
// confirmés (Jahoda, Calamity Queller) : si le nom manque encore d'un côté
// après re-scraping, c'est une vraie divergence de la page wiki source, pas
// un bug local — rien à corriger côté code. Si le nom apparaît désormais des
// deux côtés, la page manquante a été complétée depuis l'audit et l'écart
// s'est résorbé tout seul.
//
// Traduction des noms pour comparer les rosters :
// - Armes : lookup local prisma/data/weapons/{en,fr} (233/233, déjà utilisé
//   par scrape-banners.ts pour "Beginners' Wish").
// - Personnages : pas de lookup local exploitable (1 seul personnage
//   modélisé, Mona) — résolu via le lien interlangue MediaWiki EN->FR de
//   chaque page personnage (prop=langlinks), mis en cache par nom pour ne
//   l'interroger qu'une fois par personnage sur l'ensemble du run.
//
// Usage :
//   npx ts-node -r tsconfig-paths/register scripts/verify-banner-wiki-discrepancies.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  scrapeBannerOccurrenceEn,
  scrapeBannerOccurrenceFr,
  fetchAllOccurrencesViaPrefix,
  fetchLanglinkTitle,
  loadWeaponNameMaps,
  type BannerData,
  type CharacterBannerData,
  type WeaponBannerData,
  type ChronicledBannerData,
} from './scrape-banners';

const BANNERS_ROOT = path.resolve(__dirname, '../prisma/data/banners');
const REPORT_PATH = path.resolve(
  __dirname,
  './cache/banners-wiki-verification-report.json',
);

// ── Les 89 écarts recensés dans l'audit du 2026-07-28 ───────────────────────
// (source : onglet "Bannières" de l'artefact d'état du repo — 11 déjà
// vérifiés manuellement, 78 non vérifiés individuellement à l'époque)

interface KnownDiscrepancy {
  type: 'characters' | 'weapons' | 'unusual';
  name: string;
  side: 'EN' | 'FR' | '?';
  enFile: string;
  frFile: string;
}

const KNOWN_DISCREPANCIES: KnownDiscrepancy[] = [
  { type: 'characters', name: 'Aino', side: 'FR', enFile: 'piercing_shots_crimson_wake_2026-04-08.json', frFile: 'transpercement_au_sillage_ecarlate_2026-04-08.json' },
  { type: 'characters', name: 'Aino', side: 'FR', enFile: 'ya_hoho_compendium_2026-04-08.json', frFile: 'compendium_ya_hoho_2026-04-08.json' },
  { type: 'characters', name: 'Barbara', side: 'FR', enFile: 'discerner_of_enigmas_2022-05-31.json', frFile: 'discerneuse_denigmes_2022-05-31.json' },
  { type: 'characters', name: 'Barbara', side: 'FR', enFile: 'invitation_to_mundane_life_2022-05-31.json', frFile: 'invitation_scintillante_2022-05-31.json' },
  { type: 'characters', name: 'Beidou', side: 'EN', enFile: 'immaculate_pulse_2023-11-08.json', frFile: 'pouls_immacule_2023-11-08.json' },
  { type: 'characters', name: 'Bennett', side: 'EN', enFile: 'born_of_ocean_swell_2021-11-24.json', frFile: 'flots_dansants_2021-11-24.json' },
  { type: 'characters', name: 'Candace', side: 'FR', enFile: 'la_chanson_cerise_2026-03-17.json', frFile: 'la_chanson_cerise_2026-03-17.json' },
  { type: 'characters', name: 'Candace', side: 'EN', enFile: 'the_transcendent_one_returns_2025-06-18.json', frFile: 'retour_de_la_sublimee_2025-06-18.json' },
  { type: 'characters', name: 'Candace', side: 'EN', enFile: 'void_stars_advent_2025-06-18.json', frFile: 'avenement_de_letoile_du_neant_2025-06-18.json' },
  { type: 'characters', name: 'Candace', side: 'FR', enFile: 'void_stars_advent_2026-03-17.json', frFile: 'avenement_de_letoile_du_neant_2026-03-17.json' },
  { type: 'characters', name: 'Collei', side: 'EN', enFile: 'immaculate_pulse_2023-11-08.json', frFile: 'pouls_immacule_2023-11-08.json' },
  { type: 'characters', name: 'Diona', side: 'FR', enFile: 'everbloom_violet_2022-02-16.json', frFile: 'infinite_violette_2022-02-16.json' },
  { type: 'characters', name: 'Diona', side: 'FR', enFile: 'invitation_to_mundane_life_2021-02-03.json', frFile: 'invitation_scintillante_2021-02-03.json' },
  { type: 'characters', name: 'Diona', side: 'FR', enFile: 'moment_of_bloom_2021-11-02.json', frFile: 'floraison_ecarlate_2021-11-02.json' },
  { type: 'characters', name: 'Diona', side: 'EN', enFile: 'the_transcendent_one_returns_2025-06-18.json', frFile: 'retour_de_la_sublimee_2025-06-18.json' },
  { type: 'characters', name: 'Diona', side: 'EN', enFile: 'void_stars_advent_2025-06-18.json', frFile: 'avenement_de_letoile_du_neant_2025-06-18.json' },
  { type: 'characters', name: 'Dori', side: 'FR', enFile: 'the_moongrass_enlightenment_2023-04-12.json', frFile: 'dessillement_de_lherbe_lunaire_2023-04-12.json' },
  { type: 'characters', name: 'Dori', side: 'FR', enFile: 'twirling_lotus_2023-04-12.json', frFile: 'lotus_tournoyant_2023-04-12.json' },
  { type: 'characters', name: 'Gaming', side: 'FR', enFile: 'cornucopia_of_contention_2025-12-23.json', frFile: 'cornucopia_de_la_discorde_2025-12-23.json' },
  { type: 'characters', name: 'Gaming', side: 'FR', enFile: 'forgefires_blessing_2025-12-23.json', frFile: 'faveur_du_feu_forge_2025-12-23.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'azure_excursion_2022-12-27.json', frFile: 'excursion_azuree_2022-12-27.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'reign_of_serenity_2022-12-27.json', frFile: 'regne_de_serenite_2022-12-27.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'reign_of_serenity_2024-09-17.json', frFile: 'regne_de_serenite_2024-09-17.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'reign_of_serenity_2025-05-27.json', frFile: 'regne_de_serenite_2025-05-27.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'seeker_of_flame_wrought_secrets_2024-09-17.json', frFile: 'recherche_de_secrets_nes_du_feu_2024-09-17.json' },
  { type: 'characters', name: 'Kujou Sara', side: 'FR', enFile: 'seeker_of_flame_wrought_secrets_2025-05-27.json', frFile: 'recherche_de_secrets_nes_du_feu_2025-05-27.json' },
  { type: 'characters', name: 'Noelle', side: 'EN', enFile: 'born_of_ocean_swell_2021-11-24.json', frFile: 'flots_dansants_2021-11-24.json' },
  { type: 'characters', name: 'Ororon', side: 'FR', enFile: 'piercing_shots_crimson_wake_2025-08-19.json', frFile: 'transpercement_au_sillage_ecarlate_2025-08-19.json' },
  { type: 'characters', name: 'Ororon', side: 'FR', enFile: 'sharktacular_surfari_2025-08-19.json', frFile: 'surfari_requinfini_2025-08-19.json' },
  { type: 'characters', name: 'Prune', side: 'EN', enFile: 'ancient_flame_ablaze_2026-06-09.json', frFile: 'embrasement_du_feu_ancien_2026-06-09.json' },
  { type: 'characters', name: 'Prune', side: 'EN', enFile: 'frostedge_nocturne_2026-06-09.json', frFile: 'nocturne_sur_le_fil_du_givre_2026-06-09.json' },
  { type: 'characters', name: 'Prune', side: 'FR', enFile: 'reign_of_serenity_2026-07-21.json', frFile: 'regne_de_serenite_2026-07-21.json' },
  { type: 'characters', name: 'Prune', side: 'FR', enFile: 'somnias_a_luna_2026-07-21.json', frFile: 'reve_sous_lombre_lunaire_2026-07-21.json' },
  { type: 'characters', name: 'Razor', side: 'FR', enFile: 'angels_reverie_2026-05-20.json', frFile: 'reverie_de_lange_2026-05-20.json' },
  { type: 'characters', name: 'Razor', side: 'FR', enFile: 'rubedo_of_white_stone_born_2026-05-20.json', frFile: 'rubedo_ne_de_pierre_blanche_2026-05-20.json' },
  { type: 'characters', name: 'Rosalia', side: 'FR', enFile: 'gentry_of_hermitage_2025-11-11.json', frFile: 'monts_et_marches_2025-11-11.json' },
  { type: 'characters', name: 'Rosalia', side: 'FR', enFile: 'the_hearths_ashen_shadow_2025-11-11.json', frFile: 'lombre_cendree_de_latre_2025-11-11.json' },
  { type: 'characters', name: 'Rosaria', side: 'EN', enFile: 'born_of_ocean_swell_2021-11-24.json', frFile: 'flots_dansants_2021-11-24.json' },
  { type: 'characters', name: 'Sayu', side: 'FR', enFile: 'the_herons_court_2022-04-19.json', frFile: 'prestance_du_heron_2022-04-19.json' },
  { type: 'characters', name: 'Thomas', side: 'FR', enFile: 'everbloom_violet_2022-11-18.json', frFile: 'infinite_violette_2022-11-18.json' },
  { type: 'characters', name: 'Thomas', side: 'FR', enFile: 'farewell_of_snezhnaya_2022-11-18.json', frFile: 'adieux_au_nord_2022-11-18.json' },
  { type: 'characters', name: 'Xiangling', side: 'FR', enFile: 'ancient_flame_ablaze_2026-06-09.json', frFile: 'embrasement_du_feu_ancien_2026-06-09.json' },
  { type: 'characters', name: 'Xiangling', side: 'FR', enFile: 'frostedge_nocturne_2026-06-09.json', frFile: 'nocturne_sur_le_fil_du_givre_2026-06-09.json' },
  { type: 'characters', name: 'Xiangling', side: 'FR', enFile: 'the_lone_light_knocks_at_night_2026-02-25.json', frFile: 'lumiere_solitaire_en_visite_nocturne_2026-02-25.json' },
  { type: 'characters', name: 'Xiangling', side: 'FR', enFile: 'the_northerly_winds_song_of_triumph_2026-02-25.json', frFile: 'chant_triomphal_du_vent_du_nord_2026-02-25.json' },
  { type: 'characters', name: 'Xingqiu', side: 'FR', enFile: 'decree_of_the_deeps_2024-04-02.json', frFile: 'decret_des_profondeurs_2024-04-02.json' },
  { type: 'characters', name: 'Xingqiu', side: 'FR', enFile: 'leaves_in_the_wind_2024-04-02.json', frFile: 'feuilles_dans_le_vent_2024-04-02.json' },
  { type: 'characters', name: 'Xinyan', side: 'FR', enFile: 'drifting_luminescence_2022-03-08.json', frFile: 'luminescence_a_la_derive_2022-03-08.json' },
  { type: 'characters', name: 'Xinyan', side: 'FR', enFile: 'reign_of_serenity_2022-03-08.json', frFile: 'regne_de_serenite_2022-03-08.json' },
  { type: 'characters', name: 'Xinyan', side: 'FR', enFile: 'tapestry_of_golden_flames_2022-08-02.json', frFile: 'draperie_detincelles_dorees_2022-08-02.json' },
  { type: 'characters', name: 'Yanfei', side: 'FR', enFile: 'from_ashes_reborn_2022-12-07.json', frFile: 'renaissant_des_cendres_2022-12-07.json' },
  { type: 'characters', name: 'Yanfei', side: 'FR', enFile: 'onis_royale_2022-12-07.json', frFile: 'baroud_doni_2022-12-07.json' },
  { type: 'characters', name: 'Yun Jin', side: 'FR', enFile: 'caution_in_confidence_2023-01-18.json', frFile: 'prudence_en_toute_confidence_2023-01-18.json' },
  { type: 'characters', name: 'Yun Jin', side: 'FR', enFile: 'invitation_to_mundane_life_2023-01-18.json', frFile: 'invitation_scintillante_2023-01-18.json' },
  { type: 'unusual', name: 'Calamity Queller', side: 'FR', enFile: 'remembrance_of_jade_and_stone_2025-01-21.json', frFile: 'memoire_des_jades_et_des_pierres_2025-01-21.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2020-12-01.json', frFile: 'incarnation_divine_2020-12-01.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2020-12-23.json', frFile: 'incarnation_divine_2020-12-23.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2021-01-12.json', frFile: 'incarnation_divine_2021-01-12.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2021-11-24.json', frFile: 'incarnation_divine_2021-11-24.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2022-06-21.json', frFile: 'incarnation_divine_2022-06-21.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2022-10-14.json', frFile: 'incarnation_divine_2022-10-14.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2022-12-07.json', frFile: 'incarnation_divine_2022-12-07.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2022-12-27.json', frFile: 'incarnation_divine_2022-12-27.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2023-01-18.json', frFile: 'incarnation_divine_2023-01-18.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2023-07-25.json', frFile: 'incarnation_divine_2023-07-25.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2023-08-16.json', frFile: 'incarnation_divine_2023-08-16.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-04-02.json', frFile: 'incarnation_divine_2024-04-02.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-04-24.json', frFile: 'incarnation_divine_2024-04-24.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-05-14.json', frFile: 'incarnation_divine_2024-05-14.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-08-06.json', frFile: 'incarnation_divine_2024-08-06.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-08-28.json', frFile: 'incarnation_divine_2024-08-28.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2024-10-29.json', frFile: 'incarnation_divine_2024-10-29.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2025-05-27.json', frFile: 'incarnation_divine_2025-05-27.json' },
  { type: 'weapons', name: '?', side: '?', enFile: 'epitome_invocation_2025-09-30.json', frFile: 'incarnation_divine_2025-09-30.json' },
  { type: 'weapons', name: 'Fréminet', side: 'FR', enFile: 'epitome_invocation_2023-09-27.json', frFile: 'incarnation_divine_2023-09-27.json' },
  { type: 'weapons', name: 'Fréminet', side: 'FR', enFile: 'epitome_invocation_2023-10-17.json', frFile: 'incarnation_divine_2023-10-17.json' },
  { type: 'weapons', name: 'Fréminet', side: 'FR', enFile: 'epitome_invocation_2023-11-08.json', frFile: 'incarnation_divine_2023-11-08.json' },
  { type: 'weapons', name: 'Fréminet', side: 'FR', enFile: 'epitome_invocation_2023-11-28.json', frFile: 'incarnation_divine_2023-11-28.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-01-14.json', frFile: 'incarnation_divine_2026-01-14.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-02-03.json', frFile: 'incarnation_divine_2026-02-03.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-02-25.json', frFile: 'incarnation_divine_2026-02-25.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-03-17.json', frFile: 'incarnation_divine_2026-03-17.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-04-08.json', frFile: 'incarnation_divine_2026-04-08.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-04-28.json', frFile: 'incarnation_divine_2026-04-28.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-05-20.json', frFile: 'incarnation_divine_2026-05-20.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-06-09.json', frFile: 'incarnation_divine_2026-06-09.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-07-01.json', frFile: 'incarnation_divine_2026-07-01.json' },
  { type: 'weapons', name: 'Jahoda', side: 'FR', enFile: 'epitome_invocation_2026-07-21.json', frFile: 'incarnation_divine_2026-07-21.json' },
  { type: 'weapons', name: 'Lynette', side: 'FR', enFile: 'epitome_invocation_2023-11-28.json', frFile: 'incarnation_divine_2023-11-28.json' },
];

// ── Utilitaires ──────────────────────────────────────────────────────────────

function readBannerJson(lang: 'en' | 'fr', subdir: string, file: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(BANNERS_ROOT, lang, subdir, file), 'utf-8'),
  );
}

// Filename repo -> nom du dossier de scraping (mêmes clés que saveBanner())
const SUBDIR_BY_TYPE: Record<string, string> = {
  characters: 'characters',
  weapons: 'weapons',
  unusual: 'unusual',
};

// Format de date de la page wiki EN : AAAA-MM-JJ (identique au releaseDate local)
function toEnPageTitle(name: string, releaseDate: string): string {
  return `${name}/${releaseDate}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Résout le vrai titre de page FR (format de date variable, JJ.MM.AAAA la
// plupart du temps mais pas garanti) en listant les occurrences réelles de la
// série via allpages, puis en matchant sur la date ISO connue.
async function resolveFrPageTitle(
  frSeriesName: string,
  releaseDateIso: string,
): Promise<string | null> {
  const occurrences = await fetchAllOccurrencesViaPrefix(frSeriesName, 'fr');
  for (const title of occurrences) {
    const dateSuffix = title.slice(frSeriesName.length + 1);
    const isoFromDot = dateSuffix.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (isoFromDot) {
      const [, dd, mm, yyyy] = isoFromDot;
      if (`${yyyy}-${mm}-${dd}` === releaseDateIso) return title;
      continue;
    }
    if (dateSuffix === releaseDateIso) return title;
  }
  return null;
}

const characterFrCache = new Map<string, string | null>();
async function resolveCharacterNameFr(enName: string): Promise<string | null> {
  if (characterFrCache.has(enName)) return characterFrCache.get(enName)!;
  let frName: string | null = null;
  try {
    frName = await fetchLanglinkTitle(enName, 'en', 'fr');
  } catch (err: any) {
    console.error(`  ⚠ langlink échoué pour "${enName}": ${err.message}`);
  }
  characterFrCache.set(enName, frName);
  await sleep(200);
  return frName;
}

// ── Comparaison d'un couple de rosters (EN vs FR déjà scrapés en direct) ────

interface FieldDiff {
  field: string;
  missingInEn: string[]; // présent en FR (traduit), absent en EN
  missingInFr: string[]; // présent en EN, absent en FR (traduit)
  untranslatable: string[]; // pas de correspondance EN<->FR trouvée, ignoré du diff
}

async function diffCharacterField(
  field: string,
  enNames: string[],
  frNames: string[],
): Promise<FieldDiff> {
  const untranslatable: string[] = [];
  const frTranslatedToEn = new Map<string, string>(); // frName -> enName résolu
  for (const en of enNames) {
    const fr = await resolveCharacterNameFr(en);
    if (fr) frTranslatedToEn.set(fr, en);
  }
  const enSet = new Set(enNames);
  const frAsEnSet = new Set<string>();
  for (const frName of frNames) {
    const resolved = frTranslatedToEn.get(frName);
    if (resolved) {
      frAsEnSet.add(resolved);
    } else {
      // Le nom FR ne correspond à aucun nom EN déjà connu du roster EN :
      // on tente quand même une résolution directe pour ne pas le perdre.
      untranslatable.push(frName);
    }
  }
  return {
    field,
    missingInEn: [...frAsEnSet].filter((n) => !enSet.has(n)),
    missingInFr: enNames.filter((n) => !frAsEnSet.has(n)),
    untranslatable,
  };
}

function diffWeaponField(
  field: string,
  enNames: string[],
  frNames: string[],
  enToFr: Map<string, string>,
  frNamesKnown: Set<string>,
): FieldDiff {
  const frToEn = new Map<string, string>();
  for (const [en, fr] of enToFr) frToEn.set(fr, en);
  const enSet = new Set(enNames);
  const untranslatable: string[] = [];
  const frAsEnSet = new Set<string>();
  for (const frName of frNames) {
    const resolved = frToEn.get(frName);
    if (resolved) frAsEnSet.add(resolved);
    else if (!frNamesKnown.has(frName)) untranslatable.push(frName);
    else frAsEnSet.add(frName); // nom FR connu mais sans pendant EN mappé (rare)
  }
  return {
    field,
    missingInEn: [...frAsEnSet].filter((n) => !enSet.has(n)),
    missingInFr: enNames.filter((n) => !frAsEnSet.has(n)),
    untranslatable,
  };
}

// ── Traitement d'une paire de bannières ──────────────────────────────────────

interface PairResult {
  enFile: string;
  frFile: string;
  type: string;
  status: 'still-diverges' | 'resolved' | 'error';
  diffs?: FieldDiff[];
  error?: string;
}

async function verifyPair(
  type: 'characters' | 'weapons' | 'unusual',
  enFile: string,
  frFile: string,
  weaponMaps: { enToFr: Map<string, string>; frNames: Set<string> },
): Promise<PairResult> {
  const subdir = SUBDIR_BY_TYPE[type];
  const enJson = readBannerJson('en', subdir, enFile);
  const frJson = readBannerJson('fr', subdir, frFile);

  const enPageTitle = toEnPageTitle(enJson.name, enJson.releaseDate);
  const frPageTitle = await resolveFrPageTitle(frJson.name, frJson.releaseDate);
  if (!frPageTitle) {
    return {
      enFile,
      frFile,
      type,
      status: 'error',
      error: `page FR introuvable pour la série "${frJson.name}" à la date ${frJson.releaseDate}`,
    };
  }

  let freshEn: BannerData | null;
  let freshFr: BannerData | null;
  try {
    freshEn = await scrapeBannerOccurrenceEn(enPageTitle, 'en');
    await sleep(400);
    freshFr = await scrapeBannerOccurrenceFr(frPageTitle, 'fr');
    await sleep(400);
  } catch (err: any) {
    return { enFile, frFile, type, status: 'error', error: err.message };
  }
  if (!freshEn || !freshFr) {
    return {
      enFile,
      frFile,
      type,
      status: 'error',
      error: `type de bannière non détecté sur une des deux pages (EN=${!!freshEn}, FR=${!!freshFr})`,
    };
  }

  const diffs: FieldDiff[] = [];

  if (type === 'characters') {
    const en = freshEn as CharacterBannerData;
    const fr = freshFr as CharacterBannerData;
    diffs.push(
      await diffCharacterField(
        'otherCharacters.featured4Star',
        en.otherCharacters.featured4Star,
        fr.otherCharacters.featured4Star,
      ),
    );
    diffs.push(
      await diffCharacterField(
        'otherCharacters.featured5Star',
        en.otherCharacters.featured5Star,
        fr.otherCharacters.featured5Star,
      ),
    );
  } else if (type === 'weapons') {
    const en = freshEn as WeaponBannerData;
    const fr = freshFr as WeaponBannerData;
    diffs.push(
      await diffCharacterField(
        'characters.featured4Star',
        en.characters.featured4Star,
        fr.characters.featured4Star,
      ),
    );
    diffs.push(
      diffWeaponField(
        'otherWeapons.featured4Star',
        en.otherWeapons.featured4Star,
        fr.otherWeapons.featured4Star,
        weaponMaps.enToFr,
        weaponMaps.frNames,
      ),
    );
    diffs.push(
      diffWeaponField(
        'otherWeapons.featured5Star',
        en.otherWeapons.featured5Star,
        fr.otherWeapons.featured5Star,
        weaponMaps.enToFr,
        weaponMaps.frNames,
      ),
    );
  } else {
    const en = freshEn as ChronicledBannerData;
    const fr = freshFr as ChronicledBannerData;
    diffs.push(
      diffWeaponField(
        'weapons.featured5Star',
        en.weapons.featured5Star,
        fr.weapons.featured5Star,
        weaponMaps.enToFr,
        weaponMaps.frNames,
      ),
    );
    diffs.push(
      diffWeaponField(
        'weapons.featured4Star',
        en.weapons.featured4Star,
        fr.weapons.featured4Star,
        weaponMaps.enToFr,
        weaponMaps.frNames,
      ),
    );
    diffs.push(
      await diffCharacterField(
        'characters.featured5Star',
        en.characters.featured5Star,
        fr.characters.featured5Star,
      ),
    );
    diffs.push(
      await diffCharacterField(
        'characters.featured4Star',
        en.characters.featured4Star,
        fr.characters.featured4Star,
      ),
    );
  }

  // `untranslatable` compte aussi comme divergence : un nom FR sans aucun
  // équivalent EN trouvé dans le roster EN (ou vice versa côté armes) veut
  // dire concrètement que ce nom manque toujours d'un côté — vérifié en
  // pratique le 2026-08-12 (ex. "Jahoda" catégorisé untranslatable alors que
  // le roster EN ne contient tout simplement pas son équivalent).
  const stillDiverges = diffs.some(
    (d) =>
      d.missingInEn.length > 0 ||
      d.missingInFr.length > 0 ||
      d.untranslatable.length > 0,
  );

  return {
    enFile,
    frFile,
    type,
    status: stillDiverges ? 'still-diverges' : 'resolved',
    diffs: diffs.filter(
      (d) =>
        d.missingInEn.length > 0 ||
        d.missingInFr.length > 0 ||
        d.untranslatable.length > 0,
    ),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const uniquePairs = new Map<
    string,
    { type: 'characters' | 'weapons' | 'unusual'; enFile: string; frFile: string }
  >();
  for (const d of KNOWN_DISCREPANCIES) {
    uniquePairs.set(`${d.enFile}|${d.frFile}`, {
      type: d.type,
      enFile: d.enFile,
      frFile: d.frFile,
    });
  }

  console.log(`${uniquePairs.size} paires de bannières uniques à revérifier...`);
  const weaponMaps = loadWeaponNameMaps();

  const results: PairResult[] = [];
  let i = 0;
  for (const { type, enFile, frFile } of uniquePairs.values()) {
    i++;
    console.log(`[${i}/${uniquePairs.size}] ${enFile} <-> ${frFile}`);
    const result = await verifyPair(type, enFile, frFile, weaponMaps);
    results.push(result);
    if (result.status === 'error') console.error(`  ❌ ${result.error}`);
    else if (result.status === 'resolved') console.log(`  ✅ résorbé depuis l'audit`);
    else console.log(`  ⚠️  diverge toujours`);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2), 'utf-8');

  const stillDiverges = results.filter((r) => r.status === 'still-diverges').length;
  const resolved = results.filter((r) => r.status === 'resolved').length;
  const errors = results.filter((r) => r.status === 'error').length;
  console.log(
    `\nTerminé : ${stillDiverges} divergent encore, ${resolved} résorbées, ${errors} erreurs.`,
  );
  console.log(`Rapport : ${REPORT_PATH}`);
}

main();
