import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuditInput = {
  actorUserId?: string;
  actorIp: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: 'success' | 'failure';
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorIp: event.actorIp,
        action: event.action,
        resourceType: event.resourceType,
        actorUserId: event.actorUserId ?? null,
        resourceId: event.resourceId ?? null,
        outcome: event.outcome,
        metadata: sanitizeMetadata(event.metadata) as Prisma.InputJsonValue
      }
    });
  }
}

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const lower = k.toLowerCase();
    if (
      lower.includes('content') ||
      lower.includes('message') ||
      lower.includes('cipher') ||
      lower.includes('token')
    ) {
      continue;
    }
    result[k] = v;
  }
  return result;
}
