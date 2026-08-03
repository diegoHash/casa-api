import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import { AuthPrincipal } from './auth.types';
import { PLATFORM_ROLES_KEY } from './auth.decorators';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const allowed = this.reflector.getAllAndOverride<PlatformRole[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      auth?: AuthPrincipal;
    }>();
    if (
      !request.auth?.platformRole ||
      !allowed.includes(request.auth.platformRole)
    ) {
      throw new ForbiddenException(
        'No tienes un rol de plataforma autorizado.',
      );
    }
    return true;
  }
}
