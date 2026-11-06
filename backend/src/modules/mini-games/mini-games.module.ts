import { Module } from '@nestjs/common';
import { MiniGamesController } from './mini-games.controller';
import { MiniGamesService } from './mini-games.service';

@Module({
  controllers: [MiniGamesController],
  providers: [MiniGamesService],
  exports: [MiniGamesService]
})
export class MiniGamesModule {}
