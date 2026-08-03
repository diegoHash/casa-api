import {
  Currency,
  JournalEntrySource,
  LedgerAccountType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateLedgerAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(LedgerAccountType)
  type!: LedgerAccountType;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsString()
  @IsOptional()
  bankAccountId?: string;

  @IsOptional()
  @IsBoolean()
  acceptsEntries?: boolean;
}

export class UpdateLedgerAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(40)
  code?: string;

  @IsString()
  @IsOptional()
  @MaxLength(180)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(LedgerAccountType)
  @IsOptional()
  type?: LedgerAccountType;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsString()
  @IsOptional()
  bankAccountId?: string;

  @IsOptional()
  @IsBoolean()
  acceptsEntries?: boolean;
}

export class CreateAccountingPeriodDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  periodKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;
}

export class CreateJournalLineDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  transactionAmount?: number;

  @IsEnum(Currency)
  @IsOptional()
  transactionCurrency?: Currency;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @IsOptional()
  exchangeRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  referenceType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  referenceId?: string;
}

export class CreateJournalEntryDto {
  @IsString()
  @IsNotEmpty()
  accountingPeriodId!: string;

  @IsDateString()
  entryDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsEnum(JournalEntrySource)
  @IsOptional()
  source?: JournalEntrySource;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sourceId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateJournalLineDto)
  lines!: CreateJournalLineDto[];
}

export class ReverseJournalEntryDto {
  @IsString()
  @IsNotEmpty()
  accountingPeriodId!: string;

  @IsDateString()
  entryDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
