import { ConflictException } from '@nestjs/common';
import { OwnerPaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assertOwnerPaymentTransition,
  ownerPaymentTransitionData,
} from '../src/billing/owner-payment-state.machine';

describe('OwnerPayment state machine', () => {
  it('permite solamente REPORTED a RECONCILED o REJECTED', () => {
    expect(() => assertOwnerPaymentTransition(OwnerPaymentStatus.REPORTED, OwnerPaymentStatus.RECONCILED)).not.toThrow();
    expect(() => assertOwnerPaymentTransition(OwnerPaymentStatus.REPORTED, OwnerPaymentStatus.REJECTED)).not.toThrow();
  });

  it('bloquea transiciones terminales y estados legados', () => {
    expect(() => assertOwnerPaymentTransition(OwnerPaymentStatus.RECONCILED, OwnerPaymentStatus.REJECTED)).toThrow(ConflictException);
    expect(() => assertOwnerPaymentTransition(OwnerPaymentStatus.REJECTED, OwnerPaymentStatus.REPORTED)).toThrow(ConflictException);
    expect(() => assertOwnerPaymentTransition(OwnerPaymentStatus.POSTED, OwnerPaymentStatus.RECONCILED)).toThrow(ConflictException);
  });

  it('solo escribe trazabilidad de conciliación al conciliar', () => {
    const timestamp = new Date('2026-08-12T00:00:00.000Z');
    expect(ownerPaymentTransitionData(OwnerPaymentStatus.RECONCILED, 'admin-a', timestamp)).toEqual({
      status: OwnerPaymentStatus.RECONCILED,
      reconciledAt: timestamp,
      reconciledById: 'admin-a',
    });
    expect(ownerPaymentTransitionData(OwnerPaymentStatus.REJECTED, 'admin-a', timestamp)).toEqual({
      status: OwnerPaymentStatus.REJECTED,
      reconciledAt: null,
      reconciledById: null,
    });
  });
});
