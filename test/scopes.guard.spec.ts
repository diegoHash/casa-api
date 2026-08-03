import { ForbiddenException } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ScopesGuard } from '../src/auth/scopes.guard';

function guardFor(scopes: string[]) {
  const reflector = {
    getAllAndOverride: () => scopes,
  };
  return new ScopesGuard(reflector as never);
}

function contextFor(
  granted: string[],
  platformRole: PlatformRole | null = null,
) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        auth: {
          userId: 'user-1',
          email: 'personal@casa.site',
          platformRole,
          tokenVersion: 0,
          scopes: granted,
        },
      }),
    }),
  } as never;
}

describe('ScopesGuard', () => {
  it('autoriza un permiso exacto', () => {
    expect(
      guardFor(['treasury.write']).canActivate(contextFor(['treasury.write'])),
    ).toBe(true);
  });

  it('autoriza un comodín de dominio', () => {
    expect(
      guardFor(['core.properties.write']).canActivate(contextFor(['core.*'])),
    ).toBe(true);
  });

  it('autoriza el acceso integral dentro del contexto comunitario', () => {
    expect(
      guardFor(['owner_service.authorizations.sign']).canActivate(
        contextFor(['community.full_access']),
      ),
    ).toBe(true);
  });

  it('permite al root operar en cualquier dominio', () => {
    expect(
      guardFor(['treasury.write']).canActivate(
        contextFor([], PlatformRole.ROOT),
      ),
    ).toBe(true);
  });

  it('rechaza accesos sin el permiso requerido', () => {
    expect(() =>
      guardFor(['treasury.write']).canActivate(contextFor(['treasury.read'])),
    ).toThrow(ForbiddenException);
  });
});
