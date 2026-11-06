export type TranslationInput = {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
};

export type TranslationResult = {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
};

export interface TranslationProvider {
  translate(input: TranslationInput): Promise<TranslationResult>;
}
