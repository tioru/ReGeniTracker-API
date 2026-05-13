import { Controller, Get, Param, Query } from '@nestjs/common';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll(@Query('lang') lang: string = 'en') {
    return this.materialsService.findAll(lang);
  }
  
  @Get(':name')
  findOne(
    @Param('name') name: string,
    @Query('lang') lang: string = 'en'
  ) {
    return this.materialsService.findOne(name, lang);
  }
}
