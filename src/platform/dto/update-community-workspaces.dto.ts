import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCommunityWorkspacesDto {
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
