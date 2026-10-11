import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RevokeCommunityAccessDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}
