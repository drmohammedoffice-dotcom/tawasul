import { Inject, Injectable } from '@nestjs/common';
import {
  AI_SMART_REPLY_PROVIDER,
  AI_SPAM_PROVIDER,
  AI_SUMMARIZATION_PROVIDER,
  AI_TRANSLATION_PROVIDER
} from './ai.tokens';
import {
  SmartReplyInput,
  SmartReplyProvider
} from './interfaces/smart-reply-provider.interface';
import { SpamDetector, SpamInput } from './interfaces/spam-detector.interface';
import { SummarizationInput, SummarizationProvider } from './interfaces/summarization-provider.interface';
import { TranslationInput, TranslationProvider } from './interfaces/translation-provider.interface';

@Injectable()
export class AiService {
  constructor(
    @Inject(AI_TRANSLATION_PROVIDER)
    private readonly translationProvider: TranslationProvider,
    @Inject(AI_SUMMARIZATION_PROVIDER)
    private readonly summarizationProvider: SummarizationProvider,
    @Inject(AI_SPAM_PROVIDER)
    private readonly spamProvider: SpamDetector,
    @Inject(AI_SMART_REPLY_PROVIDER)
    private readonly smartReplyProvider: SmartReplyProvider
  ) {}

  translateMessage(input: TranslationInput) {
    return this.translationProvider.translate(input);
  }

  summarizeChat(input: SummarizationInput) {
    return this.summarizationProvider.summarize(input);
  }

  detectSpam(input: SpamInput) {
    return this.spamProvider.evaluate(input);
  }

  suggestReplies(input: SmartReplyInput) {
    return this.smartReplyProvider.suggestReplies(input);
  }
}
