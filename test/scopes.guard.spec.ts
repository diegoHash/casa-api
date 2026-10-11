import { ForbiddenException } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ScopesGuard } from '../src/auth/scopes.guard';
import { REQUIRED_ANY_SCOPES_KEY } from '../src/auth/scopes.decorator';

function guardFor(scopes: string[]) {
  const reflector = {
    getAllAndOverride: () => scopes,
  };
  return new ScopesGuard(reflector as never);
}

function anyScopeGuardFor(scopes: string[]) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === REQUIRED_ANY_SCOPES_KEY ? scopes : undefined,
  };
  return new ScopesGuard(reflector as never);
}

function contextFor(
  granted: string[],
  platformRole: PlatformRole | null = null,
  workspace?: string,
  workspaces: string[] = [],
) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-casa-workspace': workspace },
        auth: {
          userId: 'user-1',
          email: 'personal@casa.site',
          platformRole,
          tokenVersion: 0,
          scopes: granted,
          workspaces,
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

  it('rechaza un comodín de dominio', () => {
    expect(() =>
      guardFor(['core.properties.write']).canActivate(contextFor(['core.*'])),
    ).toThrow(ForbiddenException);
  });

  it('rechaza permisismo implícito (accounting.write no concede accounting.post)', () => {
    expect(() =>
      guardFor(['accounting.post']).canActivate(
        contextFor(['accounting.write']),
      ),
    ).toThrow(ForbiddenException);
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

  it('autoriza cualquiera de los permisos alternativos', () => {
    expect(
      anyScopeGuardFor([
        'owner_service.authorizations.read',
        'access_control.authorizations.read',
      ]).canActivate(contextFor(['access_control.authorizations.read'])),
    ).toBe(true);
  });
});

describe('permisos compartidos independientes por espacio', () => {
  for (const [permission, workspaces] of [
    ...['read', 'write', 'banks.write', 'methods.write'].map((operation) => [`treasury.${operation}`, ['ADMINISTRATION', 'ACCOUNTING']]),
    ['core.board.write', ['ADMINISTRATION', 'BOARD']],
  ] as Array<[string, string[]]>) {
    for (const workspace of workspaces) {
      const other =
        workspace === 'ADMINISTRATION' ? 'ACCOUNTING' : 'ADMINISTRATION';
      it(`${permission}: permite ${workspace} y rechaza ${other}`, () => {
        const guard = guardFor([permission]);
        const grants = [`${workspace}:${permission}`];
        expect(
          guard.canActivate(
            contextFor(grants, null, workspace, [workspace, other]),
          ),
        ).toBe(true);
        expect(() =>
          guard.canActivate(
            contextFor(grants, null, other, [workspace, other]),
          ),
        ).toThrow(ForbiddenException);
        expect(() =>
          guard.canActivate(contextFor(grants, null, workspace, [other])),
        ).toThrow(ForbiddenException);
        expect(() => guard.canActivate(contextFor(grants))).toThrow(
          ForbiddenException,
        );
      });
    }
  }
});
