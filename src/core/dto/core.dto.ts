import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AdministrationMode,
  Currency,
  DocumentType,
  EngagementType,
  PersonContactType,
  PropertyKind,
  PropertyLocationKind,
} from '@prisma/client';

export class UpdateCommunityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  @IsOptional()
  legalName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @IsOptional()
  rif?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(190)
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsOptional()
  address?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  state?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  postalCode?: string;

  @IsEnum(AdministrationMode)
  @IsOptional()
  administrationMode?: AdministrationMode;

  @IsString()
  @MaxLength(220)
  @IsOptional()
  administratorName?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  administratorRif?: string;
}

export class CreatePersonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName!: string;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  documentNumber!: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(190)
  @IsOptional()
  email?: string;
}

export class UpdatePersonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  lastName?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(190)
  @IsOptional()
  email?: string;
}

export class CreatePersonContactDto {
  @IsEnum(PersonContactType)
  type!: PersonContactType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  value!: string;
}

export class CreatePropertyLocationDto {
  @IsEnum(PropertyLocationKind)
  kind!: PropertyLocationKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;
}

export class CreatePropertyDto {
  @IsEnum(PropertyKind)
  kind!: PropertyKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @IsOptional()
  locationId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(100)
  @IsOptional()
  aliquot?: number;

  @IsDateString()
  @IsOptional()
  aliquotStartsOn?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  maximumOccupancy?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  braceletQuota?: number;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  parkingSpace?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  parkingCapacity?: number | null;
}

export class UpdatePropertyDto {
  @IsEnum(PropertyKind)
  @IsOptional()
  kind?: PropertyKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @IsOptional()
  code?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  locationId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  maximumOccupancy?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  braceletQuota?: number;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  parkingSpace?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  parkingCapacity?: number | null;
}

export class UpdatePropertyCapacityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  maximumOccupancy?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  braceletQuota?: number;
}

export class ChangeAliquotDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(100)
  aliquot!: number;

  @IsDateString()
  startsOn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreateOwnershipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  personId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  propertyId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  ownershipPercentage!: number;

  @IsDateString()
  startsOn!: string;
}

export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  personId!: string;

  @IsDateString()
  transferDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreateEmploymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  personId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  position!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  department!: string;

  @IsEnum(EngagementType)
  engagementType!: EngagementType;

  @IsDateString()
  startsOn!: string;
}

export class CreateBoardAppointmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  personId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @IsOptional()
  propertyId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  position!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  @IsOptional()
  endsOn?: string;
}

export class CreateInitialBoardMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName!: string;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  documentNumber!: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(190)
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  position!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  @IsOptional()
  endsOn?: string;

  @IsEnum(PropertyKind)
  propertyKind!: PropertyKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  propertyCode!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  ownershipPercentage!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(100)
  @IsOptional()
  aliquot?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maximumOccupancy!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  braceletQuota!: number;
}

export class SetupBoardAdministrationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateInitialBoardMemberDto)
  members!: CreateInitialBoardMemberDto[];
}

export class EndRelationshipDto {
  @IsDateString()
  @IsOptional()
  endsOn?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreateConcessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  holderName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  holderDocument!: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  locationDescription?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyAmount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  @IsOptional()
  endsOn?: string;
}

export class UpdateConcessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  @IsOptional()
  holderName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @IsOptional()
  holderDocument?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  locationDescription?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlyAmount?: number;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsDateString()
  @IsOptional()
  startsOn?: string;

  @IsDateString()
  @IsOptional()
  endsOn?: string;
}
