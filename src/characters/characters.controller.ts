import { Controller, Get, Param, Query } from '@nestjs/common';
import { CharactersService } from './characters.service';

@Controller('characters')
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get()
  findAll(@Query('lang') lang: string = 'en') {
    return this.charactersService.findAll(lang);
  }

  @Get(':name')
  findOne(
    @Param('name') name: string,
    @Query('lang') lang: string = 'en'
  ) {
    return this.charactersService.findOne(name, lang);
  }
}