import {
  ChargeComponentType,
  Currency,
  ExpenseAllocationMethod,
  ExpensePaymentSource,
  PayableCategory,
  PayableStatus,
  RecordStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  Max,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

export class CreateExpenseConceptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  defaultExpenseAccountId?: string;
}

export class CreateVendorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  legalName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  document!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(190)
  email?: string;
}

export class ListVendorsQueryDto {
  @IsString()
  @MaxLength(160)
  @IsOptional()
  search?: string;
}

export class UpdateExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsEnum(RecordStatus)
  @IsOptional()
  status?: RecordStatus;
}

export class UpdateExpenseConceptDto extends UpdateExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  defaultExpenseAccountId?: string;
}

export class ListExpenseConceptsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize = 20;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsEnum(RecordStatus)
  @IsOptional()
  status?: RecordStatus;
}

export class CreateBillingPeriodDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  periodKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;
}

export class CreatePeriodExpenseDto {
  @IsString()
  @IsNotEmpty()
  conceptId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(ExpenseAllocationMethod)
  @IsOptional()
  allocationMethod?: ExpenseAllocationMethod;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  beneficiaryName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  beneficiaryDocument!: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  beneficiaryPhone?: string;

  @IsEnum(ExpensePaymentSource)
  paymentSource!: ExpensePaymentSource;

  @IsString()
  @IsOptional()
  bankAccountId?: string;

  @IsString()
  @IsOptional()
  paymentMethodId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  paymentReference!: string;

  @IsDateString()
  paidAt!: string;

  @IsString()
  @IsOptional()
  expenseAccountId!: string;

  @IsString()
  @IsNotEmpty()
  paymentAccountId!: string;
}

export class ChargeNoticeComponentDto {
  @IsEnum(ChargeComponentType)
  type!: ChargeComponentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  label!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(ExpenseAllocationMethod)
  allocationMethod!: ExpenseAllocationMethod;
}

export class PrepareChargeNoticeDto {
  @IsDateString()
  dueDate!: string;

  @IsString()
  @IsNotEmpty()
  receivableAccountId!: string;

  @IsString()
  @IsNotEmpty()
  billingIncomeAccountId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChargeNoticeComponentDto)
  components!: ChargeNoticeComponentDto[];
}

export class CreateOwnerPaymentDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsString()
  @IsOptional()
  payerPersonId?: string;

  @IsString()
  @IsOptional()
  paymentMethodId?: string;

  @IsString()
  @IsOptional()
  bankAccountId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  exchangeRate!: number;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  exchangeRateSource?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reference!: string;

  @IsDateString()
  paidAt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class CreatePaymentApplicationDto {
  @IsString()
  @IsNotEmpty()
  ownerPaymentId!: string;

  @IsString()
  @IsNotEmpty()
  chargeNoticeAllocationId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  functionalAmount!: number;
}

export class CreateVendorPayableDto {
  @IsEnum(PayableCategory)
  category!: PayableCategory;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  categoryLabel?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  supplierName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  supplierDocument?: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsDateString()
  issueDate!: string;

  @IsDateString()
  dueDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @IsOptional()
  expenseAccountId?: string;

  @IsString()
  @IsOptional()
  liabilityAccountId?: string;
}

export class UpdateVendorPayableDto {
  @IsEnum(PayableCategory)
  @IsOptional()
  category?: PayableCategory;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  categoryLabel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(220)
  supplierName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  supplierDocument?: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  amount?: number;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsEnum(PayableStatus)
  @IsOptional()
  status?: PayableStatus;
}

export class PayVendorPayableDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsDateString()
  paidAt!: string;

  @IsString()
  @IsOptional()
  paymentAccountId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  paymentReference?: string;
}

export class CreatePayableReminderDto {
  @IsDateString()
  remindAt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  message?: string;
}
