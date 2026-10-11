import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { CurrentAuth, PlatformRoles } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRolesGuard } from '../auth/platform-roles.guard';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateCommunityAccessDto } from './dto/create-community-access.dto';
import { UpdateCommunityAccessDto } from './dto/update-community-access.dto';
import { UpdateCommunityWorkspacesDto } from './dto/update-community-workspaces.dto';
import { RevokeCommunityAccessDto } from './dto/revoke-community-access.dto';
import {
  CreateLicensePaymentDto,
  ReconcileLicenseDto,
  RevokeLicenseDto,
  UpdateAutoRenewDto,
  UpdateLicenseSettingsDto,
  UpdateLicenseStatusDto,
  UpdateClientStandingDto,
} from './dto/manage-client.dto';
import { ClientsService } from './clients.service';

@Controller('platform/clients')
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.ROOT)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list() {
    return this.clientsService.list();
  }

  @Get('audit')
  audit(
    @Query('communityId') communityId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clientsService.listAudit(communityId, limit);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clientsService.get(id);
  }

  @Post()
  create(@CurrentAuth() auth: AuthPrincipal, @Body() input: CreateClientDto) {
    return this.clientsService.createIntegralClient(auth.userId, input);
  }

  @Get(':id/access-users')
  listAccessUsers(@Param('id') id: string) {
    return this.clientsService.listAccessUsers(id);
  }

  @Get(':id/access-personnel')
  listAccessPersonnel(@Param('id') id: string) {
    return this.clientsService.listAccessPersonnel(id);
  }

  @Post(':id/access-users')
  createAccessUser(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: CreateCommunityAccessDto,
  ) {
    return this.clientsService.createAccessUser(auth.userId, id, input);
  }

  @Patch(':id/access-users/:accessId')
  updateAccessUser(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
    @Body() input: UpdateCommunityAccessDto,
  ) {
    return this.clientsService.updateAccess(auth, id, accessId, input);
  }

  @Patch(':id/access-users/:accessId/workspaces')
  updateAccessWorkspaces(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
    @Body() input: UpdateCommunityWorkspacesDto,
  ) {
    return this.clientsService.updateAccessWorkspaces(
      auth.userId,
      id,
      accessId,
      input,
    );
  }

  @Post(':id/access-users/:accessId/revoke')
  revokeAccess(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
    @Body() input: RevokeCommunityAccessDto,
  ) {
    return this.clientsService.revokeAccess(auth, id, accessId, input);
  }

  @Patch(':id/standing')
  updateStanding(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateClientStandingDto,
  ) {
    return this.clientsService.updateStanding(auth.userId, id, input);
  }

  @Post(':id/license/revoke')
  revokeLicense(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: RevokeLicenseDto,
  ) {
    return this.clientsService.revokeLicense(auth.userId, id, input);
  }

  @Post(':id/license/reconcile')
  reconcileLicense(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: ReconcileLicenseDto,
  ) {
    return this.clientsService.reconcileLicense(auth.userId, id, input);
  }

  @Patch(':id/license/auto-renew')
  updateAutoRenew(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateAutoRenewDto,
  ) {
    return this.clientsService.updateAutoRenew(auth.userId, id, input);
  }

  @Patch(':id/license/status')
  updateLicenseStatus(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateLicenseStatusDto,
  ) {
    return this.clientsService.updateLicenseStatus(auth.userId, id, input);
  }

  @Patch(':id/license/settings')
  updateLicenseSettings(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateLicenseSettingsDto,
  ) {
    return this.clientsService.updateLicenseSettings(auth.userId, id, input);
  }

  @Post(':id/license/payments')
  createLicensePayment(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: CreateLicensePaymentDto,
  ) {
    return this.clientsService.createLicensePayment(auth.userId, id, input);
  }
}
