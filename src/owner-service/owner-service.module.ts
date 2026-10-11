import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackendMailService } from '../common/services/backend-mail.service';
import { OwnerServiceController } from './owner-service.controller';
import { OwnerServiceService } from './owner-service.service';
import { IdentityDocumentRetentionService } from './identity-document-retention.service';

@Module({
  imports: [AuthModule],
  controllers: [OwnerServiceController],
  providers: [OwnerServiceService, BackendMailService, IdentityDocumentRetentionService],
  exports: [OwnerServiceService, BackendMailService],
})
export class OwnerServiceModule {}
