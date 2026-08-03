import { IsString, MinLength } from 'class-validator';

export class SelectContextDto {
  @IsString()
  @MinLength(1)
  communityId!: string;
}
