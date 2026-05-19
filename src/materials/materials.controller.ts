import { Controller, Get, Param, Query } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const DEFAULT_LANG = "en";

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll() {
    return this.materialsService.findAll();
  }
  
  @Get(':name')
  findOne(
    @Param('name') name: string,
    @Query('lang') language: string = DEFAULT_LANG
  ) {
    return this.materialsService.findOne(name, language);
  }
}
