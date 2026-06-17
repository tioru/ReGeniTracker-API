import { Controller, Get, Param, Query } from '@nestjs/common';
import { CharactersService } from './characters.service';

const DEFAULT_LANG = "en";

@Controller('characters')
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get()
  async findAll() {
    try {
      return await this.charactersService.findAll();
    } catch (error: any) {
      console.error(error);
    }
  }

  @Get(':name')
  async findOne(
    @Param('name') name: string,
    @Query('lang') lang: string = DEFAULT_LANG
  ) {
    try {
      return await this.charactersService.findOne(name, lang);
    } catch (error: any) {
      console.error(error);
    } 
  }
}