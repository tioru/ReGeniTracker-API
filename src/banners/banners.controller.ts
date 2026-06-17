import { Controller, Get, Param, Query } from '@nestjs/common';
import { BannersService } from './banners.service';

const DEFAULT_LANG = "en";

@Controller('banners')
export class BannersController {
    constructor(private readonly bannersService: BannersService) {}

    @Get()
    findAll() {
        return this.bannersService.findAll();
    }

    @Get(':name')
    findOne(
        @Param('name') name: string, 
        @Query('lang') lang: string = DEFAULT_LANG
    ) {
        try {
            return this.bannersService.findOne(name, lang);
        } catch (error: any) {
            console.error(error);
        }
    }
}