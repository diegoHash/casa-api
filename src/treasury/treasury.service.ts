import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethodType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CreateBankAccountDto,
  CreatePaymentMethodDto,
  UpdateBankAccountDto,
  UpdatePaymentMethodDto,
} from './dto/treasury.dto';

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  snapshot(communityId: string) {
    return this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
      select: {
        id: true,
        bankAccounts: { orderBy: { createdAt: 'desc' } },
        paymentMethods: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async createBankAccount(
    communityId: string,
    actorUserId: string,
    input: CreateBankAccountDto,
  ) {
    const accountNumber = input.accountNumber.replace(/\s/g, '');
    const duplicate = await this.prisma.bankAccount.findUnique({
      where: { communityId_accountNumber: { communityId, accountNumber } },
    });
    if (duplicate) {
      throw new ConflictException(
        'Esta cuenta bancaria ya está registrada en la comunidad.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.bankAccount.create({
        data: {
          communityId,
          bankName: input.bankName.trim(),
          holder: input.holder.trim(),
          holderRif: input.holderRif.trim().toUpperCase(),
          accountNumber,
          accountType: input.accountType.trim(),
          currency: input.currency,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'BANK_ACCOUNT_CREATED',
        'BankAccount',
        account.id,
        'Cuenta bancaria registrada',
        account,
      );
      return account;
    });
  }

  async createPaymentMethod(
    communityId: string,
    actorUserId: string,
    input: CreatePaymentMethodDto,
  ) {
    if (input.bankAccountId) {
      const account = await this.prisma.bankAccount.findFirst({
        where: { id: input.bankAccountId, communityId },
      });
      if (!account) {
        throw new NotFoundException(
          'La cuenta bancaria no pertenece a esta comunidad.',
        );
      }
      if (
        input.type === PaymentMethodType.BANK_TRANSFER &&
        account.currency !== input.currency
      ) {
        throw new ConflictException(
          'La moneda del método debe coincidir con la cuenta bancaria.',
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const method = await tx.paymentMethod.create({
        data: {
          communityId,
          bankAccountId: input.bankAccountId ?? null,
          type: input.type,
          label: input.label.trim(),
          currency: input.currency,
          mobilePhone: input.mobilePhone?.trim() || null,
          mobileDocument: input.mobileDocument?.trim() || null,
          instructions: input.instructions?.trim() || null,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'PAYMENT_METHOD_CREATED',
        'PaymentMethod',
        method.id,
        'Método de pago habilitado',
        method,
      );
      return method;
    });
  }

  async updateBankAccount(
    communityId: string,
    id: string,
    actorUserId: string,
    input: UpdateBankAccountDto,
  ) {
    const existing = await this.prisma.bankAccount.findFirst({
      where: { id, communityId },
    });
    if (!existing) {
      throw new NotFoundException('Cuenta bancaria no encontrada.');
    }

    if (input.accountNumber) {
      const accountNumber = input.accountNumber.replace(/\s/g, '');
      const duplicate = await this.prisma.bankAccount.findFirst({
        where: {
          communityId,
          accountNumber,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'Esta cuenta bancaria ya está registrada en la comunidad.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.bankAccount.update({
        where: { id },
        data: {
          ...(input.bankName && { bankName: input.bankName.trim() }),
          ...(input.holder && { holder: input.holder.trim() }),
          ...(input.holderRif && {
            holderRif: input.holderRif.trim().toUpperCase(),
          }),
          ...(input.accountNumber && {
            accountNumber: input.accountNumber.replace(/\s/g, ''),
          }),
          ...(input.accountType && { accountType: input.accountType.trim() }),
          ...(input.currency && { currency: input.currency }),
        },
      });

      await this.audit(
        tx,
        communityId,
        actorUserId,
        'BANK_ACCOUNT_UPDATED',
        'BankAccount',
        account.id,
        'Cuenta bancaria actualizada',
        account,
      );
      return account;
    });
  }

  async deactivateBankAccount(communityId: string, id: string, actorUserId: string) {
    const existing = await this.prisma.bankAccount.findFirst({ where: { id, communityId } });
    if (!existing) throw new NotFoundException('Cuenta bancaria no encontrada.');
    const updated = await this.prisma.bankAccount.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.audit(this.prisma, communityId, actorUserId, 'BANK_ACCOUNT_DEACTIVATED', 'BankAccount', id, 'Cuenta bancaria desactivada', updated);
    return updated;
  }

  async updatePaymentMethod(
    communityId: string,
    id: string,
    actorUserId: string,
    input: UpdatePaymentMethodDto,
  ) {
    const existing = await this.prisma.paymentMethod.findFirst({
      where: { id, communityId },
    });
    if (!existing) {
      throw new NotFoundException('Método de pago no encontrado.');
    }

    const bankAccountId =
      input.bankAccountId !== undefined
        ? input.bankAccountId
        : existing.bankAccountId;
    const type = input.type || existing.type;
    const currency = input.currency || existing.currency;

    if (bankAccountId) {
      const account = await this.prisma.bankAccount.findFirst({
        where: { id: bankAccountId, communityId },
      });
      if (!account) {
        throw new NotFoundException(
          'La cuenta bancaria no pertenece a esta comunidad.',
        );
      }
      if (
        type === PaymentMethodType.BANK_TRANSFER &&
        account.currency !== currency
      ) {
        throw new ConflictException(
          'La moneda del método debe coincidir con la cuenta bancaria.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const method = await tx.paymentMethod.update({
        where: { id },
        data: {
          ...(input.type && { type: input.type }),
          ...(input.label && { label: input.label.trim() }),
          ...(input.currency && { currency: input.currency }),
          ...(input.bankAccountId !== undefined && {
            bankAccountId: input.bankAccountId || null,
          }),
          ...(input.mobilePhone !== undefined && {
            mobilePhone: input.mobilePhone?.trim() || null,
          }),
          ...(input.mobileDocument !== undefined && {
            mobileDocument: input.mobileDocument?.trim() || null,
          }),
          ...(input.instructions !== undefined && {
            instructions: input.instructions?.trim() || null,
          }),
        },
      });

      await this.audit(
        tx,
        communityId,
        actorUserId,
        'PAYMENT_METHOD_UPDATED',
        'PaymentMethod',
        method.id,
        'Método de pago actualizado',
        method,
      );
      return method;
    });
  }

  async deactivatePaymentMethod(communityId: string, id: string, actorUserId: string) {
    const existing = await this.prisma.paymentMethod.findFirst({ where: { id, communityId } });
    if (!existing) throw new NotFoundException('Método de pago no encontrado.');
    const updated = await this.prisma.paymentMethod.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.audit(this.prisma, communityId, actorUserId, 'PAYMENT_METHOD_DEACTIVATED', 'PaymentMethod', id, 'Método de pago desactivado', updated);
    return updated;
  }

  private audit(
    client: PrismaService | Prisma.TransactionClient,
    communityId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail: string,
    after: unknown,
  ) {
    return client.auditEvent.create({
      data: {
        communityId,
        actorUserId,
        requestId: randomUUID(),
        action,
        entityType,
        entityId,
        detail,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
