import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { AuthPrincipal } from '../src/auth/auth.types';
import { ClientsService } from '../src/platform/clients.service';
import { CreateCommunityAccessDto } from '../src/platform/dto/create-community-access.dto';

const delegatedAdmin: AuthPrincipal = {
  userId: 'admin-a',
  email: 'admin@comunidad.test',
  platformRole: null,
  tokenVersion: 0,
  communityId: 'community-a',
  communityRole: 'ADMINISTRACION',
  scopes: ['core.read', 'core.staff.write'],
  workspaces: ['ADMINISTRATION'],
};

function serviceWith(prisma: object) {
  return new ClientsService(prisma as never, {} as never);
}

describe('delegación de accesos comunitarios', () => {
  it('rechaza conceder un permiso superior al del administrador', () => {
    const prisma = { $transaction: vi.fn() };
    const service = serviceWith(prisma);

    expect(() =>
      service.createAccessUserForCommunity(delegatedAdmin, 'community-a', {
        personId: 'person-a',
        roleCode: 'TESORERIA',
        scopes: ['treasury.read'],
        workspaceCodes: ['ADMINISTRATION'],
        temporaryPassword: 'Casa-Segura-2026',
      }),
    ).toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza conceder un espacio superior al del administrador', () => {
    const service = serviceWith({ $transaction: vi.fn() });

    expect(() =>
      service.createAccessUserForCommunity(delegatedAdmin, 'community-a', {
        personId: 'person-a',
        roleCode: 'TESORERIA',
        scopes: ['core.read'],
        workspaceCodes: ['TREASURY'],
        temporaryPassword: 'Casa-Segura-2026',
      }),
    ).toThrow(ForbiddenException);
  });

  it('permite al administrador integral delegar permisos dentro de su comunidad', async () => {
    const prisma = { $transaction: vi.fn().mockResolvedValue({ ok: true }) };
    const service = serviceWith(prisma);
    const integralAdmin: AuthPrincipal = {
      ...delegatedAdmin,
      scopes: ['community.full_access'],
      workspaces: ['ADMINISTRATION', 'OWNER_SERVICE'],
    };

    await expect(
      service.createAccessUserForCommunity(integralAdmin, 'community-a', {
        personId: 'person-a',
        roleCode: 'ATENCION',
        scopes: ['owner_service.authorizations.sign'],
        workspaceCodes: ['OWNER_SERVICE'],
        temporaryPassword: 'Casa-Segura-2026',
      }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('permite a ROOT conceder acceso integral sin exigir scopes comunitarios en su token de plataforma', async () => {
    const prisma = { $transaction: vi.fn().mockResolvedValue({ ok: true }) };
    const service = serviceWith(prisma);
    const root: AuthPrincipal = {
      userId: 'root',
      email: 'root@somoscasa.site',
      platformRole: PlatformRole.ROOT,
      tokenVersion: 0,
      scopes: [],
      workspaces: [],
    };

    await expect(
      service.updateAccessForCommunity(
        root,
        'community-a',
        'access-a',
        {
          roleCode: 'ADMINISTRADOR_INTEGRAL',
          scopes: ['community.full_access'],
          workspaceCodes: [
            'ADMINISTRATION',
            'TREASURY',
            'OWNER_SERVICE',
            'PURCHASES',
            'COLLECTIONS',
            'CONTROL_PRINCIPAL',
            'WRISTBANDS',
            'BOARD',
          ],
          reason: 'Designación aprobada por CASA Control.',
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('busca el acceso exclusivamente dentro de la comunidad activa', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const transaction = {
      communityAccess: { findFirst },
    };
    const prisma = {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = serviceWith(prisma);

    await expect(
      service.updateAccessForCommunity(
        delegatedAdmin,
        'community-a',
        'access-b',
        {
          roleCode: 'LECTURA',
          scopes: ['core.read'],
          workspaceCodes: ['ADMINISTRATION'],
          reason: 'Cambio de responsabilidad aprobado.',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'access-b', communityId: 'community-a' },
      }),
    );
  });
});

describe('contraseña temporal del personal', () => {
  const dtoWithPassword = (temporaryPassword: string) =>
    Object.assign(new CreateCommunityAccessDto(), {
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'V',
      documentNumber: '12345678',
      email: 'ana@example.test',
      roleCode: 'LECTURA',
      scopes: ['core.read'],
      workspaceCodes: ['ADMINISTRATION'],
      temporaryPassword,
    });

  it('acepta exactamente ocho caracteres', async () => {
    const errors = await validate(dtoWithPassword('Casa2026'));
    expect(errors.find((error) => error.property === 'temporaryPassword')).toBe(
      undefined,
    );
  });

  it('rechaza siete caracteres', async () => {
    const errors = await validate(dtoWithPassword('Casa026'));
    expect(
      errors.find((error) => error.property === 'temporaryPassword'),
    ).toBeDefined();
  });

  it('permite seleccionar una persona existente sin recapturar su identidad', async () => {
    const dto = Object.assign(new CreateCommunityAccessDto(), {
      personId: 'person-a',
      roleCode: 'LECTURA',
      scopes: ['core.read'],
      workspaceCodes: ['ADMINISTRATION'],
      temporaryPassword: 'Casa2026',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });
});

describe('personal elegible para acceso', () => {
  it('devuelve una sola ficha por persona y marca el acceso ya existente', async () => {
    const person = {
      id: 'person-a',
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'V',
      documentNumber: '12345678',
      email: 'ana@example.test',
      phone: null,
      user: {
        email: 'ana@example.test',
        communities: [{ id: 'access-a', workspaces: [] }],
      },
    };
    const prisma = {
      community: {
        findUnique: vi.fn().mockResolvedValue({ id: 'community-a' }),
      },
      employment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'employment-new',
            personId: 'person-a',
            position: 'Coordinadora',
            department: 'Administración',
            engagementType: 'PROFESSIONAL_FEES',
            startsOn: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            person,
          },
          {
            id: 'employment-old',
            personId: 'person-a',
            position: 'Asistente',
            department: 'Administración',
            engagementType: 'PROFESSIONAL_FEES',
            startsOn: new Date('2025-01-01'),
            createdAt: new Date('2025-01-01'),
            person,
          },
        ]),
      },
    };
    const service = serviceWith(prisma);

    const result = await service.listAccessPersonnel('client-a');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        employmentId: 'employment-new',
        personId: 'person-a',
        canCreateAccess: false,
        access: expect.objectContaining({ id: 'access-a' }),
      }),
    );
  });
});
