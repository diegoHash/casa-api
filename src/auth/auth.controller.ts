import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentAuth } from './auth.decorators';
import { AuthService } from './auth.service';
import { AuthPrincipal } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SelectContextDto } from './dto/select-context.dto';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginDto, @Req() request: Request) {
    return this.auth.login(
      input.email,
      input.password,
      this.requestMetadata(request),
    );
  }

  @Post('password-reset/request')
  @HttpCode(202)
  requestPasswordReset(
    @Body() input: RequestPasswordResetDto,
    @Req() request: Request,
  ) {
    return this.auth.requestPasswordReset(
      input.email,
      this.requestMetadata(request),
    );
  }

  @Post('password-reset/complete')
  @HttpCode(200)
  resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: Request,
  ) {
    return this.auth.resetPassword(input, this.requestMetadata(request));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: RefreshTokenDto, @Req() request: Request) {
    return this.auth.refresh(
      input.refreshToken,
      input.communityId,
      this.requestMetadata(request),
    );
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() input: RefreshTokenDto) {
    return this.auth.logout(input.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logoutAll(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.logoutAll(auth);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.auth.changePassword(
      auth,
      input.currentPassword,
      input.newPassword,
      this.requestMetadata(request),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.me(auth);
  }

  @Get('contexts')
  @UseGuards(JwtAuthGuard)
  contexts(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.listContexts(auth);
  }

  @Post('select-context')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  selectContext(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: SelectContextDto,
  ) {
    return this.auth.selectContext(auth, input.communityId);
  }

  private requestMetadata(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
