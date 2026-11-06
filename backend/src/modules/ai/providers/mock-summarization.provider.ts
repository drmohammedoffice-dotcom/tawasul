import { Injectable } from '@nestjs/common';
import {
  SummarizationInput,
  SummarizationProvider,
  SummarizationResult
} from '../interfaces/summarization-provider.interface';

@Injectable()
export class MockSummarizationProvider implements SummarizationProvider {
  async summarize(input: SummarizationInput): Promise<SummarizationResult> {
    const cleaned = input.messages.map((m) => m.trim()).filter(Boolean);
    const count = cleaned.length;
    const maxSentences = input.maxSentences ?? 3;

    if (count === 0) {
      return {
        summary: 'No messages available for summary.',
        provider: 'mock-summarization-provider',
        messageCount: 0
      };
    }

    const first = cleaned[0];
    const last = cleaned[count - 1];
    const middle = count > 2 ? cleaned[Math.floor(count / 2)] : '';
    const parts = [first, middle, last].filter(Boolean).slice(0, maxSentences);

    return {
      summary: `Summary (${count} msgs): ${parts.join(' | ')}`,
      provider: 'mock-summarization-provider',
      messageCount: count
    };
  }
}
