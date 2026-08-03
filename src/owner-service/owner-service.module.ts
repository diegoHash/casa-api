import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OwnerServiceController } from './owner-service.controller';
import { OwnerServiceService } from './owner-service.service';

@Module({
  imports: [AuthModule],
  controllers: [OwnerServiceController],
  providers: [OwnerServiceService],
})
export class OwnerServiceModule {}
