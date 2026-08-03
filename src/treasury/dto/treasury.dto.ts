import { Currency, PaymentMethodType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  holder!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  holderRif!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  accountType!: string;

  @IsEnum(Currency)
  currency!: Currency;
}

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodType)
  type!: PaymentMethodType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @ValidateIf(
    (input: CreatePaymentMethodDto) =>
      input.type === PaymentMethodType.BANK_TRANSFER,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  bankAccountId?: string;

  @ValidateIf(
    (input: CreatePaymentMethodDto) =>
      input.type === PaymentMethodType.MOBILE_PAYMENT,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  mobilePhone?: string;

  @ValidateIf(
    (input: CreatePaymentMethodDto) =>
      input.type === PaymentMethodType.MOBILE_PAYMENT,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  mobileDocument?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  instructions?: string;
}

export class UpdateBankAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(160)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(220)
  holder?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  holderRif?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  accountType?: string;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;
}

export class UpdatePaymentMethodDto {
  @IsEnum(PaymentMethodType)
  @IsOptional()
  type?: PaymentMethodType;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  label?: string;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  bankAccountId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  mobilePhone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  mobileDocument?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  instructions?: string;
}
