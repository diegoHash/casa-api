import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { CommunityAccessController } from './community-access.controller';
import { CoreController } from './core.controller';
import { CoreService } from './core.service';

@Module({
  imports: [AuthModule, PlatformModule],
  controllers: [CoreController, CommunityAccessController],
  providers: [CoreService],
})
export class CoreModule {}
