import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { TreasuryModule } from './treasury/treasury.module';
import { BillingModule } from './billing/billing.module';
import { AccountingModule } from './accounting/accounting.module';
import { OwnerServiceModule } from './owner-service/owner-service.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { S3StorageModule } from './storage/s3-storage.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3001),
        TRUSTED_PROXY_CIDRS: Joi.string().default(''),
        API_PREFIX: Joi.string().default('v1'),
        WEB_ORIGIN: Joi.string().required(),
        DATABASE_URL: Joi.string()
          .uri({ scheme: ['mysql'] })
          .required(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(300).default(900),
        REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(30),
        ROOT_BOOTSTRAP_EMAIL: Joi.string().email().required(),
        ROOT_BOOTSTRAP_PASSWORD: Joi.string().min(14).required(),
        PUBLIC_WEB_URL: Joi.string().uri().default('https://somoscasa.site'),
        RESEND_API_KEY: Joi.string().pattern(/^re_/).optional().allow(''),
        EMAIL_FROM_ADDRESS: Joi.string().email().optional().allow(''),
        EMAIL_REPLY_TO: Joi.string().email().optional().allow(''),
        SMTP_HOST: Joi.string().optional().allow(''),
        SMTP_PORT: Joi.number().port().optional().allow(''),
        SMTP_USER: Joi.string().optional().allow(''),
        SMTP_PASS: Joi.string().optional().allow(''),
        SMTP_SECURE: Joi.boolean().optional().default(true),
        AWS_REGION: Joi.string().default('us-east-1'),
        S3_BUCKET_NAME: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.optional().allow('') }),
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    S3StorageModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    PlatformModule,
    CoreModule,
    TreasuryModule,
    BillingModule,
    AccountingModule,
    OwnerServiceModule,
    NotificationsModule,
    MonitoringModule,
  ],
})
export class AppModule {}
