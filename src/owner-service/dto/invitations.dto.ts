import { IsIn, IsInt, IsNotEmpty } from 'class-validator';

export class GenerateInvitationDto {
  @IsInt()
  @IsIn([1, 5, 24, 48])
  ttlHours!: number;
}
