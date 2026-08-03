import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { BannerHelper } from './bannerHelper';
import { BannerData } from '../../../../src/model/data/banner/banner';
import { NormalizedBannerData } from '../../../../src/model/data/banner/normalizedBanner';
import { NormalizedEntryData } from '../../../../src/model/data/banner/normalizedEntry';
import { WeaponRaritySplitData } from '../../../../src/model/data/banner/weaponRaritySplit';
import { CharacterRaritySplitData } from '../../../../src/model/data/banner/characterRaritySplit';
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

const RARITY_MAP: Record<string, number> = {
  featured3Star: 3,
  featured4Star: 4,
  featured5Star: 5,
};

const TYPE_MAP: Record<BannerData['type'], NormalizedBannerData['type']> = {
  character: 'CHARACTER',
  weapon: 'WEAPON',
  novice: 'NOVICE',
  standard: 'STANDARD',
  chronicled: 'CHRONICLED',
};

const MECHANIC_MAP: Record<NonNullable<BannerData['mechanic']>, NonNullable<NormalizedBannerData['mechanic']>> = {
  chronicled: 'CHRONICLED',
  lightrace: 'LIGHTRACE',
};

// Alias de noms de personnages FR -> EN non dérivables automatiquement (accents
// et ordre des mots sont gérés par normalizeToken ; ceci ne couvre que les cas
// où le nom FR est une vraie traduction distincte). Pas de source fiable pour
// les dériver en masse : prisma/data/characters/ ne contient encore que Mona
// (cf. tableau de bord "État de prisma/data"), donc pas de table de traduction
// des noms de personnages à interroger comme pour les armes (buildWeaponFrNameMap
// ci-dessous). Complété au fil des occurrences trouvées par le warning de
// pairForLanguage plutôt que deviné à l'avance.
const CHARACTER_NAME_ALIASES_FR_TO_EN: Record<string, string> = {
  Nomade: 'Wanderer',
  Mizuki: 'Yumemizuki Mizuki',
};

function normalizeToken(name: string, aliases?: Record<string, string>): string {
  const aliased = (aliases && aliases[name]) || name;
  return aliased
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export class BannerHelperImpl implements BannerHelper {
    loadJson(fullPath: string): BannerData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as BannerData;
    }

    public async buildWeaponFrNameMap(prisma: PrismaClient): Promise<Map<string, string>> {
        const translations = await prisma.weaponTranslation.findMany({
            where: { language: 'fr' },
            include: { weapon: true },
        });
        return new Map(translations.map((t) => [t.name, t.weapon.name]));
    }

    // Empreinte de contenu utilisée pour associer un fichier EN à son équivalent
    // FR (dont le nom de fichier est traduit, cf. NOTE dans bannerHelper.ts) :
    // date de sortie + nom(s) du/des personnage(s) 5★ mis en avant, langue-
    // invariants une fois les noms d'armes retraduits vers l'EN (les noms de
    // personnages ne le nécessitent presque jamais, cf. CHARACTER_NAME_ALIASES_FR_TO_EN
    // pour les rares exceptions).
    public computeFingerprint(bannerData: BannerData, weaponFrNameMap: Map<string, string>): string {
        const translateWeapon = (name: string) => weaponFrNameMap.get(name) ?? name;
        const translateCharacter = (name: string) => normalizeToken(name, CHARACTER_NAME_ALIASES_FR_TO_EN);

        let names: string[];
        switch (bannerData.type) {
            case 'character':
                names = asArray(bannerData.boostedCharacters?.featured5Star).map(translateCharacter);
                break;
            case 'weapon':
                names = asArray(bannerData.boostedWeapons?.featured5Star).map(translateWeapon).map((n) => normalizeToken(n));
                break;
            default: // novice, standard, chronicled : pas de distinction boosted/other
                names = asArray(bannerData.characters?.featured5Star).map(translateCharacter);
                break;
        }
        return bannerData.releaseDate + '|' + names.sort().join(',');
    }

    public normalize(bannerData: BannerData): NormalizedBannerData {
        const characters: NormalizedEntryData[] = [];
        const weapons: NormalizedEntryData[] = [];

        switch (bannerData.type) {
            case 'character':
                this.flattenCharacterSplit(bannerData.boostedCharacters, 'BOOSTED', characters);
                this.flattenCharacterSplit(bannerData.otherCharacters, 'OTHER', characters);
                this.flattenWeaponSplit(bannerData.weapons, 'OTHER', weapons);
                break;
            case 'weapon':
                this.flattenWeaponSplit(bannerData.boostedWeapons, 'BOOSTED', weapons);
                this.flattenWeaponSplit(bannerData.otherWeapons, 'OTHER', weapons);
                this.flattenCharacterSplit(bannerData.characters, 'OTHER', characters);
                break;
            case 'novice':
            case 'standard':
                // Bannières permanentes : un seul pool à odds de base, aucune
                // notion de rate-up (mêmes semantics que otherCharacters/otherWeapons
                // ci-dessus).
                this.flattenCharacterSplit(bannerData.characters, 'OTHER', characters);
                this.flattenWeaponSplit(bannerData.weapons, 'OTHER', weapons);
                break;
            case 'chronicled':
                // Pas de rate-up individuel non plus, mais contrairement à
                // novice/standard ce groupe restreint est bien mis en avant par
                // rapport au pool général (odds élevées pour tous, à égalité) :
                // BOOSTED reflète mieux cette réalité que OTHER.
                this.flattenCharacterSplit(bannerData.characters, 'BOOSTED', characters);
                this.flattenWeaponSplit(bannerData.weapons, 'BOOSTED', weapons);
                break;
        }

        return {
            name: bannerData.name,
            type: TYPE_MAP[bannerData.type],
            releaseDate: new Date(bannerData.releaseDate),
            endDate: bannerData.endDate ? new Date(bannerData.endDate) : null,
            mechanic: bannerData.mechanic ? MECHANIC_MAP[bannerData.mechanic] : null,
            characters,
            weapons,
        };
    }

    public verifyConsistency(reference: NormalizedBannerData, other: NormalizedBannerData, language: string): void {
        if (reference.type !== other.type) {
            console.warn(`⚠️  [${language}] Type différent pour "${reference.name}": ${reference.type} vs ${other.type}`);
        }
        if (reference.releaseDate.getTime() !== other.releaseDate.getTime()) {
            console.warn(`⚠️  [${language}] releaseDate différente pour "${reference.name}"`);
        }
        const refEndTime = reference.endDate?.getTime() ?? null;
        const otherEndTime = other.endDate?.getTime() ?? null;
        if (refEndTime !== otherEndTime) {
            console.warn(`⚠️  [${language}] endDate différente pour "${reference.name}"`);
        }
        if (reference.mechanic !== other.mechanic) {
            console.warn(`⚠️  [${language}] mechanic différent pour "${reference.name}": ${reference.mechanic} vs ${other.mechanic}`);
        }

        this.compareEntryLists(reference.characters, other.characters, language, reference.name, 'characters');
        this.compareEntryLists(reference.weapons, other.weapons, language, reference.name, 'weapons');
    }

    private async charactersRecreate(prisma: PrismaClient, bannerId: number, entries: NormalizedEntryData[]): Promise<void> {
        await prisma.bannerCharacter.deleteMany({ where: { bannerId } });

        for (const entry of entries) {
            const character = await prisma.character.findUnique({ where: { name: entry.name }, select: { id: true } });
            if (!character) {
                console.warn(`⚠️  Personnage introuvable : "${entry.name}"`);
                continue;
            }
            await prisma.bannerCharacter.create({
                data: { bannerId, characterId: character.id, rarity: entry.rarity, role: entry.role },
            });
        }
    }

    private async weaponsRecreate(prisma: PrismaClient, bannerId: number, entries: NormalizedEntryData[]): Promise<void> {
        await prisma.bannerWeapon.deleteMany({ where: { bannerId } });

        for (const entry of entries) {
            const weapon = await prisma.weapon.findUnique({ where: { name: entry.name }, select: { id: true } });
            if (!weapon) {
                console.warn(`⚠️  Arme introuvable : "${entry.name}"`);
                continue;
            }
            await prisma.bannerWeapon.create({
                data: { bannerId, weaponId: weapon.id, rarity: entry.rarity, role: entry.role },
            });
        }
    }

    private async translationsRecreate(prisma: PrismaClient, bannerId: number, translations: { language: string; bannerData: BannerData}[]): Promise<void> {
        for (const { language, bannerData } of translations) {
            await prisma.bannerTranslation.upsert({
                where: { bannerId_language: { bannerId, language } },
                update: { name: bannerData.name },
                create: { bannerId, language, name: bannerData.name },
            });
        }
    }

    private flattenCharacterSplit(split: CharacterRaritySplitData | undefined, role: 'BOOSTED' | 'OTHER', out: NormalizedEntryData[]): void {
        if (!split) return;
        for (const [rarityKey, value] of Object.entries(split)) {
            const rarity = RARITY_MAP[rarityKey];
            const names = Array.isArray(value) ? value : [value];
            for (const name of names as string[]) {
                out.push({ name, rarity, role });
            }
        }
    }

    private flattenWeaponSplit(split: WeaponRaritySplitData | undefined, role: 'BOOSTED' | 'OTHER', out: NormalizedEntryData[]): void {
        if (!split) return;
        for (const [rarityKey, names] of Object.entries(split)) {
            const rarity = RARITY_MAP[rarityKey];
            for (const name of names as string[]) {
                out.push({ name, rarity, role });
            }
        }
    }

    private compareEntryLists(reference: NormalizedEntryData[], other: NormalizedEntryData[], language: string, bannerName: string, listLabel: string): void {
        if (reference.length !== other.length) {
            console.warn(
                `⚠️  [${language}] Nombre de ${listLabel} différent pour "${bannerName}": EN=${reference.length}, ${language}=${other.length}`,
            );
        }
        const len = Math.min(reference.length, other.length);
        for (let i = 0; i < len; i++) {
            const ref = reference[i];
            const oth = other[i];
            if (ref.rarity !== oth.rarity || ref.role !== oth.role) {
                console.warn(
                    `⚠️  [${language}] Incohérence ${listLabel} #${i} pour "${bannerName}": EN="${ref.name}" (${ref.rarity}★, ${ref.role}) vs ${language}="${oth.name}" (${oth.rarity}★, ${oth.role})`,
                );
            }
        }
    }

    public async seedBanner(prisma: PrismaClient, translations: { language: string; bannerData: BannerData }[]): Promise<void> {
        const refData = translations[ENGLISH_INDEX].bannerData;
        const reference = this.normalize(refData);

        for (let i = 0; i < translations.length; i++) {
            if (i === ENGLISH_INDEX) continue;
            const { language, bannerData } = translations[i];
            const normalized = this.normalize(bannerData);
            this.verifyConsistency(reference, normalized, language);
        }

        const banner = await prisma.banner.upsert({
            where: { name_releaseDate: { name: reference.name, releaseDate: reference.releaseDate } },
            update: {
                type: reference.type,
                endDate: reference.endDate,
                mechanic: reference.mechanic,
            },
            create: {
                name: reference.name,
                type: reference.type,
                releaseDate: reference.releaseDate,
                endDate: reference.endDate,
                mechanic: reference.mechanic,
            },
        });

        await this.charactersRecreate(prisma, banner.id, reference.characters);
        console.log(`BannerCharacters recreated (${reference.characters.length})`);

        await this.weaponsRecreate(prisma, banner.id, reference.weapons);
        console.log(`BannerWeapons recreated (${reference.weapons.length})`);

        await this.translationsRecreate(prisma, banner.id, translations);
        console.log(`BannerTranslations upserted (${translations.map((t) => t.language).join(', ')})`);
    }
}
