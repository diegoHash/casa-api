import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessStatus } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { AuthPrincipal } from './auth.types';
import { TokenService } from './token.service';

type AuthenticatedRequest = Request & { auth?: AuthPrincipal };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token de acceso.');
    }

    const payload = this.tokens.verifyAccessToken(authorization.slice(7));
    const user = await this.prisma.appUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        platformRole: true,
        status: true,
        tokenVersion: true,
      },
    });
    if (
      !user ||
      user.status !== AccessStatus.ACTIVE ||
      user.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException(
        'La sesión ya no es válida para este usuario.',
      );
    }

    request.auth = {
      userId: user.id,
      email: user.email,
      platformRole: user.platformRole,
      tokenVersion: user.tokenVersion,
      communityId: payload.communityId,
      communityRole: payload.communityRole,
      scopes: payload.scopes ?? [],
      workspaces: payload.workspaces ?? [],
    };
    return true;
  }
}
