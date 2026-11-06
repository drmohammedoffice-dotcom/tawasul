export type SummarizationInput = {
  messages: string[];
  maxSentences?: number;
};

export type SummarizationResult = {
  summary: string;
  provider: string;
  messageCount: number;
};

export interface SummarizationProvider {
  summarize(input: SummarizationInput): Promise<SummarizationResult>;
}
