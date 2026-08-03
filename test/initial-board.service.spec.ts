import { AdministrationMode, DocumentType, PropertyKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CoreService } from '../src/core/core.service';

function member(documentNumber = '12345678') {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: DocumentType.V,
    documentNumber,
    phone: '04141234567',
    email: 'ana@example.com',
    position: 'Presidenta',
    startsOn: '2026-07-28',
    propertyKind: PropertyKind.APARTMENT,
    propertyCode: 'A-101',
    ownershipPercentage: 100,
    aliquot: 1.25,
    maximumOccupancy: 6,
    braceletQuota: 4,
  };
}

describe('CoreService.setupBoardAdministration', () => {
  it('rechaza una persona repetida antes de crear registros', async () => {
    const transaction = {
      community: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'community-1',
          administrationMode: AdministrationMode.BOARD,
        }),
      },
      boardAppointment: { count: vi.fn().mockResolvedValue(0) },
      person: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = new CoreService(prisma as never);

    await expect(
      service.setupBoardAdministration('community-1', 'root-1', {
        members: [member(), { ...member(), position: 'Tesorera' }],
      }),
    ).rejects.toThrow('Una misma persona no puede ocupar dos cargos vigentes');
    expect(transaction.person.create).not.toHaveBeenCalled();
  });

  it('crea persona, inmueble, titularidad y cargo en la misma transacción', async () => {
    const transaction = {
      community: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'community-1',
          administrationMode: AdministrationMode.INTERNAL,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      boardAppointment: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'board-1' }),
      },
      person: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'person-1',
          firstName: 'Ana',
          lastName: 'Pérez',
        }),
      },
      communityPerson: { upsert: vi.fn().mockResolvedValue({}) },
      property: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'property-1',
          code: 'A-101',
        }),
      },
      propertyAliquotPeriod: { create: vi.fn().mockResolvedValue({}) },
      ownership: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'ownership-1' }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = new CoreService(prisma as never);

    const result = await service.setupBoardAdministration(
      'community-1',
      'root-1',
      { members: [member()] },
    );

    expect(result.members).toEqual([
      {
        personId: 'person-1',
        propertyId: 'property-1',
        ownershipId: 'ownership-1',
        appointmentId: 'board-1',
      },
    ]);
    expect(transaction.communityPerson.upsert).toHaveBeenCalledOnce();
    expect(transaction.ownership.create).toHaveBeenCalledOnce();
    expect(transaction.boardAppointment.create).toHaveBeenCalledOnce();
    expect(transaction.community.update).toHaveBeenCalledWith({
      where: { id: 'community-1' },
      data: {
        administrationMode: AdministrationMode.BOARD,
        administratorName: null,
        administratorRif: null,
      },
    });
  });
});
