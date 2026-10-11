import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import {
  ClientStanding,
  Currency,
  LicensePaymentMethod,
  LicenseStatus,
} from '@prisma/client';

export class UpdateClientStandingDto {
  @IsEnum(ClientStanding)
  standing!: ClientStanding;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class RevokeLicenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ReconcileLicenseDto {
  @IsDateString()
  @IsOptional()
  reconciledAt?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reference!: string;
}

export class UpdateAutoRenewDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class UpdateLicenseStatusDto {
  @IsEnum(LicenseStatus)
  status!: LicenseStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class UpdateLicenseSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoRenewOnReconciliation?: boolean;

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean;

  @IsOptional()
  @IsDateString()
  trialFrom?: string;

  @IsOptional()
  @IsDateString()
  trialUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  graceDays?: number;
}

export class CreateLicensePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsNumber()
  @Min(0.000001)
  exchangeRate!: number;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsEnum(LicensePaymentMethod)
  paymentMethod!: LicensePaymentMethod;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reference!: string;

  @IsDateString()
  paidAt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
