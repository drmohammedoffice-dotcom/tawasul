import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AiService } from './ai.service';
import { SmartReplyDto } from './dto/smart-reply.dto';
import { SpamCheckDto } from './dto/spam-check.dto';
import { SummarizeChatDto } from './dto/summarize-chat.dto';
import { TranslateMessageDto } from './dto/translate-message.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('translate')
  async translate(@Body() dto: TranslateMessageDto) {
    const translated = await this.aiService.translateMessage({
      text: dto.text,
      targetLanguage: dto.targetLanguage,
      ...(dto.sourceLanguage ? { sourceLanguage: dto.sourceLanguage } : {})
    });
    return ok('Message translated (mock)', translated);
  }

  @Post('summarize')
  async summarize(@Body() dto: SummarizeChatDto) {
    const summary = await this.aiService.summarizeChat({
      messages: dto.messages,
      ...(dto.maxSentences ? { maxSentences: dto.maxSentences } : {})
    });
    return ok('Chat summarized (mock)', summary);
  }

  @Post('spam-check')
  async spamCheck(@Req() req: { user: JwtPayload }, @Body() dto: SpamCheckDto) {
    const result = await this.aiService.detectSpam({
      text: dto.text,
      senderId: dto.senderId ?? req.user.sub,
      context: dto.context ?? 'generic'
    });
    return ok('Spam check completed (rule-based)', result);
  }

  @Post('smart-replies')
  async smartReplies(@Body() dto: SmartReplyDto) {
    const result = await this.aiService.suggestReplies({
      latestMessage: dto.latestMessage,
      recentMessages: dto.recentMessages,
      ...(dto.maxSuggestions ? { maxSuggestions: dto.maxSuggestions } : {})
    });
    return ok('Smart replies generated (mock)', result);
  }
}
