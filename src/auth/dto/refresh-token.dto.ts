import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(32)
  refreshToken!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  communityId?: string;
}
