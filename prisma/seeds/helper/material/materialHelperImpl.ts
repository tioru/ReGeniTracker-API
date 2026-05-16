import fs from "node:fs";
import path from "node:path";
import { MaterialHelper } from "./materialHelper";
import { MaterialData } from "../../model/material/material";

export const BUFFER_ENCODING = 'utf-8';

export class MaterialHelperImpl implements MaterialHelper {
    public loadJson(filePath: string): MaterialData {
        const fullPath = path.resolve(__dirname, filePath);
        return JSON.parse(fs.readFileSync(fullPath, BUFFER_ENCODING)) as MaterialData;
    }
}