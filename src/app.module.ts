import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { TreasuryModule } from './treasury/treasury.module';
import { ImportsModule } from './imports/imports.module';
import { BillingModule } from './billing/billing.module';
import { AccountingModule } from './accounting/accounting.module';
import { OwnerServiceModule } from './owner-service/owner-service.module';

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
        PUBLIC_WEB_URL: Joi.string().uri().default('http://localhost:5173'),
        RESEND_API_KEY: Joi.string().pattern(/^re_/).optional().allow(''),
        EMAIL_FROM_ADDRESS: Joi.string().email().optional(),
        EMAIL_REPLY_TO: Joi.string().email().optional(),
      }),
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    PlatformModule,
    CoreModule,
    TreasuryModule,
    ImportsModule,
    BillingModule,
    AccountingModule,
    OwnerServiceModule,
  ],
})
export class AppModule {}
