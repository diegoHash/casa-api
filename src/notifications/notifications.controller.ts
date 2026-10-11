import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { CommunityContextGuard } from '../auth/community-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireScopes } from '../auth/scopes.decorator';
import { ScopesGuard } from '../auth/scopes.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, CommunityContextGuard, ScopesGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequireScopes('billing.read')
  list(@CurrentAuth() auth: AuthPrincipal) {
    return this.notifications.listPayableNotifications(auth.communityId as string);
  }
}
