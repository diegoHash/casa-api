import { Module } from '@nestjs/common';
import { BackendMailService } from '../common/services/backend-mail.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CommunityContextGuard } from './community-context.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { PlatformRolesGuard } from './platform-roles.guard';
import { RootBootstrapService } from './root-bootstrap.service';
import { ScopesGuard } from './scopes.guard';
import { TokenService } from './token.service';
import { EmailService } from './email.service';
import { EmailDomainService } from './email-domain.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RootBootstrapService,
    JwtAuthGuard,
    PlatformRolesGuard,
    CommunityContextGuard,
    ScopesGuard,
    EmailService,
    EmailDomainService,
    BackendMailService,
  ],
  exports: [
    JwtAuthGuard,
    PlatformRolesGuard,
    CommunityContextGuard,
    ScopesGuard,
    PasswordService,
    TokenService,
    BackendMailService,
  ],
})
export class AuthModule {}
