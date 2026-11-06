import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { MESSAGING_CHANNELS } from './messaging.constants';

type PubsubHandler = (channel: string, payload: string) => void;

@Injectable()
export class MessagingPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingPubSubService.name);
  private publisher!: Redis;
  private subscriber!: Redis;
  private handlers: PubsubHandler[] = [];

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    this.publisher = this.redisService.duplicateClient();
    this.subscriber = this.redisService.duplicateClient();

    this.subscriber.on('message', (channel, payload) => {
      for (const handler of this.handlers) {
        handler(channel, payload);
      }
    });

    await this.subscriber.subscribe(
      MESSAGING_CHANNELS.MESSAGE_CREATED,
      MESSAGING_CHANNELS.MESSAGE_UPDATED,
      MESSAGING_CHANNELS.MESSAGE_DELETED,
      MESSAGING_CHANNELS.MESSAGE_REACTION,
      MESSAGING_CHANNELS.GIFT_SENT,
      MESSAGING_CHANNELS.USER_TYPING,
      MESSAGING_CHANNELS.PRESENCE_UPDATED,
      MESSAGING_CHANNELS.GROUP_MESSAGE_CREATED,
      MESSAGING_CHANNELS.CHANNEL_MESSAGE_CREATED
    );
    this.logger.log('Messaging pub/sub subscriptions initialized');
  }

  onMessage(handler: PubsubHandler): void {
    this.handlers.push(handler);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(payload));
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    if (this.publisher) {
      await this.publisher.quit();
    }
  }
}
