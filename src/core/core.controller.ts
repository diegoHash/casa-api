import {
  Body,
  Controller,
  Delete,
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
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { CoreService } from './core.service';
import {
  ChangeAliquotDto,
  CreateBoardAppointmentDto,
  CreateConcessionDto,
  CreateEmploymentDto,
  CreateOwnershipDto,
  CreatePersonDto,
  CreatePersonContactDto,
  UpdatePersonDto,
  CreatePropertyDto,
  CreatePropertyLocationDto,
  EndRelationshipDto,
  SetupBoardAdministrationDto,
  UpdateCommunityDto,
  UpdateConcessionDto,
  UpdatePropertyCapacityDto,
} from './dto/core.dto';

@Controller('core')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class CoreController {
  constructor(private readonly core: CoreService) {}

  @Get('snapshot')
  @RequireScopes('core.read')
  snapshot(@CurrentAuth() auth: AuthPrincipal) {
    return this.core.snapshot(this.communityId(auth));
  }

  @Get('owner-service-directory')
  @RequireScopes(
    'owner_service.owners.read',
    'owner_service.owners.contacts.read',
  )
  ownerServiceDirectory(@CurrentAuth() auth: AuthPrincipal) {
    return this.core.ownerServiceDirectory(this.communityId(auth));
  }

  @Patch('community')
  @RequireScopes('core.community.write')
  updateCommunity(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: UpdateCommunityDto,
  ) {
    return this.core.updateCommunity(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Post('people')
  @RequireScopes('core.people.write')
  createPerson(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreatePersonDto,
  ) {
    return this.core.createPerson(this.communityId(auth), auth.userId, input);
  }

  @Patch('people/:id')
  @RequireScopes('core.people.write')
  updatePerson(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdatePersonDto,
  ) {
    return this.core.updatePerson(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('people/:id/contacts')
  @RequireScopes('core.people.write')
  createPersonContact(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') personId: string,
    @Body() input: CreatePersonContactDto,
  ) {
    return this.core.createPersonContact(
      this.communityId(auth),
      auth.userId,
      personId,
      input,
    );
  }

  @Delete('people/:id/contacts/:contactId')
  @RequireScopes('core.people.write')
  deletePersonContact(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') personId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.core.deletePersonContact(
      this.communityId(auth),
      auth.userId,
      personId,
      contactId,
    );
  }

  @Post('locations')
  @RequireScopes('core.properties.write')
  createLocation(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreatePropertyLocationDto,
  ) {
    return this.core.createLocation(this.communityId(auth), auth.userId, input);
  }

  @Post('properties')
  @RequireScopes('core.properties.write')
  createProperty(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreatePropertyDto,
  ) {
    return this.core.createProperty(this.communityId(auth), auth.userId, input);
  }

  @Patch('properties/:id/capacity')
  @RequireScopes('core.properties.write')
  updatePropertyCapacity(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') propertyId: string,
    @Body() input: UpdatePropertyCapacityDto,
  ) {
    return this.core.updatePropertyCapacity(
      this.communityId(auth),
      auth.userId,
      propertyId,
      input,
    );
  }

  @Post('board-administration/setup')
  @RequireScopes(
    'core.people.write',
    'core.properties.write',
    'core.ownerships.write',
    'core.board.write',
  )
  setupBoardAdministration(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: SetupBoardAdministrationDto,
  ) {
    return this.core.setupBoardAdministration(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Post('properties/:id/aliquots')
  @RequireScopes('core.properties.write')
  changeAliquot(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') propertyId: string,
    @Body() input: ChangeAliquotDto,
  ) {
    return this.core.changeAliquot(
      this.communityId(auth),
      auth.userId,
      propertyId,
      input,
    );
  }

  @Post('ownerships')
  @RequireScopes('core.ownerships.write')
  createOwnership(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateOwnershipDto,
  ) {
    return this.core.createOwnership(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Patch('ownerships/:id/end')
  @RequireScopes('core.ownerships.write')
  endOwnership(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: EndRelationshipDto,
  ) {
    return this.core.endOwnership(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('employments')
  @RequireScopes('core.staff.write')
  createEmployment(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateEmploymentDto,
  ) {
    return this.core.createEmployment(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Patch('employments/:id/end')
  @RequireScopes('core.staff.write')
  endEmployment(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: EndRelationshipDto,
  ) {
    return this.core.endEmployment(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('board-appointments')
  @RequireScopes('core.board.write')
  createBoardAppointment(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateBoardAppointmentDto,
  ) {
    return this.core.createBoardAppointment(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Patch('board-appointments/:id/end')
  @RequireScopes('core.board.write')
  endBoardAppointment(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: EndRelationshipDto,
  ) {
    return this.core.endBoardAppointment(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Post('concessions')
  @RequireScopes('core.concessions.write')
  createConcession(
    @CurrentAuth() auth: AuthPrincipal,
    @Body() input: CreateConcessionDto,
  ) {
    return this.core.createConcession(
      this.communityId(auth),
      auth.userId,
      input,
    );
  }

  @Patch('concessions/:id')
  @RequireScopes('core.concessions.write')
  updateConcession(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: UpdateConcessionDto,
  ) {
    return this.core.updateConcession(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  @Patch('concessions/:id/end')
  @RequireScopes('core.concessions.write')
  endConcession(
    @CurrentAuth() auth: AuthPrincipal,
    @Param('id') id: string,
    @Body() input: EndRelationshipDto,
  ) {
    return this.core.endConcession(
      this.communityId(auth),
      auth.userId,
      id,
      input,
    );
  }

  private communityId(auth: AuthPrincipal) {
    return auth.communityId as string;
  }
}
