import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';

@Injectable()
export class IdentityDocumentRetentionService {
  private readonly logger = new Logger(IdentityDocumentRetentionService.name);
  constructor(private readonly prisma: PrismaService, private readonly s3: S3StorageService) {}

  // Delete exact version IDs because this production bucket has versioning enabled.
  @Cron('*/5 * * * *')
  async purgeExpiredRegistrationDocuments() {
    const now = new Date();
    const expired = await this.prisma.ownerRegistrationRequest.findMany({
      where: {
        identityDocumentKey: { not: null },
        OR: [
          { identityDocumentExpiresAt: { lte: now } },
          { status: 'REJECTED' },
        ],
      },
      select: { id: true, identityDocumentKey: true, identityDocumentVersionId: true },
      take: 100,
    });

    for (const item of expired) {
      if (!item.identityDocumentKey) continue;
      try {
        await this.s3.deletePrivateObject(item.identityDocumentKey, item.identityDocumentVersionId);
        await this.prisma.ownerRegistrationRequest.updateMany({
          where: { id: item.id, identityDocumentKey: item.identityDocumentKey, identityDocumentVersionId: item.identityDocumentVersionId },
          data: { identityDocumentKey: null, identityDocumentVersionId: null, identityDocumentExpiresAt: null, identityDocumentSizeBytes: null },
        });
      } catch {
        // Keep metadata so this bounded worker retries on its next run.
        this.logger.warn('A registration identity document could not be purged; it will be retried.');
      }
    }
  }
}
