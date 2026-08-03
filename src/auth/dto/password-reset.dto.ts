import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(190)
  email!: string;
}

export class ResetPasswordDto {
  @ValidateIf((input: ResetPasswordDto) => !input.pin)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token?: string;

  @ValidateIf((input: ResetPasswordDto) => !input.token)
  @IsEmail()
  @MaxLength(190)
  email?: string;

  @ValidateIf((input: ResetPasswordDto) => !input.token)
  @IsString()
  @Matches(/^\d{6}$/)
  pin?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
