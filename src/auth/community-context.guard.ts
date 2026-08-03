import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessStatus, PlatformRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthPrincipal } from './auth.types';

@Injectable()
export class CommunityContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      auth?: AuthPrincipal;
    }>();
    const auth = request.auth;
    if (!auth?.communityId) {
      throw new ForbiddenException(
        'Selecciona una comunidad antes de continuar.',
      );
    }

    if (auth.platformRole === PlatformRole.ROOT) {
      const community = await this.prisma.community.findUnique({
        where: { id: auth.communityId },
        select: { id: true },
      });
      if (!community) {
        throw new ForbiddenException('La comunidad seleccionada no existe.');
      }
      return true;
    }

    const now = new Date();
    const access = await this.prisma.communityAccess.findFirst({
      where: {
        userId: auth.userId,
        communityId: auth.communityId,
        status: AccessStatus.ACTIVE,
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gt: now } }],
      },
      select: { id: true },
    });
    if (!access) {
      throw new ForbiddenException(
        'No tienes acceso vigente a esta comunidad.',
      );
    }
    return true;
  }
}
