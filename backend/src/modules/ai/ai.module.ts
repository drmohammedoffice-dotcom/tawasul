import { Global, Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import {
  AI_SMART_REPLY_PROVIDER,
  AI_SPAM_PROVIDER,
  AI_SUMMARIZATION_PROVIDER,
  AI_TRANSLATION_PROVIDER
} from './ai.tokens';
import { MockSmartReplyProvider } from './providers/mock-smart-reply.provider';
import { RuleBasedSpamProvider } from './providers/rule-based-spam.provider';
import { MockSummarizationProvider } from './providers/mock-summarization.provider';
import { MockTranslationProvider } from './providers/mock-translation.provider';
import { TawasulAiClient } from './tawasul-ai.client';

@Global()
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    TawasulAiClient,
    MockTranslationProvider,
    MockSummarizationProvider,
    RuleBasedSpamProvider,
    MockSmartReplyProvider,
    {
      provide: AI_TRANSLATION_PROVIDER,
      useExisting: MockTranslationProvider
    },
    {
      provide: AI_SUMMARIZATION_PROVIDER,
      useExisting: MockSummarizationProvider
    },
    {
      provide: AI_SPAM_PROVIDER,
      useExisting: RuleBasedSpamProvider
    },
    {
      provide: AI_SMART_REPLY_PROVIDER,
      useExisting: MockSmartReplyProvider
    }
  ],
  exports: [
    AiService,
    TawasulAiClient,
    AI_TRANSLATION_PROVIDER,
    AI_SUMMARIZATION_PROVIDER,
    AI_SPAM_PROVIDER,
    AI_SMART_REPLY_PROVIDER
  ]
})
export class AiModule {}
