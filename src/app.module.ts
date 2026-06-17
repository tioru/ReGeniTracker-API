import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CharactersModule } from './characters/characters.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AssetsModule } from './assets/assets.module';
import { MaterialsModule } from './materials/materials.module';
import { WeaponsModule } from './weapons/weapons.module';
import { BannersController } from './banners/banners.controller';
import { BannersService } from './banners/banners.service';
import { BannersModule } from './banners/banners.module';

@Module({
  imports: [
    PrismaModule,
    CharactersModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'assets'),
      serveRoot: '/assets',
    }),
    AssetsModule,
    MaterialsModule,
    WeaponsModule,
    BannersModule,
  ],
  controllers: [AppController, BannersController],
  providers: [AppService, BannersService],
})
export class AppModule {}
