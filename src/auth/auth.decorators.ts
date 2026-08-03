import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { AuthPrincipal } from './auth.types';

export const PLATFORM_ROLES_KEY = 'platformRoles';

export const PlatformRoles = (...roles: PlatformRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<{
      auth: AuthPrincipal;
    }>();
    return request.auth;
  },
);
