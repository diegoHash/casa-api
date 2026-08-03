import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ClientStanding } from '@prisma/client';

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
