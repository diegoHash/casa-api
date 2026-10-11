import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BillingPeriodStatus,
  Currency,
  ExpenseAllocationMethod,
  ExpensePaymentSource,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/billing/billing.service';
import { AuthPrincipal } from '../src/auth/auth.types';

function serviceWith(prisma: object) {
  return new BillingService(prisma as never);
}

describe('BillingService', () => {
  const reconciler: AuthPrincipal = {
    userId: 'administrator-a',
    email: 'admin@community.test',
    platformRole: null,
    tokenVersion: 0,
    communityId: 'community-a',
    communityRole: 'ADMINISTRACION',
    scopes: ['billing.payments.reconcile'],
    workspaces: ['ADMINISTRATION'],
  };

  it('impide registrar un gasto en un período de otra comunidad', async () => {
    const periodExpenseCreate = vi.fn();
    const service = serviceWith({
      billingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      expenseCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'category-a',
          communityId: 'community-a',
          status: RecordStatus.ACTIVE,
        }),
      },
      periodExpense: { create: periodExpenseCreate },
    });

    await expect(
      service.createExpense('community-a', 'actor-a', 'period-b', {
        conceptId: 'concept-a',
        description: 'Vigilancia',
        amount: 100,
        currency: Currency.USD,
        allocationMethod: ExpenseAllocationMethod.ALIQUOT,
        beneficiaryName: 'Empresa Vigilancia',
        beneficiaryDocument: 'J-12345678',
        paymentSource: ExpensePaymentSource.BANK_ACCOUNT,
        paymentReference: 'REF-001',
        paidAt: '2026-01-15T00:00:00.000Z',
        expenseAccountId: 'acc-expense-1',
        paymentAccountId: 'acc-bank-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(periodExpenseCreate).not.toHaveBeenCalled();
  });

  it('impide modificar financieramente un período ya emitido', async () => {
    const periodExpenseCreate = vi.fn();
    const service = serviceWith({
      billingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'period-a',
          communityId: 'community-a',
          status: BillingPeriodStatus.ISSUED,
        }),
      },
      expenseCategory: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'category-a',
          communityId: 'community-a',
          status: RecordStatus.ACTIVE,
        }),
      },
      periodExpense: { create: periodExpenseCreate },
    });

    await expect(
      service.createExpense('community-a', 'actor-a', 'period-a', {
        conceptId: 'concept-a',
        description: 'Vigilancia',
        amount: 100,
        currency: Currency.USD,
        allocationMethod: ExpenseAllocationMethod.ALIQUOT,
        beneficiaryName: 'Empresa Vigilancia',
        beneficiaryDocument: 'J-12345678',
        paymentSource: ExpensePaymentSource.BANK_ACCOUNT,
        paymentReference: 'REF-001',
        paidAt: '2026-01-15T00:00:00.000Z',
        expenseAccountId: 'acc-expense-1',
        paymentAccountId: 'acc-bank-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(periodExpenseCreate).not.toHaveBeenCalled();
  });
  it('registra el pago para conciliación sin escribir importes o relaciones legadas', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'payment-a' });
    const transaction = vi.fn(async (callback) =>
      callback({
        ownerPayment: { create },
        auditEvent: { create: vi.fn() },
      }),
    );
    const service = serviceWith({
      property: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'property-a',
          code: 'A-01',
          communityId: 'community-a',
          status: RecordStatus.ACTIVE,
        }),
      },
      ownership: { findFirst: vi.fn() },
      paymentMethod: { findFirst: vi.fn() },
      bankAccount: { findFirst: vi.fn() },
      $transaction: transaction,
    });

    await expect(service.createOwnerPayment('community-a', 'actor-a', {
        propertyId: 'property-a',
        amount: 100,
        currency: Currency.VES,
        exchangeRate: 1,
        reference: 'PM-001',
        paidAt: '2026-08-01T10:00:00.000Z',
      })).resolves.toEqual({ id: 'payment-a' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          amount: expect.anything(),
          currency: expect.anything(),
          amountVes: expect.anything(),
          appliedToNoticeVes: expect.anything(),
          advanceVes: expect.anything(),
          chargeNoticeAllocationId: expect.anything(),
          receiptAccountId: expect.anything(),
          receivableAccountId: expect.anything(),
          advanceAccountId: expect.anything(),
        }),
      }),
    );
  });

  it('concilia una sola vez con responsabilidad explícita y conserva al administrador responsable', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn();
    const transaction = vi.fn(async (callback) =>
      callback({
        communityAccess: {
          findFirst: vi.fn().mockResolvedValue({
            scopes: ['billing.payments.reconcile'],
          }),
        },
        ownerPayment: {
          findFirst: vi.fn().mockResolvedValue({ id: 'payment-a', status: 'REPORTED', propertyId: 'property-a', functionalAmount: new Prisma.Decimal(100), functionalCurrency: 'USD' }),
          updateMany,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'payment-a' }),
        },
        chargeNoticeAllocation: { findMany: vi.fn().mockResolvedValue([]) },
        auditEvent: { create: auditCreate },
      }),
    );
    const service = serviceWith({
      ownerPayment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'payment-a', status: 'REPORTED' }),
      },
      $transaction: transaction,
    });

    await expect(
      service.reconcileOwnerPayment('community-a', reconciler, 'payment-a'),
    ).resolves.toEqual({ id: 'payment-a' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-a', communityId: 'community-a', status: 'REPORTED' },
        data: expect.objectContaining({
          status: 'RECONCILED',
          reconciledById: 'administrator-a',
          reconciledAt: expect.any(Date),
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('concilia y aplica una sola vez por FIFO, distribuyendo el pago entre avisos', async () => {
    const applicationCreate = vi.fn()
      .mockResolvedValueOnce({ id: 'application-1' })
      .mockResolvedValueOnce({ id: 'application-2' });
    const findMany = vi.fn().mockResolvedValue([
      { id: 'allocation-old', chargeNoticeId: 'notice-old', totalUsd: new Prisma.Decimal(60) },
      { id: 'allocation-new', chargeNoticeId: 'notice-new', totalUsd: new Prisma.Decimal(70) },
    ]);
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        communityAccess: { findFirst: vi.fn().mockResolvedValue({ scopes: ['billing.payments.reconcile'] }) },
        ownerPayment: {
          findFirst: vi.fn().mockResolvedValue({ id: 'payment-a', status: 'REPORTED', propertyId: 'property-a', functionalAmount: new Prisma.Decimal(100), functionalCurrency: 'USD' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'payment-a', status: 'RECONCILED' }),
        },
        chargeNoticeAllocation: { findMany },
        chargeNotice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        paymentApplication: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { functionalAmount: null } }),
          create: applicationCreate,
        },
        auditEvent: { create: vi.fn() },
      })),
    });

    await service.reconcileOwnerPayment('community-a', reconciler, 'payment-a');
    expect(applicationCreate).toHaveBeenCalledTimes(2);
    expect(applicationCreate.mock.calls[0][0].data).toMatchObject({ ownerPaymentId: 'payment-a', chargeNoticeAllocationId: 'allocation-old' });
    expect(applicationCreate.mock.calls[0][0].data.functionalAmount.toString()).toBe('60');
    expect(applicationCreate.mock.calls[1][0].data).toMatchObject({ ownerPaymentId: 'payment-a', chargeNoticeAllocationId: 'allocation-new' });
    expect(applicationCreate.mock.calls[1][0].data.functionalAmount.toString()).toBe('40');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ propertyId: 'property-a' }),
    }));
  });

  it('permite anular un aviso ISSUED con OwnerPayment REPORTED y no modifica el pago', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const ownerPayment = { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() };
    const journalEntry = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'entry-a', accountingPeriodId: 'period-a', status: 'POSTED', reversal: null,
        entryDate: new Date('2026-08-01'), description: 'Aviso',
        accountingPeriod: { status: 'OPEN' },
        lines: [{ accountId: 'account-a', lineNumber: 1, description: 'AR', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0), transactionAmount: new Prisma.Decimal(100), transactionCurrency: 'USD', exchangeRate: new Prisma.Decimal(1), referenceType: 'CHARGE_NOTICE', referenceId: 'notice-a' }],
      }),
      create: vi.fn().mockResolvedValue({ id: 'reversal-a' }), update: vi.fn(),
    };
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        chargeNotice: {
          findFirst: vi.fn().mockResolvedValue({ id: 'notice-a', status: 'ISSUED', journalEntryId: 'entry-a' }),
          updateMany,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'notice-a', status: 'VOID' }),
        },
        paymentApplication: { count: vi.fn().mockResolvedValue(0) },
        ownerPayment,
        journalEntry,
        communityAccountingSettings: { update: vi.fn().mockResolvedValue({ nextJournalNumber: 2 }) },
        auditEvent: { create: vi.fn() },
      })),
    });

    await expect(service.voidChargeNotice('community-a', 'actor-a', 'notice-a'))
      .resolves.toEqual({ id: 'notice-a', status: 'VOID' });
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'notice-a', communityId: 'community-a', status: 'ISSUED' },
      data: { status: 'VOID' },
    }));
    expect(ownerPayment.update).not.toHaveBeenCalled();
    expect(ownerPayment.updateMany).not.toHaveBeenCalled();
    expect(ownerPayment.delete).not.toHaveBeenCalled();
  });

  it('permite anular un aviso ISSUED con pago RECONCILED sin PaymentApplication', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        chargeNotice: {
          findFirst: vi.fn().mockResolvedValue({ id: 'notice-a', status: 'ISSUED', journalEntryId: 'entry-a' }),
          updateMany,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'notice-a', status: 'VOID' }),
        },
        paymentApplication: { count: vi.fn().mockResolvedValue(0) },
        journalEntry: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'entry-a', accountingPeriodId: 'period-a', status: 'POSTED', reversal: null,
            entryDate: new Date('2026-08-01'), description: 'Aviso',
            accountingPeriod: { status: 'OPEN' },
            lines: [{ accountId: 'account-a', lineNumber: 1, description: 'AR', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0), transactionAmount: new Prisma.Decimal(100), transactionCurrency: 'USD', exchangeRate: new Prisma.Decimal(1), referenceType: 'CHARGE_NOTICE', referenceId: 'notice-a' }],
          }),
          create: vi.fn().mockResolvedValue({ id: 'reversal-a' }), update: vi.fn(),
        },
        communityAccountingSettings: { update: vi.fn().mockResolvedValue({ nextJournalNumber: 2 }) },
        auditEvent: { create: vi.fn() },
      })),
    });
    await expect(service.voidChargeNotice('community-a', 'actor-a', 'notice-a'))
      .resolves.toEqual({ id: 'notice-a', status: 'VOID' });
  });

  it('bloquea la anulación cuando existe dinero conciliado aplicado', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const applicationCount = vi.fn().mockResolvedValue(1);
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        chargeNotice: {
          findFirst: vi.fn().mockResolvedValue({ id: 'notice-a', status: 'ISSUED' }),
          updateMany,
        },
        paymentApplication: { count: applicationCount },
      })),
    });

    await expect(service.voidChargeNotice('community-a', 'actor-a', 'notice-a'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(applicationCount).toHaveBeenCalledWith({
      where: {
        chargeNoticeAllocation: { chargeNoticeId: 'notice-a' },
        ownerPayment: { status: 'RECONCILED' },
      },
    });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('no permite aplicar un pago rechazado', async () => {
    const applicationCreate = vi.fn();
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        ownerPayment: { findFirst: vi.fn().mockResolvedValue(null) },
        paymentApplication: { create: applicationCreate },
      })),
    });

    await expect(service.createPaymentApplication('community-a', 'actor-a', {
      ownerPaymentId: 'payment-rejected',
      chargeNoticeAllocationId: 'allocation-b',
      functionalAmount: 10,
    })).rejects.toThrow('conciliado');
    expect(applicationCreate).not.toHaveBeenCalled();
  });

  it('no permite crear PaymentApplication sobre un aviso anulado', async () => {
    const applicationCreate = vi.fn();
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        ownerPayment: {
          findFirst: vi.fn().mockResolvedValue({ id: 'payment-a', functionalAmount: 50, functionalCurrency: 'USD' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        chargeNoticeAllocation: { findFirst: vi.fn().mockResolvedValue(null) },
        paymentApplication: { create: applicationCreate },
      })),
    });
    await expect(service.createPaymentApplication('community-a', 'actor-a', {
      ownerPaymentId: 'payment-a',
      chargeNoticeAllocationId: 'void-allocation',
      functionalAmount: 10,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(applicationCreate).not.toHaveBeenCalled();
  });

  it('impide aplicar saldo de un inmueble a la deuda de otro inmueble', async () => {
    const applicationCreate = vi.fn();
    const service = serviceWith({
      $transaction: vi.fn(async (callback) => callback({
        ownerPayment: {
          findFirst: vi.fn().mockResolvedValue({ id: 'payment-a', propertyId: 'property-a', functionalAmount: 50, functionalCurrency: 'USD' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        chargeNoticeAllocation: { findFirst: vi.fn().mockResolvedValue({ id: 'allocation-b', propertyId: 'property-b', chargeNoticeId: 'notice-b', totalUsd: 50 }) },
        paymentApplication: { create: applicationCreate },
      })),
    });
    await expect(service.createPaymentApplication('community-a', 'actor-a', {
      ownerPaymentId: 'payment-a', chargeNoticeAllocationId: 'allocation-b', functionalAmount: 10,
    })).rejects.toThrow('mismo inmueble');
    expect(applicationCreate).not.toHaveBeenCalled();
  });

  it('reconstruye el saldo disponible del inmueble desde pagos y aplicaciones', async () => {
    const service = serviceWith({
      property: { findFirst: vi.fn().mockResolvedValue({ id: 'property-a', code: 'A-01' }) },
      ownerPayment: { findMany: vi.fn().mockResolvedValue([
        { id: 'payment-a', functionalAmount: new Prisma.Decimal(100), functionalCurrency: 'USD', reconciledAt: new Date('2026-01-01'), applications: [{ id: 'application-a', functionalAmount: new Prisma.Decimal(60), functionalCurrency: 'USD', appliedAt: new Date('2026-01-02'), chargeNoticeAllocationId: 'allocation-a' }] },
        { id: 'payment-b', functionalAmount: new Prisma.Decimal(50), functionalCurrency: 'USD', reconciledAt: new Date('2026-01-03'), applications: [] },
      ]) },
    });
    const result = await service.ownerPaymentBalance('community-a', 'property-a');
    expect(result.totalReconciled.toString()).toBe('150');
    expect(result.totalApplied.toString()).toBe('60');
    expect(result.availableAmount.toString()).toBe('90');
    expect(result.payments[0].availableAmount.toString()).toBe('40');
  });

});
