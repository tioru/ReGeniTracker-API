import { Controller, Get, Param, Query } from '@nestjs/common';
import { CharactersService } from './characters.service';

const DEFAULT_LANG = "en";

@Controller('characters')
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get()
  findAll() {
    return this.charactersService.findAll();
  }

  @Get(':name')
  findOne(
    @Param('name') name: string,
    @Query('lang') lang: string = DEFAULT_LANG
  ) {
    try {
      return this.charactersService.findOne(name, lang);
    } catch (e: any) {
      console.error(e)
    }
  }
}