import { Injectable } from '@nestjs/common';
import {
  TranslationInput,
  TranslationProvider,
  TranslationResult
} from '../interfaces/translation-provider.interface';

@Injectable()
export class MockTranslationProvider implements TranslationProvider {
  async translate(input: TranslationInput): Promise<TranslationResult> {
    const sourceLanguage = input.sourceLanguage ?? detectLanguage(input.text);
    const translatedText =
      sourceLanguage === input.targetLanguage
        ? input.text
        : `[mock-${sourceLanguage}->${input.targetLanguage}] ${input.text}`;

    return {
      translatedText,
      sourceLanguage,
      targetLanguage: input.targetLanguage,
      provider: 'mock-translation-provider'
    };
  }
}

function detectLanguage(text: string): string {
  const arabicRegex = /[\u0600-\u06FF]/;
  return arabicRegex.test(text) ? 'ar' : 'en';
}
