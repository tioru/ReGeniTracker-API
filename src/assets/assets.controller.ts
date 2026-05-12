import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'mp4', 'webm'];
const ASSETS_DIR = path.join(process.cwd(), 'assets');

@Controller('assets')
export class AssetsController {

  @Get('characters/:name/:file')
  getCharacterAsset(
    @Param('name') name: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    for (const ext of EXTENSIONS) {
      const filePath = path.join(ASSETS_DIR, 'characters', name, `${file}.${ext}`);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
    throw new NotFoundException(`Asset ${file} not found for character ${name}`);
  }

  @Get('materials/:file')
  getMaterialAsset(
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    for (const ext of EXTENSIONS) {
      const filePath = path.join(ASSETS_DIR, 'materials', `${file}.${ext}`);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
    throw new NotFoundException(`Asset ${file} not found for material`);
  }
}