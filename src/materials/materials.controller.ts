import { Controller, Get, Param, Query } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const DEFAULT_LANG = "en";

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  async findAll() {
    try {
      return await this.materialsService.findAll();
    } catch (error: any) {
      console.error(error);
    }
  }
  
  @Get(':name')
  async findOne(
    @Param('name') name: string,  
    @Query('lang') language: string = DEFAULT_LANG
  ) {
    try {
      return await this.materialsService.findOne(name, language);
    } catch (error: any) {
      console.error(error);
    }
  }
}
