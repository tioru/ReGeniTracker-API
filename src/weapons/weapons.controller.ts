import { Controller, Get, Param, Query } from '@nestjs/common';
import { WeaponsService } from './weapons.service';
import { DEFAULT_LANG } from '../../constants';

@Controller('weapons')
export class WeaponsController {
  constructor(private readonly weaponsService: WeaponsService) {}

  @Get()
  async findAll() {
    try {
      return await this.weaponsService.findAll();
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
      return await this.weaponsService.findOne(name, lang);
    } catch (error: any) {
      console.error(error);
    }
  }
}