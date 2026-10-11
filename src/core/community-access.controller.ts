import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyScopes, RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { ClientsService } from '../platform/clients.service';
import { CreateCommunityAccessDto } from '../platform/dto/create-community-access.dto';
import { UpdateCommunityAccessDto } from '../platform/dto/update-community-access.dto';
import { RevokeCommunityAccessDto } from '../platform/dto/revoke-community-access.dto';

@Controller('core/access-users')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
@RequireScopes('core.staff.write')
export class CommunityAccessController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequireAnyScopes('core.staff.write', 'core.access.write')
  list(@CurrentAuth() auth: AuthPrincipal) {
    return this.clientsService.listAccessUsersForCommunity(
      this.communityId(auth),
    );
  }

  @Get('personnel')
  @RequireAnyScopes('core.staff.write', 'core.access.write')
  listPersonnel(@CurrentAuth() auth: AuthPrincipal) {
    return this.clientsService.listAccessPersonnelForCommunity(
      this.communityId(auth),
    );
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateCommunityAccessDto,
  ) {
    return this.clientsService.createAccessUserForCommunity(
      auth,
      this.communityId(auth),
      input,
    );
  }

  @Patch(':accessId')
  @RequireScopes('core.access.write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('accessId') accessId: string,
    @Body() input: UpdateCommunityAccessDto,
  ) {
    return this.clientsService.updateAccessForCommunity(
      auth,
      this.communityId(auth),
      accessId,
      input,
    );
  }

  @Post(':accessId/revoke')
  @RequireScopes('core.access.write')
  revoke(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('accessId') accessId: string,
    @Body() input: RevokeCommunityAccessDto,
  ) {
    return this.clientsService.revokeAccessForCommunity(
      auth,
      this.communityId(auth),
      accessId,
      input,
    );
  }

  private communityId(auth: AuthPrincipal) {
    return auth.communityId as string;
  }
}
