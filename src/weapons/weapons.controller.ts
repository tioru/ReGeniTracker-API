import { Controller, Get, Param, Query } from '@nestjs/common';
import { WeaponsService } from './weapons.service';

const DEFAULT_LANG = "en";

@Controller('weapons')
export class WeaponsController {
  constructor(private readonly weaponsService: WeaponsService) {}

  @Get()
  findAll() {
    return this.weaponsService.findAll();
  }

  @Get(':name')
  findOne(
    @Param('name') name: string, 
    @Query('lang') lang: string = DEFAULT_LANG
  ) {
    try {
      return this.weaponsService.findOne(name, lang);
    } catch (error: any) {
      console.error(error);
    }
  }
}