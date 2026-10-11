import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import { AuthPrincipal } from './auth.types';
import {
  REQUIRED_ANY_SCOPES_KEY,
  REQUIRED_SCOPES_KEY,
} from './scopes.decorator';

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ANY_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length && !requiredAny?.length) return true;

    const request = context.switchToHttp().getRequest<{
      auth?: AuthPrincipal;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const auth = request.auth;
    if (auth?.platformRole === PlatformRole.ROOT) return true;

    const granted = auth?.scopes ?? [];
    const workspace = request.headers?.['x-casa-workspace'];
    // The header selects a context; it never grants membership or capability.
    const matches = (candidate: string, required: string) =>
      this.matches(candidate, required) ||
      (typeof workspace === 'string' &&
        !!auth?.workspaces.includes(workspace) &&
        candidate === `${workspace}:${required}`);
    const authorized = required?.length
      ? required.every((scope) =>
          granted.some((candidate) => matches(candidate, scope)),
        )
      : (requiredAny ?? []).some((scope) =>
          granted.some((candidate) => matches(candidate, scope)),
        );
    if (!authorized) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para realizar esta operación.',
      );
    }
    return true;
  }

  private matches(candidate: string, required: string) {
    return candidate === 'community.full_access' || candidate === required;
  }
}
