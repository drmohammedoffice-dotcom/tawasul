export type SmartReplyInput = {
  latestMessage: string;
  recentMessages: string[];
  maxSuggestions?: number;
};

export type SmartReplyResult = {
  suggestions: string[];
  provider: string;
};

export interface SmartReplyProvider {
  suggestReplies(input: SmartReplyInput): Promise<SmartReplyResult>;
}
