import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteImportBatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  confirmation!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(500)
  reason!: string;
}
