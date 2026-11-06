import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { VerificationStatus, VerificationTrack } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { categoryRequiresLicense } from './business-categories';
import { sha256Normalized } from './otp.util';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async myStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVerified: true, verifiedAt: true, accountType: true, businessProfile: true }
    });
    const latest = await this.prisma.verificationRequest.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      include: { documents: { select: { id: true, docType: true, createdAt: true } } }
    });
    return {
      isVerified: user?.isVerified ?? false,
      verifiedAt: user?.verifiedAt ?? null,
      accountType: user?.accountType,
      categoryKey: user?.businessProfile?.categoryKey ?? null,
      requiresLicense: user?.businessProfile
        ? categoryRequiresLicense(user.businessProfile.categoryKey)
        : null,
      request: latest
        ? {
            id: latest.id,
            track: latest.track,
            status: latest.status,
            adminNote: latest.adminNote,
            submittedAt: latest.submittedAt,
            reviewedAt: latest.reviewedAt,
            documents: latest.documents
          }
        : { status: 'not_submitted' as const }
    };
  }

  async submit(
    userId: string,
    input: {
      track: VerificationTrack;
      businessName?: string;
      registrationNumber?: string;
      categoryKey?: string;
      applicantName?: string;
      nationalId?: string;
      documents: Array<{ docType: string; mediaId: string; contentHash: string }>;
      attested: boolean;
    }
  ) {
    if (!input.attested) throw new BadRequestException('attestation required');
    if (!input.documents?.length) throw new BadRequestException('documents required');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true, isVerified: true, businessProfile: true }
    });
    if (!user || user.accountType !== 'business') {
      throw new BadRequestException('business account required');
    }
    if (user.isVerified) throw new BadRequestException('already verified');

    const pending = await this.prisma.verificationRequest.findFirst({
      where: { userId, status: { in: ['pending_review', 'more_info_required'] } }
    });
    if (pending) throw new ConflictException('verification already in progress');

    let registrationHash: string | null = null;
    let identityHash: string | null = null;

    if (input.track === 'licensed_business') {
      if (!input.registrationNumber?.trim()) {
        throw new BadRequestException('registration number required');
      }
      registrationHash = sha256Normalized(input.registrationNumber);
      // Block concurrent/pending reuse as well as approved (race-safe soft lock).
      const clash = await this.prisma.verificationRequest.findFirst({
        where: {
          registrationHash,
          status: { in: ['approved', 'pending_review', 'more_info_required'] },
          userId: { not: userId }
        }
      });
      if (clash) throw new ConflictException('registration already used for another verification');
    } else {
      if (!input.nationalId?.trim()) throw new BadRequestException('national id required');
      identityHash = sha256Normalized(input.nationalId);
      const clash = await this.prisma.verificationRequest.findFirst({
        where: {
          identityHash,
          status: { in: ['approved', 'pending_review', 'more_info_required'] },
          userId: { not: userId }
        }
      });
      if (clash) throw new ConflictException('identity already used for another verification');
    }

    for (const doc of input.documents) {
      const media = await this.prisma.mediaAsset.findFirst({
        where: {
          id: doc.mediaId,
          uploaderId: userId,
          deletedAt: null,
          purpose: { in: ['verification', 'general', 'post'] },
          uploadCompletedAt: { not: null }
        }
      });
      if (!media) throw new BadRequestException(`invalid document media ${doc.mediaId}`);
      if (!doc.contentHash || doc.contentHash.length < 32) {
        throw new BadRequestException('contentHash required');
      }
      const reused = await this.prisma.verificationDocument.findFirst({
        where: {
          contentHash: doc.contentHash,
          request: { status: 'approved', userId: { not: userId } }
        }
      });
      if (reused) throw new ConflictException('document already used for another verification');
    }

    const request = await this.prisma.verificationRequest.create({
      data: {
        userId,
        track: input.track,
        status: 'pending_review',
        businessName: input.businessName?.trim() || user.businessProfile?.businessName || null,
        registrationNumber: input.registrationNumber ? '[redacted]' : null,
        categoryKey: input.categoryKey || user.businessProfile?.categoryKey || null,
        applicantName: input.applicantName?.trim() || null,
        registrationHash,
        identityHash,
        documents: {
          create: input.documents.map((d) => ({
            docType: d.docType,
            mediaId: d.mediaId,
            contentHash: d.contentHash
          }))
        }
      },
      include: { documents: { select: { id: true, docType: true, createdAt: true } } }
    });

    return {
      id: request.id,
      status: request.status,
      track: request.track,
      submittedAt: request.submittedAt,
      documents: request.documents
    };
  }

  /** Admin-only review — never callable as self-approve. */
  async adminReview(
    adminId: string,
    requestId: string,
    input: { status: VerificationStatus; adminNote?: string }
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'admin') throw new ForbiddenException('admin only');

    if (!['approved', 'rejected', 'more_info_required'].includes(input.status)) {
      throw new BadRequestException('invalid review status');
    }

    const req = await this.prisma.verificationRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('request not found');
    if (req.userId === adminId) {
      throw new ForbiddenException('cannot review your own verification request');
    }
    if (!['pending_review', 'more_info_required'].includes(req.status)) {
      throw new BadRequestException('request not reviewable');
    }

    const updated = await this.prisma.verificationRequest.update({
      where: { id: requestId },
      data: {
        status: input.status,
        adminNote: input.adminNote?.trim() || null,
        reviewedAt: new Date(),
        reviewedById: adminId
      }
    });

    if (input.status === 'approved') {
      await this.prisma.user.update({
        where: { id: req.userId },
        data: { isVerified: true, verifiedAt: new Date() }
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      userId: updated.userId,
      reviewedAt: updated.reviewedAt,
      reviewedById: adminId,
      decision: input.status
    };
  }

  async adminList(adminId: string, status?: VerificationStatus) {
    await this.requireAdmin(adminId);
    return this.prisma.verificationRequest.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { submittedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        userId: true,
        track: true,
        status: true,
        businessName: true,
        categoryKey: true,
        applicantName: true,
        adminNote: true,
        submittedAt: true,
        reviewedAt: true,
        reviewedById: true,
        user: { select: { username: true, isVerified: true } },
        documents: { select: { id: true, docType: true, mediaId: true, createdAt: true } }
      }
    });
  }

  /** Admin-only detail with short-lived signed document URLs (never returned to applicants). */
  async adminGet(
    adminId: string,
    requestId: string,
    createReadUrl: (mediaId: string, storageKey: string) => Promise<string>
  ) {
    await this.requireAdmin(adminId);
    const req = await this.prisma.verificationRequest.findUnique({
      where: { id: requestId },
      include: {
        user: { select: { id: true, username: true, isVerified: true, accountType: true } },
        documents: true,
        reviewedBy: { select: { id: true, username: true } }
      }
    });
    if (!req) throw new NotFoundException('request not found');

    const documents = [];
    for (const doc of req.documents) {
      const media = await this.prisma.mediaAsset.findFirst({
        where: { id: doc.mediaId, deletedAt: null }
      });
      let secureUrl: string | null = null;
      if (media) {
        try {
          secureUrl = await createReadUrl(media.id, media.storageKey);
        } catch {
          secureUrl = null;
        }
      }
      documents.push({
        id: doc.id,
        docType: doc.docType,
        mediaId: doc.mediaId,
        createdAt: doc.createdAt,
        mimeType: media?.mimeType ?? null,
        secureUrl
      });
    }

    return {
      id: req.id,
      track: req.track,
      status: req.status,
      businessName: req.businessName,
      categoryKey: req.categoryKey,
      applicantName: req.applicantName,
      adminNote: req.adminNote,
      submittedAt: req.submittedAt,
      reviewedAt: req.reviewedAt,
      reviewedBy: req.reviewedBy,
      user: req.user,
      // Hashes only — never plaintext registration/national IDs
      hasRegistrationHash: Boolean(req.registrationHash),
      hasIdentityHash: Boolean(req.identityHash),
      documents
    };
  }

  private async requireAdmin(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'admin') throw new ForbiddenException('admin only');
    return admin;
  }
}
