import { Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateInitializationDto {
  @IsDateString()
  @IsOptional()
  cutoverDate?: string;

  @IsDateString()
  @IsOptional()
  historyFrom?: string;

  @IsDateString()
  @IsOptional()
  historyTo?: string;
}

export class InitializationRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  kind!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  externalRef!: string;

  @IsString()
  @IsOptional()
  propertyId?: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsDateString()
  eventDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class AddInitializationRowsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => InitializationRowDto)
  rows!: InitializationRowDto[];
}
