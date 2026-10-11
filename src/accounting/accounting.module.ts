import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { InitializationController } from './initialization.controller';
import { InitializationService } from './initialization.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountingController, InitializationController],
  providers: [AccountingService, InitializationService],
})
export class AccountingModule {}
