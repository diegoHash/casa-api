import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportPasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
