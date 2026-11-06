import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({
  imports: [WalletModule, MessagingModule],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService]
})
export class GiftsModule {}
