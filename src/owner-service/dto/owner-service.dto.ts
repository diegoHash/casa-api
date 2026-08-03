import {
  CommunicationAudienceType,
  ServiceAuthorizationStatus,
  ServiceIncidentStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
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
