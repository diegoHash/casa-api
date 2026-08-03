import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import { AuthPrincipal } from './auth.types';
import { REQUIRED_SCOPES_KEY } from './scopes.decorator';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{
      auth?: AuthPrincipal;
    }>();
    const auth = request.auth;
    if (auth?.platformRole === PlatformRole.ROOT) return true;

    const granted = auth?.scopes ?? [];
    const authorized = required.every((scope) =>
      granted.some((candidate) => this.matches(candidate, scope)),
    );
    if (!authorized) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para realizar esta operación.',
      );
    }
    return true;
  }

  private matches(candidate: string, required: string) {
    if (
      candidate === '*' ||
      candidate === 'community.full_access' ||
      candidate === required ||
      (candidate === 'treasury.write' && required.startsWith('treasury.')) ||
      (candidate === 'accounting.write' && required.startsWith('accounting.'))
    ) {
      return true;
    }
    if (!candidate.endsWith('.*')) return false;
    return required.startsWith(candidate.slice(0, -1));
  }
}
