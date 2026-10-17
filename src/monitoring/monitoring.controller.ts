import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { Request } from 'express';
import { Response } from 'express';
import { CurrentAuth, PlatformRoles } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRolesGuard } from '../auth/platform-roles.guard';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.ROOT)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('dashboard') dashboard(@CurrentAuth() _auth: AuthPrincipal) { return this.monitoring.dashboard(); }
  @Get('errors') errors(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('statusCode') statusCode?: string,
    @Query('kind') kind?: string,
    @Query('communityId') communityId?: string,
    @Query('userId') userId?: string,
    @Query('take') take?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const count = Number.parseInt(take ?? '100', 10);
    return this.monitoring.listErrors({
      from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
      to: toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
      statusCode: statusCode && /^\d{3}$/.test(statusCode) ? Number(statusCode) : undefined,
      kind: kind === 'client' || kind === 'server' ? kind : undefined,
      communityId, userId,
      take: Number.isFinite(count) ? Math.max(1, Math.min(200, count)) : 100,
    });
  }
  @Get('filters/communities') communities() { return this.monitoring.listCommunities(); }
  @Get('filters/users') users() { return this.monitoring.listUsers(); }

  // Keep old cached frontends from repeatedly logging a missing-route error
  // while their EventSource bundle is replaced with the authenticated fetch stream.
  @Post('stream-token') legacyStreamToken(@CurrentAuth() _auth: AuthPrincipal) {
    return { token: '', expiresInSeconds: 0 };
  }

  @Get('events') async events(@Req() request: Request, @Res() response: Response) {
    const from = typeof request.query.from === 'string' ? new Date(request.query.from) : undefined;
    const to = typeof request.query.to === 'string' ? new Date(request.query.to) : undefined;
    const filters = {
      kind: request.query.kind === 'client' || request.query.kind === 'server' ? request.query.kind : undefined,
      communityId: typeof request.query.communityId === 'string' ? request.query.communityId : undefined,
      userId: typeof request.query.userId === 'string' ? request.query.userId : undefined,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    };
    response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    response.write(': connected\n\n');
    const subscription = this.monitoring.subscribeToErrors(filters).subscribe((data) => {
      response.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
    request.on('close', () => { clearInterval(heartbeat); subscription.unsubscribe(); });
  }
}
