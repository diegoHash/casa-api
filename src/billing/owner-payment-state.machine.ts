import { ConflictException } from '@nestjs/common';
import { OwnerPaymentStatus, Prisma } from '@prisma/client';

/** The authoritative lifecycle for newly reported CASA owner payments. */
export const OWNER_PAYMENT_INITIAL_STATUS = OwnerPaymentStatus.REPORTED;

const ALLOWED_TRANSITIONS: Readonly<Record<OwnerPaymentStatus, readonly OwnerPaymentStatus[]>> = {
  [OwnerPaymentStatus.REPORTED]: [OwnerPaymentStatus.RECONCILED, OwnerPaymentStatus.REJECTED],
  [OwnerPaymentStatus.RECONCILED]: [],
  [OwnerPaymentStatus.REJECTED]: [],
  // Retained database values from the retired flow. They are read-only here.
  [OwnerPaymentStatus.POSTED]: [],
  [OwnerPaymentStatus.REVERSED]: [],
};

export function assertOwnerPaymentTransition(from: OwnerPaymentStatus, to: OwnerPaymentStatus) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`La transición de pago ${from} a ${to} no está permitida.`);
  }
}

export function ownerPaymentTransitionData(
  to: OwnerPaymentStatus,
  actorUserId: string,
  at: Date,
): Prisma.OwnerPaymentUncheckedUpdateManyInput {
  if (to === OwnerPaymentStatus.RECONCILED) {
    return { status: to, reconciledAt: at, reconciledById: actorUserId };
  }
  if (to === OwnerPaymentStatus.REJECTED) {
    // A rejected payment is never represented as reconciled money.
    return { status: to, reconciledAt: null, reconciledById: null };
  }
  throw new ConflictException(`El estado destino ${to} no está disponible.`);
}
