import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireAnyScopes, RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import {
  AssignIncidentDto,
  AuthorizationListQueryDto,
  CommunicationDetailQueryDto,
  CommunicationListQueryDto,
  CreateOwnerAccessRequestDto,
  CreateOwnerAuthorizationDto,
  IncidentListQueryDto,
  PaginationQueryDto,
  PublishCommunicationDto,
  RejectAuthorizationDto,
  UpdateIncidentStatusDto,
  ReportPaymentDto,
  RegisterAccessEventDto,
  ScanAuthorizationQrDto,
} from './dto/owner-service.dto';
import { GenerateInvitationDto } from './dto/invitations.dto';
import { OwnerServiceService } from './owner-service.service';

@Controller('owner-service')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class OwnerServiceController {
  constructor(private readonly ownerService: OwnerServiceService) { }

  @Get('options')
  @RequireScopes('owner_service.owners.read')
  options(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.options(this.communityId(auth));
  }

  @Get('owners')
  @RequireScopes(
    'owner_service.owners.read',
    'owner_service.owners.contacts.read',
  )
  owners(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: PaginationQueryDto,
  ) {
    return this.ownerService.listOwners(this.communityId(auth), query);
  }

  @Get('incidents')
  @RequireScopes('owner_service.incidents.read')
  incidents(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: IncidentListQueryDto,
  ) {
    return this.ownerService.listIncidents(this.communityId(auth), query);
  }

  @Patch('incidents/:id/assignment')
  @RequireScopes('owner_service.incidents.assign')
  assignIncident(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: AssignIncidentDto,
  ) {
    return this.ownerService.assignIncident(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Patch('incidents/:id/status')
  @RequireScopes('owner_service.incidents.status.update')
  updateIncidentStatus(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateIncidentStatusDto,
  ) {
    return this.ownerService.updateIncidentStatus(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Get('authorizations')
  @RequireAnyScopes(
    'owner_service.authorizations.read',
    'access_control.authorizations.read',
  )
  authorizations(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: AuthorizationListQueryDto,
  ) {
    return this.ownerService.listAuthorizations(this.communityId(auth), query);
  }

  @Post('authorizations/:id/approve')
  @RequireScopes('owner_service.authorizations.sign')
  approveAuthorization(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.ownerService.approveAuthorization(
      this.communityId(auth),
      auth.userId,
      id,
    );
  }

  @Post('authorizations/:id/reject')
  @RequireScopes('owner_service.authorizations.reject')
  rejectAuthorization(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: RejectAuthorizationDto,
  ) {
    return this.ownerService.rejectAuthorization(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Get('communications')
  @RequireScopes('owner_service.communications.read')
  communications(
    @CurrentAuth() auth: AuthPrincipal,
    @Query() query: CommunicationListQueryDto,
  ) {
    return this.ownerService.listCommunications(this.communityId(auth), query);
  }

  @Get('communications/:id')
  @RequireScopes('owner_service.communications.read')
  communication(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: CommunicationDetailQueryDto,
  ) {
    return this.ownerService.communicationDetail(
      this.communityId(auth),
      id,
      query,
    );
  }

  @Post('communications/publish')
  @RequireScopes('owner_service.communications.send')
  publishCommunication(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: PublishCommunicationDto,
  ) {
    return this.ownerService.publishCommunication(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Post('communications/:communicationId/recipients/:recipientId/read')
  @RequireScopes('owner_service.communications.read')
  markRecipientRead(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('communicationId') communicationId: string,
    @Param('recipientId') recipientId: string,
  ) {
    return this.ownerService.markRecipientRead(
      this.communityId(auth),
      communicationId,
      recipientId,
    );
  }

  @Get('registration-requests')
  @RequireScopes('owner_service.owners.read')
  registrationRequests(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.listRegistrationRequests(this.communityId(auth));
  }

  @Get('registration-requests/:id/identity-document')
  @RequireScopes('owner_service.owners.read')
  async registrationIdentityDocument(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const stream = await this.ownerService.registrationIdentityDocument(this.communityId(auth), id);
    response.set({
      'Content-Type': 'image/webp',
      'Content-Disposition': 'inline; filename="identity.webp"',
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    stream.once('error', () => response.destroy());
    stream.pipe(response);
  }

  @Post('registration-requests/:id/approve')
  @RequireScopes('owner_service.owners.read')
  approveRegistrationRequest(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: { email: string; fullName: string; propertyCode: string; folioNumber: string; personId?: string; propertyId?: string; emailResolution?: 'KEEP_EXISTING' | 'USE_REQUEST_EMAIL' },
  ) {
    return this.ownerService.approveRegistrationRequest(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('registration-requests/:id/reject')
  @RequireScopes('owner_service.owners.read')
  rejectRegistrationRequest(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: { reason: string; email: string; fullName: string; propertyCode: string; folioNumber: string },
  ) {
    return this.ownerService.rejectRegistrationRequest(
      this.communityId(auth),
      auth.userId,
      id,
      input.reason,
      input,
    );
  }

  @Post('registration-requests/:id/resend-pin')
  @RequireScopes('owner_service.owners.read')
  resendPinRegistrationRequest(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: { email: string; fullName: string; propertyCode: string; folioNumber: string },
  ) {
    return this.ownerService.resendPinRegistrationRequest(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('registration-requests/:id/revoke')
  @RequireScopes('owner_service.owners.read')
  revokeRegistrationRequest(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: { email: string },
  ) {
    return this.ownerService.revokeRegistrationRequest(this.communityId(auth), auth.userId, id, input.email);
  }

  @Get('invitations/active')
  @RequireScopes('owner_service.owners.read')
  getActiveInvitationCode(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.getActiveInvitationCode(this.communityId(auth));
  }

  @Post('invitations/generate')
  @RequireScopes('owner_service.owners.read')
  generateInvitationCode(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: GenerateInvitationDto,
  ) {
    return this.ownerService.generateInvitationCode(
      this.communityId(auth),
      auth.userId,
      input.ttlHours,
    );
  }

  @Post('invitations/revoke')
  @RequireScopes('owner_service.owners.read')
  revokeInvitationCode(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.revokeInvitationCode(
      this.communityId(auth),
      auth.userId,
    );
  }

  @Get('portal/overview')
  getOwnerPortalOverview(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.getOwnerPortalOverview(
      this.communityId(auth),
      auth.userId,
    );
  }

  @Get('portal/exchange-rate')
  @RequireScopes('owner_service.owners.read')
  getOwnerPortalExchangeRate(@Query('date') date?: string) {
    return this.ownerService.officialExchangeRateForDate(date);
  }

  @Post('portal/payments')
  @RequireScopes('owner_service.owners.read')
  reportPayment(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: ReportPaymentDto,
  ) {
    return this.ownerService.reportPayment(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Post('portal/authorizations')
  createOwnerAuthorization(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateOwnerAuthorizationDto,
  ) {
    return this.ownerService.createOwnerAuthorization(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Get('portal/authorizations')
  getOwnerAuthorizations(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.listOwnerAuthorizations(
      this.communityId(auth),
      auth.userId,
    );
  }

  @Post('portal/authorizations/:id/qr')
  regenerateOwnerAuthorizationQr(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.ownerService.regenerateOwnerAuthorizationQr(
      this.communityId(auth),
      auth.userId,
      id,
    );
  }

  @Get('security/access-events')
  @RequireAnyScopes(
    'owner_service.authorizations.read',
    'access_control.authorizations.read',
  )
  accessEvents(@CurrentAuth() auth: AuthPrincipal) {
    return this.ownerService.listAccessEvents(this.communityId(auth));
  }

  @Post('security/scan')
  @RequireAnyScopes(
    'owner_service.authorizations.access.validate',
    'access_control.authorizations.access.validate',
  )
  scanAuthorization(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: ScanAuthorizationQrDto,
  ) {
    return this.ownerService.scanAuthorizationQr(this.communityId(auth), input);
  }

  @Post('security/scan/confirm')
  @RequireAnyScopes(
    'owner_service.authorizations.access.validate',
    'access_control.authorizations.access.validate',
  )
  confirmAuthorizationArrival(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: ScanAuthorizationQrDto,
  ) {
    return this.ownerService.confirmAuthorizationArrival(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Post('security/access-events')
  @RequireAnyScopes(
    'owner_service.authorizations.access.validate',
    'access_control.authorizations.access.validate',
  )
  registerAccessEvent(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: RegisterAccessEventDto,
  ) {
    return this.ownerService.registerAccessEvent(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  private communityId(auth: AuthPrincipal) {
    return auth.communityId as string;
  }
}
