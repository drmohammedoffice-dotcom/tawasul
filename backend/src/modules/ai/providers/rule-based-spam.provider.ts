import { Injectable } from '@nestjs/common';
import { SpamDetector, SpamInput, SpamResult } from '../interfaces/spam-detector.interface';

@Injectable()
export class RuleBasedSpamProvider implements SpamDetector {
  async evaluate(input: SpamInput): Promise<SpamResult> {
    const text = input.text.trim();
    let score = 0;
    const reasons: string[] = [];

    if (text.length > 5000) {
      score += 30;
      reasons.push('message_too_long');
    }

    if (/(.)\1{10,}/.test(text)) {
      score += 20;
      reasons.push('character_repetition');
    }

    const links = text.match(/https?:\/\/[^\s]+/g)?.length ?? 0;
    if (links >= 3) {
      score += 25;
      reasons.push('too_many_links');
    }

    const keywords = ['free money', 'win now', 'click here', 'guaranteed profit', 'crypto giveaway'];
    const lowered = text.toLowerCase();
    const keywordHits = keywords.filter((word) => lowered.includes(word)).length;
    if (keywordHits > 0) {
      score += keywordHits * 15;
      reasons.push('spam_keywords');
    }

    if (text.length > 0 && text.length < 4) {
      score += 10;
      reasons.push('very_short_message');
    }

    return {
      isSpam: score >= 40,
      score: Math.min(score, 100),
      reasons,
      provider: 'rule-based-spam-provider'
    };
  }
}
