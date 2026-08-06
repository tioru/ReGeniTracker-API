import * as fs from 'node:fs';
import { LocationHelper } from "./locationHelper";
import { LocationData } from "../../../../src/model/data/location/location";
import { LocationType, PrismaClient } from "@prisma/client";
import { BUFFER_ENCODING, ENGLISH_INDEX } from '../../../../constants';

const LOCATION_TYPE_MAP: Record<string, LocationType> = {
    Nation: LocationType.NATION,
    Subregion: LocationType.SUBREGION,
    Area: LocationType.AREA,
    Subarea: LocationType.SUBAREA,
};

export class LocationHelperImpl implements LocationHelper {
    public loadJson(fullPath: string): LocationData {
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as LocationData;
    }

    public async upsertLocation(prisma: PrismaClient, locationData: LocationData): Promise<{ id: number }> {
        const type = LOCATION_TYPE_MAP[locationData.type];
        return prisma.location.upsert({
            where: { name: locationData.name },
            update: {
              type,
            },
            create: {
              name: locationData.name,
              type,
            },
        });
    }

    public async upsertLocationTranslations(prisma: PrismaClient, locationId: number, translations: { language: string; locationData: LocationData }[]): Promise<void> {
        for (const { language, locationData } of translations) {
          await prisma.locationTranslation.upsert({
            where: { locationId_language: { locationId: locationId, language: language } },
            update: {
              name: locationData.name,
              description: locationData.description || null,
              image: locationData.image,
            },
            create: {
              locationId,
              language: language,
              name: locationData.name,
              description: locationData.description || null,
              image: locationData.image,
            },
          });
        }
    }

    public async seedLocation(prisma: PrismaClient, translations: { language: string; locationData: LocationData }[]): Promise<{ id: number }> {
        const location = await this.upsertLocation(prisma, translations[ENGLISH_INDEX].locationData);
        console.log(`Location upserted (id: ${location.id})`);

        await this.upsertLocationTranslations(prisma, location.id, translations);
        console.log(`LocationTranslations upserted (${translations.map((translation) => translation.language).join(', ')})`);

        return location;
    }

    // 2e passe (cf. NOTE en tête de prisma/schema/location.prisma) : résout
    // parentId une fois que TOUTES les localisations existent en base, car
    // l'ordre alphabétique des fichiers ne garantit pas que le parent d'une
    // localisation ait déjà été seedé (ex: une Subarea avant son Area).
    public async linkParent(prisma: PrismaClient, enLocationData: LocationData): Promise<void> {
        if (!enLocationData.parent) return;

        const parent = await prisma.location.findUnique({
            where: { name: enLocationData.parent },
            select: { id: true },
        });

        if (!parent) {
            console.warn(`⚠️  Localisation parente introuvable : "${enLocationData.parent}" (pour "${enLocationData.name}")`);
            return;
        }

        await prisma.location.update({
            where: { name: enLocationData.name },
            data: { parentId: parent.id },
        });
    }
}
