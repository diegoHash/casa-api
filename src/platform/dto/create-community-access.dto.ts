import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCommunityAccessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  personId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  roleCode!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  scopes!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  workspaceCodes!: string[];

  @IsString()
  @IsOptional()
  @MinLength(8)
  @MaxLength(128)
  temporaryPassword?: string;
}
