import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { CurrentAuth, PlatformRoles } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { PlatformRolesGuard } from '../auth/platform-roles.guard';
import { AddInitializationRowsDto, CreateInitializationDto } from './dto/initialization.dto';
import { InitializationService } from './initialization.service';

@Controller('accounting/initialization')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.ROOT)
export class InitializationController {
  constructor(private readonly initialization: InitializationService) {}

  @Get()
  @RequireScopes('accounting.read')
  get(@CurrentAuth() auth: AuthPrincipal) { return this.initialization.get(auth.communityId as string); }

  @Post()
  @RequireScopes('accounting.accounts_manage')
  create(@CurrentAuth() auth: AuthPrincipal, @Body() input: CreateInitializationDto) { return this.initialization.create(auth.communityId as string, auth.userId, input); }

  @Post(':id/rows')
  @RequireScopes('accounting.accounts_manage')
  addRows(@CurrentAuth() auth: AuthPrincipal, @Param('id') id: string, @Body() input: AddInitializationRowsDto) { return this.initialization.addRows(auth.communityId as string, auth.userId, id, input); }

  @Post('validate')
  @RequireScopes('accounting.accounts_manage')
  validate(@CurrentAuth() auth: AuthPrincipal) { return this.initialization.validate(auth.communityId as string, auth.userId); }

  @Post('apply')
  @RequireScopes('accounting.journal_post')
  apply(@CurrentAuth() auth: AuthPrincipal) { return this.initialization.apply(auth.communityId as string, auth.userId); }
}
