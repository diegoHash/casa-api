import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPeriodStatus,
  Currency,
  ExpenseAllocationMethod,
  ExpensePaymentSource,
  LedgerAccountType,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/billing/billing.service';

function serviceWith(prisma: object) {
  return new BillingService(prisma as never);
}

describe('BillingService', () => {
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
  it('exige reconocer como anticipo el excedente de un pago', async () => {
    const transaction = vi.fn();
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
      chargeNoticeAllocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'allocation-a',
          propertyId: 'property-a',
          totalVes: new Prisma.Decimal(60),
          chargeNotice: { status: 'ISSUED' },
        }),
      },
      paymentMethod: { findFirst: vi.fn() },
      bankAccount: { findFirst: vi.fn() },
      ledgerAccount: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'bank-ledger',
            type: LedgerAccountType.ASSET,
            acceptsEntries: true,
            bankAccountId: null,
          })
          .mockResolvedValueOnce({
            id: 'receivable-ledger',
            type: LedgerAccountType.ASSET,
            acceptsEntries: true,
          }),
      },
      ownerPayment: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { appliedToNoticeVes: null },
        }),
      },
      $transaction: transaction,
    });

    await expect(
      service.createOwnerPayment('community-a', 'actor-a', {
        propertyId: 'property-a',
        chargeNoticeAllocationId: 'allocation-a',
        receiptAccountId: 'bank-ledger',
        receivableAccountId: 'receivable-ledger',
        amount: 100,
        currency: Currency.VES,
        exchangeRate: 1,
        reference: 'PM-001',
        paidAt: '2026-08-01T10:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
