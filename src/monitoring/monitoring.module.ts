import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringEvents } from './monitoring.events';
import { MonitoringService } from './monitoring.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { MonitoringInterceptor } from './monitoring.interceptor';

@Module({ imports: [AuthModule], controllers: [MonitoringController], providers: [MonitoringService, MonitoringEvents, HttpExceptionFilter, MonitoringInterceptor], exports: [MonitoringService, MonitoringInterceptor] })
export class MonitoringModule {}
