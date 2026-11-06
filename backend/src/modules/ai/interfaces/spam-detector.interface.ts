export type SpamInput = {
  text: string;
  senderId?: string;
  context: 'private' | 'group' | 'channel' | 'generic';
};

export type SpamResult = {
  isSpam: boolean;
  score: number;
  reasons: string[];
  provider: string;
};

export interface SpamDetector {
  evaluate(input: SpamInput): Promise<SpamResult>;
}
