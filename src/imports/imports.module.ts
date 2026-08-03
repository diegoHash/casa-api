import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { LegacyScannerService } from './legacy-scanner.service';

@Module({
  imports: [AuthModule],
  controllers: [ImportsController],
  providers: [ImportsService, LegacyScannerService],
})
export class ImportsModule {}
