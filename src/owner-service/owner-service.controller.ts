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
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import {
  AssignIncidentDto,
  AuthorizationListQueryDto,
  CommunicationDetailQueryDto,
  CommunicationListQueryDto,
  IncidentListQueryDto,
  PaginationQueryDto,
  PublishCommunicationDto,
  RejectAuthorizationDto,
  UpdateIncidentStatusDto,
} from './dto/owner-service.dto';
import { OwnerServiceService } from './owner-service.service';

@Controller('owner-service')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class OwnerServiceController {
  constructor(private readonly ownerService: OwnerServiceService) {}

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
  @RequireScopes('owner_service.authorizations.read')
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

  private communityId(auth: AuthPrincipal) {
    return auth.communityId as string;
  }
}
