import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { TrackEventDto } from './dto/track-event.dto';

@Injectable()
export class BetaService {
  constructor(private readonly prisma: PrismaService) {}

  async trackEvent(input: {
    userId?: string;
    userAgent?: string;
    data: TrackEventDto;
  }): Promise<void> {
    await this.prisma.betaAnalyticsEvent.create({
      data: {
        userId: input.userId ?? null,
        sessionId: input.data.sessionId,
        eventName: input.data.eventName,
        path: input.data.path,
        userAgent: input.userAgent ?? null,
        metadata: sanitizeMetadata(input.data.metadata) as Prisma.InputJsonValue
      }
    });
  }

  async createFeedback(input: {
    userId?: string;
    data: CreateFeedbackDto;
  }) {
    return this.prisma.feedbackEntry.create({
      data: {
        userId: input.userId ?? null,
        email: input.data.email ?? null,
        category: input.data.category.toLowerCase(),
        message: input.data.message,
        rating: input.data.rating ?? null
      }
    });
  }
}

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (lower.includes('token') || lower.includes('password') || lower.includes('content')) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}
