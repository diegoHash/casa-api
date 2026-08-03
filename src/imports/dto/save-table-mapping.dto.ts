import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImportColumnMappingDto {
  @IsString()
  @MaxLength(255)
  sourceColumn!: string;

  @IsString()
  @MaxLength(160)
  targetField!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transform?: string;

  @IsBoolean()
  required = false;
}

export class SaveTableMappingDto {
  @IsString()
  @MaxLength(100)
  targetEntity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => ImportColumnMappingDto)
  columns: ImportColumnMappingDto[] = [];

  @IsOptional()
  @IsIn(['complete', 'ignore'])
  mode: 'complete' | 'ignore' = 'complete';
}
