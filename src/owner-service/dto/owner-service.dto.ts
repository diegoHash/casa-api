import {
  AccessDirection,
  CommunicationAudienceType,
  ServiceAuthorizationStatus,
  ServiceAuthorizationType,
  ServiceIncidentStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  IsDateString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { sanitizeString } from '../../common/transformers/sanitize-string.transformer';

export class CreateOwnerAccessRequestDto {
  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  docType!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  docNumber!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  propertyCode!: string;

  @Transform(sanitizeString)
  @IsEmail()
  @Matches(
    /^(?![^@]*\.\.)[A-Z0-9](?:[A-Z0-9._%+-]{0,62}[A-Z0-9])?@(?!(?:localhost|example|invalid|test)(?:\.|$))(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i,
    { message: 'El correo debe usar un dominio público válido.' },
  )
  @IsNotEmpty()
  @MaxLength(120)
  email!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  inviteCode!: string;
}

export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @IsIn([20, 50, 70, 100])
  @IsOptional()
  pageSize = 20;

  @Transform(sanitizeString)
  @IsString()
  @MaxLength(160)
  @IsOptional()
  search?: string;
}

export class IncidentListQueryDto extends PaginationQueryDto {
  @IsEnum(ServiceIncidentStatus)
  @IsOptional()
  status?: ServiceIncidentStatus;
}

export class AuthorizationListQueryDto extends PaginationQueryDto {
  @IsEnum(ServiceAuthorizationStatus)
  @IsOptional()
  status?: ServiceAuthorizationStatus;
}

export class AuthorizedPersonDto {
  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  documentNumber!: string;
}

export class CreateOwnerAuthorizationDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  propertyId?: string;

  @IsEnum(ServiceAuthorizationType)
  type!: ServiceAuthorizationType;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  subject!: string;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validUntil!: string;

  @ValidateNested({ each: true })
  @Type(() => AuthorizedPersonDto)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  authorizedPeople: AuthorizedPersonDto[] = [];

  @ValidateNested({ each: true })
  @Type(() => AuthorizationVehicleDto)
  @IsArray()
  @ArrayMaxSize(20)
  @IsOptional()
  vehicles?: AuthorizationVehicleDto[];

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  vehicleBrand?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  vehicleModel?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(80)
  vehicleColor?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  vehiclePlate?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  workDescription?: string;
}

export class AuthorizationVehicleDto {
  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  brand?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  model?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(80)
  color?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  plate?: string;
}

export class ScanAuthorizationQrDto {
  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  qrPayload!: string;

  @IsEnum(AccessDirection)
  direction!: AccessDirection;
}

export class RegisterAccessEventDto {
  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  subject!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  documentNumber?: string;

  @IsEnum(AccessDirection)
  direction!: AccessDirection;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class CommunicationListQueryDto extends PaginationQueryDto {}

export class CommunicationDetailQueryDto extends PaginationQueryDto {}

export class AssignIncidentDto {
  @IsString()
  @IsOptional()
  employmentId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  assignedName!: string;
}

export class UpdateIncidentStatusDto {
  @IsEnum(ServiceIncidentStatus)
  status!: ServiceIncidentStatus;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;
}

export class RejectAuthorizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class PublishCommunicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body!: string;

  @IsEnum(CommunicationAudienceType)
  audienceType!: CommunicationAudienceType;

  @IsString()
  @IsOptional()
  sectorId?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsOptional()
  propertyIds?: string[];
}

export class ReportPaymentDto {
  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  bankAccountId?: string;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  paymentMethodId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  exchangeRate?: number;

  @Transform(sanitizeString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reference!: string;

  @IsDateString()
  @IsNotEmpty()
  paidAt!: string;

  @Transform(sanitizeString)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
