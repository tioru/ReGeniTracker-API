import { Controller, Get, Param, Query } from '@nestjs/common';
import { BannersService } from './banners.service';
import { DEFAULT_LANG } from '../../constants';

@Controller('banners')
export class BannersController {
    constructor(private readonly bannersService: BannersService) {}

    @Get()
    async findAll() {
        try {
            return await this.bannersService.findAll();
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
            return await this.bannersService.findOne(name, lang);
        } catch (error: any) {
            console.error(error);
        }
    }
}