import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  legalName!: string;

  @IsString()
  @Matches(/^[JGVEP]-?\d{8}-?\d$/i)
  rif!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  contactName!: string;

  @IsEmail()
  @MaxLength(190)
  contactEmail!: string;

  @IsPhoneNumber('VE')
  contactPhone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  postalCode = '';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyFee!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  onboardingProgress = 0;
}
