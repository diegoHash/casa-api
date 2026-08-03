import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCommunityAccessDto {
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
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
