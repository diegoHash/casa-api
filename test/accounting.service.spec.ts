import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  LedgerAccountType,
  Prisma,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AccountingService } from '../src/accounting/accounting.service';

function serviceWith(prisma: object) {
  return new AccountingService(prisma as never);
}

const openPeriod = {
  id: 'period-a',
  communityId: 'community-a',
  status: AccountingPeriodStatus.OPEN,
  startsOn: new Date('2026-07-01T00:00:00.000Z'),
  endsOn: new Date('2026-07-31T23:59:59.999Z'),
};

describe('AccountingService', () => {
  it('rechaza un asiento cuyos débitos y créditos no coinciden', async () => {
    const transaction = vi.fn();
    const service = serviceWith({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue(openPeriod) },
      ledgerAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cash', communityId: 'community-a' },
          { id: 'income', communityId: 'community-a' },
        ]),
      },
      $transaction: transaction,
    });

    await expect(
      service.createEntry('community-a', 'actor-a', {
        accountingPeriodId: openPeriod.id,
        entryDate: '2026-07-15T12:00:00.000Z',
        description: 'Asiento inválido',
        lines: [
          { accountId: 'cash', debit: 100, credit: 0 },
          { accountId: 'income', debit: 0, credit: 90 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rechaza cuentas ajenas a la comunidad seleccionada', async () => {
    const transaction = vi.fn();
    const service = serviceWith({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue(openPeriod) },
      ledgerAccount: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'cash', communityId: 'community-a' }]),
      },
      $transaction: transaction,
    });

    await expect(
      service.createEntry('community-a', 'actor-a', {
        accountingPeriodId: openPeriod.id,
        entryDate: '2026-07-15T12:00:00.000Z',
        description: 'Cruce entre comunidades',
        lines: [
          { accountId: 'cash', debit: 100, credit: 0 },
          { accountId: 'foreign-income', debit: 0, credit: 100 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('impide volver a contabilizar un asiento definitivo', async () => {
    const update = vi.fn();
    const transaction = vi.fn((operation: (client: object) => unknown) =>
      Promise.resolve(
        operation({
          journalEntry: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'entry-a',
              communityId: 'community-a',
              status: JournalEntryStatus.POSTED,
              entryDate: new Date('2026-07-15T12:00:00.000Z'),
              accountingPeriod: openPeriod,
              lines: [
                {
                  debit: new Prisma.Decimal(100),
                  credit: new Prisma.Decimal(0),
                },
                {
                  debit: new Prisma.Decimal(0),
                  credit: new Prisma.Decimal(100),
                },
              ],
            }),
            update,
          },
        }),
      ),
    );
    const service = serviceWith({ $transaction: transaction });

    await expect(
      service.postEntry('community-a', 'actor-a', 'entry-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('impide cerrar un período con asientos en borrador', async () => {
    const update = vi.fn();
    const service = serviceWith({
      accountingPeriod: {
        findFirst: vi.fn().mockResolvedValue(openPeriod),
        update,
      },
      journalEntry: { count: vi.fn().mockResolvedValue(2) },
    });

    await expect(
      service.closePeriod('community-a', 'actor-a', openPeriod.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('deriva saldo normal deudor para activos y acreedor para ingresos', async () => {
    const normalBalances: string[] = [];
    const create = vi.fn(
      (input: { data: { normalBalance: string; type: LedgerAccountType } }) => {
        normalBalances.push(input.data.normalBalance);
        return Promise.resolve({
          id: `account-${normalBalances.length}`,
          type: input.data.type,
        });
      },
    );
    const service = serviceWith({
      ledgerAccount: { findUnique: vi.fn(), create },
      auditEvent: { create: vi.fn() },
    });

    await service.createAccount('community-a', 'actor-a', {
      code: '1101',
      name: 'Banco',
      type: LedgerAccountType.ASSET,
    });
    await service.createAccount('community-a', 'actor-a', {
      code: '4101',
      name: 'Cuotas',
      type: LedgerAccountType.INCOME,
    });

    expect(normalBalances).toEqual(['DEBIT', 'CREDIT']);
  });
});
