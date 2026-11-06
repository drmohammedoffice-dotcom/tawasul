import { Injectable } from '@nestjs/common';
import {
  SmartReplyInput,
  SmartReplyProvider,
  SmartReplyResult
} from '../interfaces/smart-reply-provider.interface';

@Injectable()
export class MockSmartReplyProvider implements SmartReplyProvider {
  async suggestReplies(input: SmartReplyInput): Promise<SmartReplyResult> {
    const maxSuggestions = Math.min(Math.max(input.maxSuggestions ?? 3, 1), 5);
    const latest = input.latestMessage.trim().toLowerCase();
    const context = input.recentMessages.join(' ').toLowerCase();
    const suggestions = pickSuggestions(latest, context).slice(0, maxSuggestions);

    return {
      suggestions: dedupe(suggestions),
      provider: 'mock-smart-reply-provider'
    };
  }
}

function pickSuggestions(latest: string, context: string): string[] {
  if (latest.includes('?')) {
    if (/(time|when|schedule|meeting|call)/.test(latest + context)) {
      return [
        'Sounds good. What time works best for you?',
        'I can do later today. Does 6 PM work?',
        'Let me check my schedule and confirm shortly.'
      ];
    }
    if (/(price|cost|pay|subscription|premium)/.test(latest + context)) {
      return [
        'I can share the pricing details in a minute.',
        'Would you like the monthly or yearly option?',
        'I can walk you through the premium benefits.'
      ];
    }
    return ['Yes, that works for me.', 'I am not sure yet, let me confirm.', 'Can you share a bit more detail?'];
  }

  if (/(thanks|thank you|thx)/.test(latest)) {
    return ['You are welcome.', 'Happy to help anytime.', 'Anytime. Let me know if you need anything else.'];
  }

  if (/(sorry|apolog)/.test(latest)) {
    return ['No worries at all.', 'It is completely fine.', 'Thanks for letting me know.'];
  }

  if (/(hello|hi|hey|good morning|good evening)/.test(latest)) {
    return ['Hey! Great to hear from you.', 'Hi! How is your day going?', 'Hello. Want to continue where we left off?'];
  }

  return ['Sounds good.', 'Got it. I will handle it.', 'Perfect, let us move forward with this.'];
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items)).filter(Boolean);
}
