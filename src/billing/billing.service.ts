import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  AccessStatus,
  BillingPeriodStatus,
  ChargeNoticeStatus,
  Currency,
  ExpenseAllocationMethod,
  ExpensePaymentSource,
  JournalEntrySource,
  JournalEntryStatus,
  LedgerAccountType,
  PayableReminderStatus,
  PayableStatus,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthPrincipal } from '../auth/auth.types';
import {
  CreateBillingPeriodDto,
  DeleteBillingPeriodDto,
  CreateExpenseCategoryDto,
  CreateExpenseConceptDto,
  CreateVendorDto,
  ListExpenseConceptsQueryDto,
  ListVendorsQueryDto,
  CreateOwnerPaymentDto,
  CreatePaymentApplicationDto,
  CreatePeriodExpenseDto,
  CreateVendorPayableDto,
  CreatePayableReminderDto,
  PayVendorPayableDto,
  PrepareChargeNoticeDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseConceptDto,
  UpdateVendorPayableDto,
} from './dto/billing.dto';
import {
  assertOwnerPaymentTransition,
  OWNER_PAYMENT_INITIAL_STATUS,
  ownerPaymentTransitionData,
} from './owner-payment-state.machine';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireDefaultExpenseAccount(communityId: string, accountId: string) {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id: accountId, communityId, status: RecordStatus.ACTIVE },
    });
    if (!account || account.type !== LedgerAccountType.EXPENSE || !account.acceptsEntries) {
      throw new BadRequestException('La cuenta predeterminada debe ser una cuenta de gasto activa de esta comunidad.');
    }
    return account;
  }

  /** Retries only transient MySQL/Prisma concurrency conflicts, at most 3 times. */
  private async withFinancialTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === maxAttempts || !this.isRetryableTransactionError(error)) throw error;
      }
    }
    throw new Error('Unreachable financial transaction retry state.');
  }

  private isRetryableTransactionError(error: unknown): boolean {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      cause?: { code?: unknown; message?: unknown };
    };
    const code = String(candidate?.code ?? candidate?.cause?.code ?? '');
    const message = `${String(candidate?.message ?? '')} ${String(candidate?.cause?.message ?? '')}`;
    return code === 'P2034' || code === '1213' || code === '1205' ||
      /deadlock|lock wait timeout|serialization(?:\s+failure|\s+conflict)?/i.test(message);
  }

  /** Integration-only failure point; impossible to enable outside NODE_ENV=test. */
  private failpoint(name: string) {
    if (process.env.NODE_ENV === 'test' && process.env.CASA_TEST_FAILPOINT === name) {
      throw new Error(`Integration failpoint: ${name}`);
    }
  }

  async officialExchangeRate() {
    try {
      const response = await fetch(
        'https://ve.dolarapi.com/v1/dolares/oficial',
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) {
        throw new Error(`DolarAPI respondió ${response.status}`);
      }
      const data = (await response.json()) as {
        moneda?: string;
        fuente?: string;
        nombre?: string;
        promedio?: number;
        fechaActualizacion?: string;
      };
      if (
        data.moneda !== 'USD' ||
        !Number.isFinite(data.promedio) ||
        Number(data.promedio) <= 0 ||
        !data.fechaActualizacion
      ) {
        throw new Error('DolarAPI devolvió una tasa incompleta.');
      }
      return {
        moneda: data.moneda,
        fuente: data.fuente ?? 'oficial',
        nombre: data.nombre ?? 'Dólar',
        promedio: Number(data.promedio),
        fechaActualizacion: data.fechaActualizacion,
        consultadaEn: new Date().toISOString(),
      };
    } catch (error) {
      throw new BadGatewayException(
        'No fue posible consultar la tasa oficial. Intenta nuevamente antes de abrir el mes de gestión.',
        { cause: error },
      );
    }
  }

  private async ensureOpenBillingPeriod(communityId: string) {
    const latest = await this.prisma.billingPeriod.findFirst({
      where: { communityId },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    });
    if (latest?.status === BillingPeriodStatus.DRAFT) {
      await this.prisma.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey: latest.periodKey } },
        create: {
          communityId,
          periodKey: latest.periodKey,
          label: latest.label,
          startsOn: latest.startsOn,
          endsOn: latest.endsOn,
        },
        update: {},
      });
      return;
    }

    const caracasNow = new Date(Date.now() - 4 * 60 * 60 * 1000);
    let year = caracasNow.getUTCFullYear();
    let month = caracasNow.getUTCMonth();
    if (latest) {
      const [latestYear, latestMonth] = latest.periodKey.split('-').map(Number);
      const next = new Date(Date.UTC(latestYear, latestMonth, 1));
      year = next.getUTCFullYear();
      month = next.getUTCMonth();
    }
    const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const startsOn = new Date(Date.UTC(year, month, 1, 4));
    const endsOn = new Date(Date.UTC(year, month + 1, 1, 3, 59, 59, 999));
    const labelText = new Intl.DateTimeFormat('es-VE', {
      month: 'long', year: 'numeric', timeZone: 'America/Caracas',
    }).format(new Date(Date.UTC(year, month, 15, 16)));
    const label = labelText.charAt(0).toUpperCase() + labelText.slice(1);
    const rate = await this.officialExchangeRate();

    try {
      await this.prisma.$transaction(async (tx) => {
        if (latest?.status === BillingPeriodStatus.ISSUED && latest.endsOn < new Date()) {
          const closedAccountingPeriod = await tx.accountingPeriod.findUnique({
            where: { communityId_periodKey: { communityId, periodKey: latest.periodKey } },
          });
          if (closedAccountingPeriod?.status === AccountingPeriodStatus.OPEN) {
            const [draftEntries, unjournalizedExpenses, unreviewedPayments] = await Promise.all([
              tx.journalEntry.count({ where: { communityId, accountingPeriodId: closedAccountingPeriod.id, status: JournalEntryStatus.DRAFT } }),
              tx.periodExpense.count({ where: { communityId, billingPeriodId: latest.id, status: RecordStatus.ACTIVE, journalEntryId: null } }),
              tx.ownerPayment.count({
                where: {
                  communityId,
                  status: 'REPORTED',
                  paidAt: { gte: latest.startsOn, lte: latest.endsOn },
                },
              }),
            ]);
            if (draftEntries === 0 && unjournalizedExpenses === 0 && unreviewedPayments === 0) {
              await tx.accountingPeriod.update({
                where: { id: closedAccountingPeriod.id },
                data: { status: AccountingPeriodStatus.CLOSED, closedAt: new Date() },
              });
            }
          }
        }
        const period = await tx.billingPeriod.upsert({
          where: { communityId_periodKey: { communityId, periodKey } },
          create: {
            communityId,
            periodKey,
            label,
            startsOn,
            endsOn,
            bcvRate: new Prisma.Decimal(rate.promedio),
          },
          update: {},
        });
        await tx.accountingPeriod.upsert({
          where: { communityId_periodKey: { communityId, periodKey } },
          create: {
            communityId,
            periodKey,
            label,
            startsOn: period.startsOn,
            endsOn: period.endsOn,
          },
          update: {},
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Concurrent first loads may race on the unique community/month key.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const concurrentPeriod = await this.prisma.billingPeriod.findUnique({
        where: { communityId_periodKey: { communityId, periodKey } },
      });
      if (!concurrentPeriod) throw error;
    }
  }

  async snapshot(communityId: string) {
    await this.ensureOpenBillingPeriod(communityId);
    const snapshot = await this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
      select: {
        id: true,
        expenseCategories: {
          orderBy: [{ status: 'asc' }, { code: 'asc' }],
          include: {
            _count: {
              select: {
                concepts: {
                  where: { status: RecordStatus.ACTIVE },
                },
              },
            },
          },
        },
        billingPeriods: {
          orderBy: { startsOn: 'desc' },
          take: 18,
          include: {
            expenses: {
              where: { status: RecordStatus.ACTIVE },
              orderBy: { createdAt: 'asc' },
              include: {
                concept: { include: { category: true } },
                bankAccount: true,
                paymentMethod: true,
                expenseAccount: true,
                paymentAccount: true,
                journalEntry: {
                  select: { id: true, entryNumber: true, status: true },
                },
              },
            },
            chargeNotice: {
              include: {
                receivableAccount: true,
                billingIncomeAccount: true,
                journalEntry: {
                  select: { id: true, entryNumber: true, status: true },
                },
                components: { orderBy: { createdAt: 'asc' } },
                allocations: {
                  orderBy: { property: { code: 'asc' } },
                  include: {
                    property: { select: { id: true, code: true, kind: true } },
                  },
                },
              },
            },
          },
        },
        ownerPayments: {
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
          take: 200,
          include: {
            property: { select: { id: true, code: true, kind: true } },
            payerPerson: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                documentType: true,
                documentNumber: true,
              },
            },
            paymentMethod: true,
            bankAccount: true,
          },
        },
      },
    });
    return {
      ...snapshot,
      billingPeriods: await Promise.all(snapshot.billingPeriods.map(async (period) => {
        const noticeEligible = !period.chargeNotice || (
          period.chargeNotice.status !== ChargeNoticeStatus.ISSUED &&
          period.chargeNotice.status !== ChargeNoticeStatus.VOID &&
          !period.chargeNotice.journalEntryId
        );
        if (
          period.status !== BillingPeriodStatus.DRAFT || period.issuedAt || period.closedAt ||
          !noticeEligible || period.expenses.length > 0
        ) {
          const deleteBlockReason = period.status !== BillingPeriodStatus.DRAFT || period.issuedAt || period.closedAt
            ? 'Este mes ya no está en borrador.'
            : !noticeEligible
              ? 'El aviso ya fue emitido, anulado o tiene un asiento contable.'
              : 'Este mes tiene gastos registrados.';
          return { ...period, canDelete: false, deleteBlockReason };
        }
        const accountingPeriod = await this.prisma.accountingPeriod.findUnique({
          where: { communityId_periodKey: { communityId, periodKey: period.periodKey } },
          select: { id: true, status: true, lockedAt: true },
        });
        const [expenseCount, applicationCount, paymentCount, journalEntryCount] = await Promise.all([
          this.prisma.periodExpense.count({ where: { communityId, billingPeriodId: period.id } }),
          period.chargeNotice
            ? this.prisma.paymentApplication.count({ where: { chargeNoticeAllocation: { chargeNoticeId: period.chargeNotice.id } } })
            : Promise.resolve(0),
          this.prisma.ownerPayment.count({ where: { communityId, paidAt: { gte: period.startsOn, lte: period.endsOn } } }),
          accountingPeriod
            ? this.prisma.journalEntry.count({ where: { communityId, accountingPeriodId: accountingPeriod.id } })
            : Promise.resolve(0),
        ]);
        return {
          ...period,
          canDelete:
            (!accountingPeriod || (
              (accountingPeriod.status === AccountingPeriodStatus.OPEN ||
                accountingPeriod.status === AccountingPeriodStatus.CLOSED) &&
              !accountingPeriod.lockedAt
            )) &&
            expenseCount === 0 && applicationCount === 0 && paymentCount === 0 && journalEntryCount === 0,
          deleteBlockReason: accountingPeriod &&
            (accountingPeriod.status === AccountingPeriodStatus.LOCKED || accountingPeriod.lockedAt)
            ? 'El período contable está bloqueado.'
            : expenseCount > 0
              ? 'Este mes tiene gastos registrados.'
              : applicationCount > 0
                ? 'Este mes tiene pagos aplicados a un aviso.'
                : paymentCount > 0
                  ? 'Hay pagos registrados dentro de las fechas del mes.'
                  : journalEntryCount > 0
                    ? 'El período contable tiene asientos registrados.'
                    : null,
        };
      })),
    };
  }

  async ownerPaymentBalance(communityId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, communityId }, select: { id: true, code: true },
    });
    if (!property) throw new NotFoundException('El inmueble no pertenece a la comunidad seleccionada.');
    const payments = await this.prisma.ownerPayment.findMany({
      where: { communityId, propertyId, status: 'RECONCILED', functionalCurrency: 'USD', functionalAmount: { not: null } },
      select: { id: true, functionalAmount: true, functionalCurrency: true, reconciledAt: true, applications: { select: { id: true, functionalAmount: true, functionalCurrency: true, appliedAt: true, chargeNoticeAllocationId: true }, orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ reconciledAt: 'asc' }, { id: 'asc' }],
    });
    const breakdown = payments.map((payment) => {
      const appliedAmount = payment.applications.reduce((total, application) => total.plus(application.functionalAmount), new Prisma.Decimal(0));
      const reconciledAmount = payment.functionalAmount!;
      return { paymentId: payment.id, reconciledAt: payment.reconciledAt, functionalCurrency: payment.functionalCurrency, reconciledAmount, appliedAmount, availableAmount: reconciledAmount.minus(appliedAmount), applications: payment.applications };
    });
    const totalReconciled = breakdown.reduce((total, item) => total.plus(item.reconciledAmount), new Prisma.Decimal(0));
    const totalApplied = breakdown.reduce((total, item) => total.plus(item.appliedAmount), new Prisma.Decimal(0));
    return { property, functionalCurrency: 'USD', totalReconciled, totalApplied, availableAmount: totalReconciled.minus(totalApplied), payments: breakdown };
  }

  async createCategory(
    communityId: string,
    actorUserId: string,
    input: CreateExpenseCategoryDto,
  ) {
    const code = input.code.trim().toUpperCase().replace(/\s+/g, '-');
    if (
      await this.prisma.expenseCategory.findUnique({
        where: { communityId_code: { communityId, code } },
      })
    ) {
      throw new ConflictException(
        'Ya existe una categoría de gasto con este código.',
      );
    }
    const category = await this.prisma.expenseCategory.create({
      data: {
        communityId,
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'EXPENSE_CATEGORY_CREATED',
      'ExpenseCategory',
      category.id,
      'Categoría de gasto creada',
      category,
    );
    return category;
  }

  async updateCategory(
    communityId: string,
    actorUserId: string,
    categoryId: string,
    input: UpdateExpenseCategoryDto,
  ) {
    const current = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, communityId },
    });
    if (!current) {
      throw new NotFoundException(
        'La categoría no pertenece a la comunidad seleccionada.',
      );
    }
    const code = input.code?.trim().toUpperCase().replace(/\s+/g, '-');
    if (code && code !== current.code) {
      const duplicate = await this.prisma.expenseCategory.findUnique({
        where: { communityId_code: { communityId, code } },
      });
      if (duplicate) {
        throw new ConflictException(
          'Ya existe otra categoría con este código.',
        );
      }
    }
    const category = await this.prisma.expenseCategory.update({
      where: { id: categoryId },
      data: {
        code,
        name: input.name?.trim(),
        description:
          input.description === undefined
            ? undefined
            : input.description.trim() || null,
        status: input.status,
      },
      include: {
        _count: {
          select: {
            concepts: { where: { status: RecordStatus.ACTIVE } },
          },
        },
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'EXPENSE_CATEGORY_UPDATED',
      'ExpenseCategory',
      category.id,
      'Categoría de gasto actualizada',
      { before: current, after: category },
    );
    return category;
  }

  async listConcepts(communityId: string, query: ListExpenseConceptsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.ExpenseConceptWhereInput = {
      communityId,
      categoryId: query.categoryId,
      status: query.status,
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { name: { contains: search } },
              { description: { contains: search } },
              { category: { name: { contains: search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.expenseConcept.findMany({
        where,
        orderBy: [{ category: { code: 'asc' } }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true },
      }),
      this.prisma.expenseConcept.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async listVendors(communityId: string, query: ListVendorsQueryDto) {
    const search = query.search?.trim();
    return this.prisma.vendor.findMany({
      where: {
        communityId,
        status: RecordStatus.ACTIVE,
        ...(search
          ? {
              OR: [
                { legalName: { contains: search } },
                { document: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { legalName: 'asc' },
      take: 100,
    });
  }

  async listPayables(communityId: string) {
    return this.prisma.vendorPayable.findMany({
      where: { communityId, status: { not: PayableStatus.VOID } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        vendor: true,
        expenseAccount: { select: { id: true, code: true, name: true } },
        liabilityAccount: { select: { id: true, code: true, name: true } },
        paymentAccount: { select: { id: true, code: true, name: true } },
        reminders: { where: { status: PayableReminderStatus.ACTIVE }, orderBy: { remindAt: 'asc' } },
      },
    });
  }

  async listPayableReminders(communityId: string, payableId: string) {
    const payable = await this.prisma.vendorPayable.findFirst({ where: { id: payableId, communityId } });
    if (!payable) throw new NotFoundException('La cuenta por pagar no pertenece a la comunidad seleccionada.');
    return this.prisma.payableReminder.findMany({
      where: { communityId, payableId },
      orderBy: { remindAt: 'asc' },
    });
  }

  async createPayableReminder(communityId: string, actorUserId: string, payableId: string, input: CreatePayableReminderDto) {
    const payable = await this.prisma.vendorPayable.findFirst({ where: { id: payableId, communityId, status: { not: PayableStatus.VOID } } });
    if (!payable) throw new NotFoundException('La cuenta por pagar no pertenece a la comunidad seleccionada.');
    const remindAt = new Date(input.remindAt);
    if (Number.isNaN(remindAt.getTime())) throw new BadRequestException('La fecha del recordatorio no es válida.');
    if (remindAt.getTime() < Date.now()) throw new BadRequestException('El recordatorio debe configurarse para una fecha y hora futura.');
    const reminder = await this.prisma.payableReminder.create({ data: { communityId, payableId, createdById: actorUserId, remindAt, message: input.message?.trim() || null }, include: { payable: true } });
    await this.audit(this.prisma, communityId, actorUserId, 'VENDOR_PAYABLE_REMINDER_CREATED', 'PayableReminder', reminder.id, 'Recordatorio de cuenta por pagar configurado', reminder);
    return reminder;
  }

  async cancelPayableReminder(communityId: string, actorUserId: string, reminderId: string) {
    const reminder = await this.prisma.payableReminder.findFirst({ where: { id: reminderId, communityId } });
    if (!reminder) throw new NotFoundException('El recordatorio no pertenece a la comunidad seleccionada.');
    const updated = await this.prisma.payableReminder.update({ where: { id: reminderId }, data: { status: PayableReminderStatus.CANCELLED, completedAt: new Date() } });
    await this.audit(this.prisma, communityId, actorUserId, 'VENDOR_PAYABLE_REMINDER_CANCELLED', 'PayableReminder', reminderId, 'Recordatorio de cuenta por pagar cancelado', updated);
    return updated;
  }

  async createPayable(
    communityId: string,
    actorUserId: string,
    input: CreateVendorPayableDto,
  ) {
    const issueDate = new Date(input.issueDate);
    const dueDate = new Date(input.dueDate);
    if (input.category === 'OTHER' && !input.categoryLabel?.trim()) {
      throw new BadRequestException('Describe la categoría de la obligación cuando selecciones "Otros".');
    }
    if (dueDate < issueDate) {
      throw new BadRequestException('La fecha de vencimiento no puede ser anterior a la fecha de emisión.');
    }
    const [vendor, expenseAccount, liabilityAccount] = await Promise.all([
      input.vendorId
        ? this.prisma.vendor.findFirst({ where: { id: input.vendorId, communityId, status: RecordStatus.ACTIVE } })
        : null,
      input.expenseAccountId
        ? this.prisma.ledgerAccount.findFirst({ where: { id: input.expenseAccountId, communityId, status: RecordStatus.ACTIVE } })
        : null,
      input.liabilityAccountId
        ? this.prisma.ledgerAccount.findFirst({ where: { id: input.liabilityAccountId, communityId, status: RecordStatus.ACTIVE } })
        : null,
    ]);
    if (input.vendorId && !vendor) throw new NotFoundException('El proveedor no pertenece a la comunidad seleccionada.');
    if (expenseAccount && (expenseAccount.type !== LedgerAccountType.EXPENSE || !expenseAccount.acceptsEntries)) {
      throw new BadRequestException('La cuenta de gasto debe ser una cuenta activa de movimiento.');
    }
    if (liabilityAccount && (liabilityAccount.type !== LedgerAccountType.LIABILITY || !liabilityAccount.acceptsEntries)) {
      throw new BadRequestException('La cuenta por pagar debe ser una cuenta activa de pasivo.');
    }

    return this.withFinancialTransaction(async (tx) => {
      const payable = await tx.vendorPayable.create({
        data: {
          communityId,
          vendorId: vendor?.id ?? null,
          category: input.category,
          categoryLabel: input.categoryLabel?.trim() || null,
          supplierName: input.supplierName.trim(),
          supplierDocument: input.supplierDocument?.trim().toUpperCase() || vendor?.document || null,
          description: input.description.trim(),
          invoiceNumber: input.invoiceNumber?.trim() || null,
          issueDate,
          dueDate,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency,
          notes: input.notes?.trim() || null,
          expenseAccountId: expenseAccount?.id ?? null,
          liabilityAccountId: liabilityAccount?.id ?? null,
        },
      });
      let result = payable;
      if (expenseAccount && liabilityAccount) {
        const period = await tx.accountingPeriod.findFirst({
          where: { communityId, startsOn: { lte: issueDate }, endsOn: { gte: issueDate }, status: AccountingPeriodStatus.OPEN },
          orderBy: { startsOn: 'desc' },
        });
        if (!period) throw new ConflictException('Abre un período contable antes de contabilizar esta cuenta por pagar.');
        const billingPeriod = await tx.billingPeriod.findUnique({
          where: { communityId_periodKey: { communityId, periodKey: period.periodKey } },
        });
        if (!billingPeriod) throw new ConflictException('El período de gestión correspondiente no existe para convertir el importe a USD.');
        const settings = await tx.communityAccountingSettings.upsert({ where: { communityId }, create: { communityId }, update: {} });
        const sequence = await tx.communityAccountingSettings.update({ where: { communityId }, data: { nextJournalNumber: { increment: 1 } } });
        const amount = new Prisma.Decimal(input.amount);
        const amountUsd = this.toUsd(amount, input.currency, billingPeriod.bcvRate);
        const entry = await tx.journalEntry.create({
          data: {
            communityId,
            accountingPeriodId: period.id,
            entryNumber: sequence.nextJournalNumber - 1,
            entryDate: issueDate,
            description: `Cuenta por pagar: ${input.description.trim()}`,
            source: JournalEntrySource.PURCHASE,
            sourceId: payable.id,
            status: JournalEntryStatus.POSTED,
            postedAt: new Date(),
            postedById: actorUserId,
            createdById: actorUserId,
            lines: { create: [
              { communityId, accountId: expenseAccount.id, lineNumber: 1, description: input.description.trim(), debit: amountUsd, credit: new Prisma.Decimal(0), transactionAmount: amount, transactionCurrency: input.currency, exchangeRate: input.currency === Currency.VES ? billingPeriod.bcvRate : new Prisma.Decimal(1), referenceType: 'PAYABLE', referenceId: payable.id },
              { communityId, accountId: liabilityAccount.id, lineNumber: 2, description: `Obligación con ${input.supplierName.trim()}`, debit: new Prisma.Decimal(0), credit: amountUsd, transactionAmount: amount, transactionCurrency: input.currency, exchangeRate: input.currency === Currency.VES ? billingPeriod.bcvRate : new Prisma.Decimal(1), referenceType: 'PAYABLE', referenceId: payable.id },
            ] },
          },
        });
        result = await tx.vendorPayable.update({ where: { id: payable.id }, data: { initialJournalEntryId: entry.id } });
      }
      await this.audit(tx, communityId, actorUserId, 'VENDOR_PAYABLE_CREATED', 'VendorPayable', result.id, 'Cuenta por pagar registrada', result);
      return result;
    });
  }

  async updatePayable(communityId: string, actorUserId: string, id: string, input: UpdateVendorPayableDto) {
    const existing = await this.prisma.vendorPayable.findFirst({ where: { id, communityId } });
    if (!existing) throw new NotFoundException('La cuenta por pagar no pertenece a la comunidad seleccionada.');
    if (existing.status === PayableStatus.PAID || existing.status === PayableStatus.VOID) throw new ConflictException('La cuenta por pagar ya no admite edición.');
    if (input.status === PayableStatus.PAID || input.status === PayableStatus.PARTIALLY_PAID) throw new BadRequestException('El estado de pago se actualiza registrando un pago.');
    if (input.category === 'OTHER' && !input.categoryLabel?.trim()) {
      throw new BadRequestException('Describe la categoría de la obligación cuando selecciones "Otros".');
    }
    if (input.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({ where: { id: input.vendorId, communityId, status: RecordStatus.ACTIVE } });
      if (!vendor) throw new NotFoundException('El proveedor no pertenece a la comunidad seleccionada.');
    }
    const updated = await this.prisma.vendorPayable.update({ where: { id }, data: {
      ...(input.category !== undefined && { category: input.category }),
      ...(input.categoryLabel !== undefined && { categoryLabel: input.categoryLabel.trim() || null }),
      ...(input.supplierName !== undefined && { supplierName: input.supplierName.trim() }),
      ...(input.supplierDocument !== undefined && { supplierDocument: input.supplierDocument.trim().toUpperCase() || null }),
      ...(input.vendorId !== undefined && { vendorId: input.vendorId || null }),
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.invoiceNumber !== undefined && { invoiceNumber: input.invoiceNumber.trim() || null }),
      ...(input.issueDate !== undefined && { issueDate: new Date(input.issueDate) }),
      ...(input.dueDate !== undefined && { dueDate: new Date(input.dueDate) }),
      ...(input.amount !== undefined && { amount: new Prisma.Decimal(input.amount) }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.notes !== undefined && { notes: input.notes.trim() || null }),
      ...(input.status === PayableStatus.VOID && { status: PayableStatus.VOID }),
    } });
    await this.audit(this.prisma, communityId, actorUserId, 'VENDOR_PAYABLE_UPDATED', 'VendorPayable', id, 'Cuenta por pagar actualizada', updated);
    return updated;
  }

  async payPayable(communityId: string, actorUserId: string, id: string, input: PayVendorPayableDto) {
    const payable = await this.prisma.vendorPayable.findFirst({ where: { id, communityId }, include: { liabilityAccount: true } });
    if (!payable) throw new NotFoundException('La cuenta por pagar no pertenece a la comunidad seleccionada.');
    if (payable.status === PayableStatus.VOID || payable.status === PayableStatus.PAID) throw new ConflictException('La cuenta por pagar ya está cerrada.');
    const payment = new Prisma.Decimal(input.amount);
    const remaining = payable.amount.minus(payable.amountPaid);
    if (payment.greaterThan(remaining)) throw new BadRequestException('El pago supera el saldo pendiente de la cuenta por pagar.');
    const paymentAccount = input.paymentAccountId
      ? await this.prisma.ledgerAccount.findFirst({ where: { id: input.paymentAccountId, communityId, status: RecordStatus.ACTIVE } })
      : null;
    if (input.paymentAccountId && (!paymentAccount || paymentAccount.type !== LedgerAccountType.ASSET || !paymentAccount.acceptsEntries)) {
      throw new BadRequestException('La cuenta de pago debe ser un activo de movimiento de esta comunidad.');
    }
    return this.withFinancialTransaction(async (tx) => {
      const paidTotal = payable.amountPaid.plus(payment);
      const status = paidTotal.equals(payable.amount) ? PayableStatus.PAID : PayableStatus.PARTIALLY_PAID;
      let paymentJournalEntryId: string | undefined;
      if (paymentAccount && payable.liabilityAccount) {
        const paidAt = new Date(input.paidAt);
        const period = await tx.accountingPeriod.findFirst({ where: { communityId, startsOn: { lte: paidAt }, endsOn: { gte: paidAt }, status: AccountingPeriodStatus.OPEN }, orderBy: { startsOn: 'desc' } });
        if (!period) throw new ConflictException('Abre un período contable para registrar el pago.');
        const billingPeriod = await tx.billingPeriod.findUnique({
          where: { communityId_periodKey: { communityId, periodKey: period.periodKey } },
        });
        if (!billingPeriod) throw new ConflictException('El período de gestión correspondiente no existe para convertir el pago a USD.');
        await tx.communityAccountingSettings.upsert({ where: { communityId }, create: { communityId }, update: {} });
        const sequence = await tx.communityAccountingSettings.update({ where: { communityId }, data: { nextJournalNumber: { increment: 1 } } });
        const paymentUsd = this.toUsd(payment, payable.currency, billingPeriod.bcvRate);
        const entry = await tx.journalEntry.create({ data: { communityId, accountingPeriodId: period.id, entryNumber: sequence.nextJournalNumber - 1, entryDate: paidAt, description: `Pago de cuenta por pagar: ${payable.supplierName}`, source: JournalEntrySource.PAYMENT, sourceId: payable.id, status: JournalEntryStatus.POSTED, postedAt: new Date(), postedById: actorUserId, createdById: actorUserId, lines: { create: [
          { communityId, accountId: payable.liabilityAccount.id, lineNumber: 1, description: `Abono a ${payable.supplierName}`, debit: paymentUsd, credit: new Prisma.Decimal(0), transactionAmount: payment, transactionCurrency: payable.currency, exchangeRate: payable.currency === Currency.VES ? billingPeriod.bcvRate : new Prisma.Decimal(1), referenceType: 'PAYABLE_PAYMENT', referenceId: input.paymentReference || payable.id },
          { communityId, accountId: paymentAccount.id, lineNumber: 2, description: input.paymentReference || `Pago a ${payable.supplierName}`, debit: new Prisma.Decimal(0), credit: paymentUsd, transactionAmount: payment, transactionCurrency: payable.currency, exchangeRate: payable.currency === Currency.VES ? billingPeriod.bcvRate : new Prisma.Decimal(1), referenceType: 'PAYABLE_PAYMENT', referenceId: payable.id },
        ] } } });
        paymentJournalEntryId = entry.id;
      }
      const updated = await tx.vendorPayable.update({ where: { id }, data: { amountPaid: paidTotal, status, paymentAccountId: paymentAccount?.id ?? payable.paymentAccountId, paidAt: status === PayableStatus.PAID ? new Date(input.paidAt) : null, ...(paymentJournalEntryId ? { paymentJournalEntryId } : {}) }, include: { vendor: true, expenseAccount: true, liabilityAccount: true, paymentAccount: true } });
      await this.audit(tx, communityId, actorUserId, 'VENDOR_PAYABLE_PAYMENT', 'VendorPayable', id, 'Pago aplicado a cuenta por pagar', updated);
      return updated;
    });
  }

  async createVendor(
    communityId: string,
    actorUserId: string,
    input: CreateVendorDto,
  ) {
    const document = input.document.trim().toUpperCase();
    const existing = await this.prisma.vendor.findUnique({
      where: { communityId_document: { communityId, document } },
    });
    if (existing) {
      throw new ConflictException(
        'Ya existe un beneficiario con este RIF o cédula.',
      );
    }
    const vendor = await this.prisma.vendor.create({
      data: {
        communityId,
        legalName: input.legalName.trim(),
        document,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'VENDOR_CREATED',
      'Vendor',
      vendor.id,
      'Beneficiario registrado',
      vendor,
    );
    return vendor;
  }

  async createConcept(
    communityId: string,
    actorUserId: string,
    categoryId: string,
    input: CreateExpenseConceptDto,
  ) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: {
        id: categoryId,
        communityId,
        status: RecordStatus.ACTIVE,
      },
    });
    if (!category) {
      throw new NotFoundException(
        'La categoría no pertenece a la comunidad seleccionada.',
      );
    }
    if (input.defaultExpenseAccountId) {
      await this.requireDefaultExpenseAccount(communityId, input.defaultExpenseAccountId);
    }
    const code = input.code.trim().toUpperCase().replace(/\s+/g, '-');
    const duplicate = await this.prisma.expenseConcept.findUnique({
      where: { communityId_code: { communityId, code } },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe un concepto con este código dentro de la categoría.',
      );
    }
    const concept = await this.prisma.expenseConcept.create({
      data: {
        communityId,
        categoryId,
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        defaultExpenseAccountId: input.defaultExpenseAccountId ?? null,
      },
      include: { category: true, defaultExpenseAccount: true },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'EXPENSE_CONCEPT_CREATED',
      'ExpenseConcept',
      concept.id,
      `Concepto ${concept.name} creado en ${category.name}`,
      concept,
    );
    return concept;
  }

  async updateConcept(
    communityId: string,
    actorUserId: string,
    conceptId: string,
    input: UpdateExpenseConceptDto,
  ) {
    const current = await this.prisma.expenseConcept.findFirst({
      where: { id: conceptId, communityId },
    });
    if (!current) {
      throw new NotFoundException(
        'El concepto no pertenece a la comunidad seleccionada.',
      );
    }
    const categoryId = input.categoryId ?? current.categoryId;
    if (input.defaultExpenseAccountId) {
      await this.requireDefaultExpenseAccount(communityId, input.defaultExpenseAccountId);
    }
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, communityId },
    });
    if (!category) {
      throw new NotFoundException(
        'La categoría de destino no pertenece a esta comunidad.',
      );
    }
    const code =
      input.code?.trim().toUpperCase().replace(/\s+/g, '-') ?? current.code;
    if (categoryId !== current.categoryId || code !== current.code) {
      const duplicate = await this.prisma.expenseConcept.findUnique({
        where: { communityId_code: { communityId, code } },
      });
      if (duplicate && duplicate.id !== conceptId) {
        throw new ConflictException(
          'Ya existe otro concepto con este código dentro de la categoría.',
        );
      }
    }
    const concept = await this.prisma.expenseConcept.update({
      where: { id: conceptId },
      data: {
        categoryId,
        code,
        name: input.name?.trim(),
        description:
          input.description === undefined
            ? undefined
            : input.description.trim() || null,
        status: input.status,
        defaultExpenseAccountId:
          input.defaultExpenseAccountId === undefined
            ? undefined
            : input.defaultExpenseAccountId || null,
      },
      include: { category: true, defaultExpenseAccount: true },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'EXPENSE_CONCEPT_UPDATED',
      'ExpenseConcept',
      concept.id,
      'Concepto de gasto actualizado',
      { before: current, after: concept },
    );
    return concept;
  }

  async createPeriod(
    communityId: string,
    actorUserId: string,
    input: CreateBillingPeriodDto,
  ) {
    if (
      await this.prisma.billingPeriod.findUnique({
        where: {
          communityId_periodKey: { communityId, periodKey: input.periodKey },
        },
      })
    ) {
      throw new ConflictException(
        'El período indicado ya existe para esta comunidad.',
      );
    }
    const [year, month] = input.periodKey.split('-').map(Number);
    const startsOn = new Date(Date.UTC(year, month - 1, 1, 4));
    const endsOn = new Date(Date.UTC(year, month, 1, 3, 59, 59, 999));
    const officialRate = await this.officialExchangeRate();
    const period = await this.prisma.$transaction(async (tx) => {
      const created = await tx.billingPeriod.create({
        data: {
          communityId,
          periodKey: input.periodKey,
          label: input.label.trim(),
          startsOn,
          endsOn,
          bcvRate: new Prisma.Decimal(officialRate.promedio),
        },
      });
      await tx.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey: input.periodKey } },
        create: {
          communityId,
          periodKey: input.periodKey,
          label: input.label.trim(),
          startsOn,
          endsOn,
        },
        update: {},
      });
      return created;
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'BILLING_PERIOD_CREATED',
      'BillingPeriod',
      period.id,
      `Mes de gestión creado con tasa oficial Bs/USD ${officialRate.promedio}`,
      { period, officialRate },
    );
    return period;
  }

  async createExpense(
    communityId: string,
    actorUserId: string,
    billingPeriodId: string,
    input: CreatePeriodExpenseDto,
  ) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: billingPeriodId, communityId },
    });
    if (!period)
      throw new NotFoundException(
        'El período no pertenece a la comunidad seleccionada.',
      );
    if (period.status !== BillingPeriodStatus.DRAFT)
      throw new ConflictException(
        'Solo se pueden registrar egresos en un período en borrador.',
      );
    const [
      concept,
      expenseAccount,
      paymentAccount,
      bankAccount,
      paymentMethod,
    ] = await Promise.all([
      this.prisma.expenseConcept.findFirst({
        where: {
          id: input.conceptId,
          communityId,
          status: RecordStatus.ACTIVE,
          category: { status: RecordStatus.ACTIVE },
        },
        include: { category: true, defaultExpenseAccount: true },
      }),
      this.prisma.ledgerAccount.findFirst({
        where: {
          id: input.expenseAccountId ?? '',
          communityId,
          status: RecordStatus.ACTIVE,
        },
      }),
      this.prisma.ledgerAccount.findFirst({
        where: {
          id: input.paymentAccountId,
          communityId,
          status: RecordStatus.ACTIVE,
        },
      }),
      input.bankAccountId
        ? this.prisma.bankAccount.findFirst({
            where: {
              id: input.bankAccountId,
              communityId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
      input.paymentMethodId
        ? this.prisma.paymentMethod.findFirst({
            where: {
              id: input.paymentMethodId,
              communityId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
    ]);
    if (!concept) {
      throw new NotFoundException(
        'El concepto no pertenece a una categoría activa de esta comunidad.',
      );
    }
    const resolvedExpenseAccount = expenseAccount ?? concept?.defaultExpenseAccount ?? null;
    if (
      !resolvedExpenseAccount ||
      resolvedExpenseAccount.type !== LedgerAccountType.EXPENSE ||
      !resolvedExpenseAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'Selecciona una cuenta contable de gasto que admita movimientos.',
      );
    }
    if (
      !paymentAccount ||
      paymentAccount.type !== LedgerAccountType.ASSET ||
      !paymentAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'La cuenta de pago debe ser una cuenta contable de activo (Tesorería / Banco / Caja) que admita movimientos.',
      );
    }
    if (
      input.paymentSource === ExpensePaymentSource.BANK_ACCOUNT &&
      !bankAccount
    ) {
      throw new BadRequestException('Selecciona una cuenta bancaria válida.');
    }
    if (bankAccount && paymentAccount.bankAccountId && paymentAccount.bankAccountId !== bankAccount.id) {
      throw new BadRequestException(
        'La cuenta contable de pago seleccionada corresponde a otra cuenta bancaria.',
      );
    }
    if (input.paymentMethodId && !paymentMethod)
      throw new BadRequestException(
        'El método de pago no pertenece a la comunidad.',
      );

    const amount = new Prisma.Decimal(input.amount);
    const amountVes = this.toVes(amount, input.currency, period.bcvRate);
    const amountUsd = this.toUsd(amount, input.currency, period.bcvRate);
    const paidAt = new Date(input.paidAt);
    if (paidAt < period.startsOn || paidAt > period.endsOn) {
      throw new BadRequestException(
        `La fecha del egreso debe pertenecer al mes de gestión ${period.periodKey}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const accountingPeriod = await tx.accountingPeriod.upsert({
        where: {
          communityId_periodKey: { communityId, periodKey: period.periodKey },
        },
        create: {
          communityId,
          periodKey: period.periodKey,
          label: period.label,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
        },
        update: {},
      });
      if (accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException(
          'El período contable correspondiente está cerrado o bloqueado.',
        );
      }
      await tx.communityAccountingSettings.upsert({
        where: { communityId },
        create: { communityId },
        update: {},
      });
      const sequence = await tx.communityAccountingSettings.update({
        where: { communityId },
        data: { nextJournalNumber: { increment: 1 } },
      });
      const expense = await tx.periodExpense.create({
        data: {
          communityId,
          billingPeriodId,
          conceptId: concept.id,
          description: input.description.trim(),
          amount,
          currency: input.currency,
          allocationMethod:
            input.allocationMethod ?? ExpenseAllocationMethod.ALIQUOT,
          notes: input.notes?.trim() || null,
          invoiceNumber: input.invoiceNumber?.trim() || null,
          beneficiaryName: input.beneficiaryName.trim(),
          beneficiaryDocument: input.beneficiaryDocument.trim(),
          beneficiaryPhone: input.beneficiaryPhone?.trim() || null,
          paymentSource: input.paymentSource,
          bankAccountId: bankAccount?.id ?? null,
          paymentMethodId: paymentMethod?.id ?? null,
          paymentReference: input.paymentReference.trim(),
          paidAt,
          expenseAccountId: resolvedExpenseAccount.id,
          paymentAccountId: paymentAccount.id,
        },
      });
      const journalEntry = await tx.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: accountingPeriod.id,
          entryNumber: sequence.nextJournalNumber - 1,
          entryDate: paidAt,
          description: `Egreso: ${input.description.trim()}`,
          source: JournalEntrySource.EXPENSE,
          sourceId: expense.id,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedById: actorUserId,
          createdById: actorUserId,
          lines: {
            create: [
              {
                communityId,
                accountId: resolvedExpenseAccount.id,
                lineNumber: 1,
                description: input.description.trim(),
                debit: amountUsd,
                credit: new Prisma.Decimal(0),
                transactionAmount: amount,
                transactionCurrency: input.currency,
                exchangeRate: input.currency === Currency.VES ? period.bcvRate : new Prisma.Decimal(1),
                referenceType: 'EXPENSE',
                referenceId: expense.id,
              },
              {
                communityId,
                accountId: paymentAccount.id,
                lineNumber: 2,
                description: `Pago a ${input.beneficiaryName.trim()}`,
                debit: new Prisma.Decimal(0),
                credit: amountUsd,
                transactionAmount: amount,
                transactionCurrency: input.currency,
                exchangeRate: input.currency === Currency.VES ? period.bcvRate : new Prisma.Decimal(1),
                referenceType: 'PAYMENT',
                referenceId: input.paymentReference.trim(),
              },
            ],
          },
        },
      });
      const result = await tx.periodExpense.update({
        where: { id: expense.id },
        data: { journalEntryId: journalEntry.id },
        include: {
          concept: { include: { category: true } },
          bankAccount: true,
          paymentMethod: true,
          expenseAccount: true,
          paymentAccount: true,
          journalEntry: true,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'EXPENSE_POSTED',
        'PeriodExpense',
        expense.id,
        'Egreso registrado y contabilizado por partida doble',
        result,
      );
      return result;
    });
  }

  async createOwnerPayment(
    communityId: string,
    actorUserId: string,
    input: CreateOwnerPaymentDto,
  ) {
    const paidAt = new Date(input.paidAt);
    const originalAmount = new Prisma.Decimal(input.amount);
    const exchangeRate = new Prisma.Decimal(input.exchangeRate);
    const functionalAmount = originalAmount
      .div(exchangeRate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const [property, payerOwnership, paymentMethod, bankAccount] = await Promise.all([
      this.prisma.property.findFirst({
        where: { id: input.propertyId, communityId, status: RecordStatus.ACTIVE },
      }),
      input.payerPersonId
        ? this.prisma.ownership.findFirst({
            where: {
              communityId,
              propertyId: input.propertyId,
              personId: input.payerPersonId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
      input.paymentMethodId
        ? this.prisma.paymentMethod.findFirst({
            where: { id: input.paymentMethodId, communityId, status: RecordStatus.ACTIVE },
          })
        : null,
      input.bankAccountId
        ? this.prisma.bankAccount.findFirst({
            where: { id: input.bankAccountId, communityId, status: RecordStatus.ACTIVE },
          })
        : null,
    ]);
    if (!property) throw new NotFoundException('El inmueble no pertenece a la comunidad seleccionada.');
    if (input.payerPersonId && !payerOwnership) {
      throw new BadRequestException('La persona seleccionada no es propietaria vigente del inmueble.');
    }
    if (input.paymentMethodId && !paymentMethod) {
      throw new BadRequestException('El método de pago no pertenece a la comunidad.');
    }
    if (input.bankAccountId && !bankAccount) {
      throw new BadRequestException('La cuenta bancaria no pertenece a la comunidad.');
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.ownerPayment.create({
        data: {
          communityId,
          propertyId: property.id,
          payerPersonId: input.payerPersonId ?? null,
          paymentMethodId: paymentMethod?.id ?? null,
          bankAccountId: bankAccount?.id ?? null,
          exchangeRate,
          originalAmount,
          originalCurrency: input.currency,
          functionalAmount,
          functionalCurrency: 'USD',
          exchangeRateSource: input.exchangeRateSource?.trim() || 'ADMIN_REPORTED',
          exchangeRateEffectiveAt: paidAt,
          reference: input.reference.trim(),
          paidAt,
          notes: input.notes?.trim() || null,
          status: OWNER_PAYMENT_INITIAL_STATUS,
          createdById: actorUserId,
          reportedAt: new Date(),
          reportedById: actorUserId,
        },
      });
      await this.audit(tx, communityId, actorUserId, 'OWNER_PAYMENT_REPORTED', 'OwnerPayment', payment.id, `Pago registrado para ${property.code}; pendiente de conciliación`, payment);
      return payment;
    });

    

    // Legacy accounting/application implementation below is unreachable and
    // will be removed once the reporting transition is verified.
    /*
    const paidAt = new Date(input.paidAt);
    const amount = new Prisma.Decimal(input.amount);
    const exchangeRate = new Prisma.Decimal(input.exchangeRate);
    const amountVes = this.toVes(
      amount,
      input.currency as Currency,
      exchangeRate,
    ).toDecimalPlaces(2);

    const [
      property,
      payerOwnership,
      allocation,
      paymentMethod,
      bankAccount,
      receiptAccount,
      receivableAccount,
      advanceAccount,
    ] = await Promise.all([
      this.prisma.property.findFirst({
        where: {
          id: input.propertyId,
          communityId,
          status: RecordStatus.ACTIVE,
        },
      }),
      input.payerPersonId
        ? this.prisma.ownership.findFirst({
            where: {
              communityId,
              propertyId: input.propertyId,
              personId: input.payerPersonId,
              status: 'ACTIVE',
            },
          })
        : null,
      input.chargeNoticeAllocationId
        ? this.prisma.chargeNoticeAllocation.findFirst({
            where: {
              id: input.chargeNoticeAllocationId,
              propertyId: input.propertyId,
              chargeNotice: {
                communityId,
                status: ChargeNoticeStatus.ISSUED,
              },
            },
            include: { chargeNotice: true },
          })
        : null,
      input.paymentMethodId
        ? this.prisma.paymentMethod.findFirst({
            where: {
              id: input.paymentMethodId,
              communityId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
      input.bankAccountId
        ? this.prisma.bankAccount.findFirst({
            where: {
              id: input.bankAccountId,
              communityId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
      this.prisma.ledgerAccount.findFirst({
        where: {
          id: input.receiptAccountId,
          communityId,
          status: RecordStatus.ACTIVE,
        },
      }),
      this.prisma.ledgerAccount.findFirst({
        where: {
          id: input.receivableAccountId,
          communityId,
          status: RecordStatus.ACTIVE,
        },
      }),
      input.advanceAccountId
        ? this.prisma.ledgerAccount.findFirst({
            where: {
              id: input.advanceAccountId,
              communityId,
              status: RecordStatus.ACTIVE,
            },
          })
        : null,
    ]);

    if (!property) {
      throw new NotFoundException(
        'El inmueble no pertenece a la comunidad seleccionada.',
      );
    }
    if (input.payerPersonId && !payerOwnership) {
      throw new BadRequestException(
        'La persona seleccionada no es propietaria vigente del inmueble.',
      );
    }
    if (input.chargeNoticeAllocationId && !allocation) {
      throw new BadRequestException(
        'La cuota seleccionada no está emitida o no pertenece al inmueble.',
      );
    }
    if (input.paymentMethodId && !paymentMethod) {
      throw new BadRequestException(
        'El método de pago no pertenece a la comunidad.',
      );
    }
    if (input.bankAccountId && !bankAccount) {
      throw new BadRequestException(
        'La cuenta bancaria no pertenece a la comunidad.',
      );
    }
    if (
      !receiptAccount ||
      receiptAccount.type !== LedgerAccountType.ASSET ||
      !receiptAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'La cuenta receptora debe ser una cuenta de activo que admita movimientos.',
      );
    }
    if (
      !receivableAccount ||
      receivableAccount.type !== LedgerAccountType.ASSET ||
      !receivableAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'La cuenta por cobrar debe ser una cuenta de activo que admita movimientos.',
      );
    }
    if (
      input.advanceAccountId &&
      (!advanceAccount ||
        advanceAccount.type !== LedgerAccountType.LIABILITY ||
        !advanceAccount.acceptsEntries)
    ) {
      throw new BadRequestException(
        'La cuenta de anticipos debe ser una cuenta de pasivo que admita movimientos.',
      );
    }
    if (bankAccount && receiptAccount.bankAccountId !== bankAccount.id) {
      throw new BadRequestException(
        'La cuenta contable receptora no corresponde a la cuenta bancaria seleccionada.',
      );
    }
    if (paymentMethod && paymentMethod.currency !== (input.currency as Currency)) {
      throw new BadRequestException(
        'La moneda del pago no coincide con el método seleccionado.',
      );
    }

    let appliedToNoticeVes = new Prisma.Decimal(0);
    if (allocation) {
      const alreadyApplied = await this.prisma.ownerPayment.aggregate({
        where: {
          communityId,
          chargeNoticeAllocationId: allocation.id,
          status: 'POSTED',
        },
        _sum: { appliedToNoticeVes: true },
      });
      const outstanding = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        allocation.totalVes.minus(
          alreadyApplied._sum.appliedToNoticeVes ?? new Prisma.Decimal(0),
        ),
      );
      appliedToNoticeVes = Prisma.Decimal.min(amountVes, outstanding);
    }
    const advanceVes = amountVes.minus(appliedToNoticeVes);
    const amountUsd = amount.div(exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const appliedToNoticeUsd = appliedToNoticeVes.div(exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const advanceUsd = amountUsd.minus(appliedToNoticeUsd);
    if (advanceVes.greaterThan(0) && !advanceAccount) {
      throw new BadRequestException(
        'El pago genera un anticipo. Selecciona la cuenta de pasivo donde se reconocerá el excedente.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const periodKey = `${paidAt.getUTCFullYear()}-${String(
        paidAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      const startsOn = new Date(
        Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), 1),
      );
      const endsOn = new Date(
        Date.UTC(
          paidAt.getUTCFullYear(),
          paidAt.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ),
      );
      const accountingPeriod = await tx.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey } },
        create: {
          communityId,
          periodKey,
          label: `Período ${periodKey}`,
          startsOn,
          endsOn,
        },
        update: {},
      });
      if (accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException(
          'El período contable correspondiente al pago no está abierto.',
        );
      }
      await tx.communityAccountingSettings.upsert({
        where: { communityId },
        create: { communityId },
        update: {},
      });
      const sequence = await tx.communityAccountingSettings.update({
        where: { communityId },
        data: {
          nextJournalNumber: { increment: 1 },
          nextReceiptNumber: { increment: 1 },
        },
      });
      const paymentId = randomUUID();
      const journalEntry = await tx.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: accountingPeriod.id,
          entryNumber: sequence.nextJournalNumber - 1,
          entryDate: paidAt,
          description: `Pago recibido · Inmueble ${property.code}`,
          source: JournalEntrySource.PAYMENT,
          sourceId: paymentId,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedById: actorUserId,
          createdById: actorUserId,
          lines: {
            create: [
              {
                communityId,
                accountId: receiptAccount.id,
                lineNumber: 1,
                description: `Ingreso ${input.reference.trim()}`,
                debit: amountUsd,
                credit: new Prisma.Decimal(0),
                transactionAmount: amount,
                transactionCurrency: input.currency as Currency,
                exchangeRate,
                referenceType: 'OWNER_PAYMENT',
                referenceId: paymentId,
              },
              ...(appliedToNoticeUsd.greaterThan(0)
                ? [
                    {
                      communityId,
                      accountId: receivableAccount.id,
                      lineNumber: 2,
                      description: `Aplicación a cuenta por cobrar · ${property.code}`,
                      debit: new Prisma.Decimal(0),
                      credit: appliedToNoticeUsd,
                      transactionAmount: null,
                      transactionCurrency: null,
                      exchangeRate: null,
                      referenceType: 'CHARGE_NOTICE_ALLOCATION',
                      referenceId: allocation?.id ?? null,
                    },
                  ]
                : []),
              ...(advanceUsd.greaterThan(0) && advanceAccount
                ? [
                    {
                      communityId,
                      accountId: advanceAccount.id,
                      lineNumber: appliedToNoticeVes.greaterThan(0) ? 3 : 2,
                      description: `Anticipo del inmueble ${property.code}`,
                      debit: new Prisma.Decimal(0),
                      credit: advanceUsd,
                      transactionAmount: null,
                      transactionCurrency: null,
                      exchangeRate: null,
                      referenceType: 'OWNER_ADVANCE',
                      referenceId: property.id,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      const payment = await tx.ownerPayment.create({
        data: {
          id: paymentId,
          communityId,
          propertyId: property.id,
          payerPersonId: input.payerPersonId ?? null,
          chargeNoticeAllocationId: allocation?.id ?? null,
          paymentMethodId: paymentMethod?.id ?? null,
          bankAccountId: bankAccount?.id ?? null,
          receiptAccountId: receiptAccount.id,
          receivableAccountId: receivableAccount.id,
          advanceAccountId: advanceAccount?.id ?? null,
          journalEntryId: journalEntry.id,
          receiptNumber: sequence.nextReceiptNumber - 1,
          amount,
          currency: input.currency as Currency,
          exchangeRate,
          amountVes,
          appliedToNoticeVes,
          advanceVes,
          reference: input.reference.trim(),
          paidAt,
          notes: input.notes?.trim() || null,
          createdById: actorUserId,
        },
        include: {
          property: true,
          payerPerson: true,
          chargeNoticeAllocation: {
            include: { chargeNotice: { include: { billingPeriod: true } } },
          },
          paymentMethod: true,
          bankAccount: true,
          receiptAccount: true,
          receivableAccount: true,
          advanceAccount: true,
          journalEntry: true,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'OWNER_PAYMENT_POSTED',
        'OwnerPayment',
        payment.id,
        `Pago N.º ${payment.receiptNumber} registrado y contabilizado`,
        payment,
      );
      return payment;
    });
  }
*/
  }

  async reconcileOwnerPayment(
    communityId: string,
    actor: AuthPrincipal,
    paymentId: string,
  ) {
    return this.transitionOwnerPayment(communityId, actor, paymentId, 'RECONCILED');
  }

  private async transitionOwnerPayment(
    communityId: string,
    actor: AuthPrincipal,
    paymentId: string,
    targetStatus: 'RECONCILED' | 'REJECTED',
  ) {
    const actorUserId = actor.userId;
    /* Authorization is evaluated inside the transaction before payment lookup.
    const payment = await this.prisma.ownerPayment.findFirst({
      where: { id: paymentId, communityId },
      select: { id: true, status: true },
    });
    if (!payment) throw new NotFoundException('El pago no pertenece a la comunidad seleccionada.');
    if (payment.status !== 'REPORTED') {
      throw new ConflictException('Sólo un pago reportado puede conciliarse.');
    }
    */
    return this.withFinancialTransaction(async (tx) => {
      const now = new Date();
      const access = await tx.communityAccess.findFirst({
        where: {
          userId: actor.userId,
          communityId,
          status: AccessStatus.ACTIVE,
          startsOn: { lte: now },
          OR: [{ endsOn: null }, { endsOn: { gt: now } }],
        },
        select: { scopes: true },
      });
      if (!access || !this.hasExactScope(access.scopes, 'billing.payments.reconcile')) {
        throw new ForbiddenException('La conciliacion requiere una responsabilidad explicita de la comunidad.');
      }
      const payment = await tx.ownerPayment.findFirst({
        where: { id: paymentId, communityId },
        select: {
          id: true,
          status: true,
          propertyId: true,
          bankAccountId: true,
          originalAmount: true,
          originalCurrency: true,
          exchangeRate: true,
          reference: true,
          paidAt: true,
          functionalAmount: true,
          functionalCurrency: true,
        },
      });
      if (!payment) {
        throw new NotFoundException('El pago no pertenece a la comunidad seleccionada.');
      }
      assertOwnerPaymentTransition(payment.status, targetStatus);
      // Canonical order: ChargeNotice (FIFO) -> OwnerPayment -> PaymentApplication.
      if (targetStatus === 'RECONCILED') {
        await this.lockIssuedNoticesForProperty(tx, communityId, payment.propertyId);
      }
      const transitionAt = new Date();
      const updated = await tx.ownerPayment.updateMany({
        where: { id: paymentId, communityId, status: payment.status },
        data: ownerPaymentTransitionData(targetStatus, actor.userId, transitionAt),
      });
      if (updated.count !== 1) {
        throw new ConflictException('El estado del pago cambió durante la operación.');
      }
      const result = await tx.ownerPayment.findFirstOrThrow({
        where: { id: paymentId, communityId },
      });
      if (targetStatus === 'RECONCILED') {
        const applications = await this.applyReconciledPaymentFifo(tx, communityId, actorUserId, payment);
        await this.postReconciledOwnerPayment(tx, communityId, actorUserId, payment, applications);
      }
      await this.audit(tx, communityId, actorUserId, 'OWNER_PAYMENT_RECONCILED', 'OwnerPayment', result.id, 'Pago conciliado por usuario autorizado; pendiente de aplicación.', result);
      return result;
    });
  }

  private async lockIssuedNoticesForProperty(
    tx: Prisma.TransactionClient,
    communityId: string,
    propertyId: string,
  ) {
    const allocations = await tx.chargeNoticeAllocation.findMany({
      where: { propertyId, chargeNotice: { communityId, status: ChargeNoticeStatus.ISSUED } },
      select: { chargeNoticeId: true },
      orderBy: [{ chargeNotice: { issuedAt: 'asc' } }, { chargeNoticeId: 'asc' }],
    });
    for (const noticeId of [...new Set(allocations.map((allocation) => allocation.chargeNoticeId))]) {
      await tx.chargeNotice.updateMany({
        where: { id: noticeId, communityId, status: ChargeNoticeStatus.ISSUED },
        data: { status: ChargeNoticeStatus.ISSUED },
      });
    }
  }

  private hasExactScope(scopes: Prisma.JsonValue, requiredScope: string) {
    return Array.isArray(scopes) && scopes.some((scope) => scope === requiredScope);
  }

  private async applyReconciledPaymentFifo(
    tx: Prisma.TransactionClient,
    communityId: string,
    actorUserId: string,
    payment: {
      id: string;
      propertyId: string;
      functionalAmount: Prisma.Decimal | null;
      functionalCurrency: string | null;
    },
  ) {
    if (!payment.functionalAmount || payment.functionalCurrency !== 'USD') return [];
    const allocations = await tx.chargeNoticeAllocation.findMany({
      where: { propertyId: payment.propertyId, chargeNotice: { communityId, status: ChargeNoticeStatus.ISSUED } },
      select: { id: true, chargeNoticeId: true, totalUsd: true },
      orderBy: [{ chargeNotice: { issuedAt: 'asc' } }, { createdAt: 'asc' }],
    });
    let remaining = payment.functionalAmount;
    const applications = [];
    for (const allocation of allocations) {
      if (remaining.lessThanOrEqualTo(0)) break;
      // Same lock used by manual application and voiding: it prevents a row
      // from being applied after this notice has changed to VOID.
      const activeNotice = await tx.chargeNotice.updateMany({
        where: { id: allocation.chargeNoticeId, communityId, status: ChargeNoticeStatus.ISSUED },
        data: { status: ChargeNoticeStatus.ISSUED },
      });
      if (activeNotice.count !== 1) continue;
      const used = await tx.paymentApplication.aggregate({
        where: { chargeNoticeAllocationId: allocation.id },
        _sum: { functionalAmount: true },
      });
      const allocationRemaining = allocation.totalUsd.minus(used._sum.functionalAmount ?? new Prisma.Decimal(0));
      if (allocationRemaining.lessThanOrEqualTo(0)) continue;
      const functionalAmount = Prisma.Decimal.min(remaining, allocationRemaining);
      const application = await tx.paymentApplication.create({
        data: { communityId, ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount, functionalCurrency: 'USD', appliedById: actorUserId },
      });
      applications.push(application);
      this.failpoint('reconcile-after-application');
      remaining = remaining.minus(functionalAmount);
      await this.audit(tx, communityId, actorUserId, 'PAYMENT_APPLICATION_CREATED', 'PaymentApplication', application.id, 'Pago conciliado aplicado automáticamente por antigüedad.', application);
    }
    return applications;
  }

  /** Consumes reconciled-but-unapplied funds for one allocation, oldest first. */
  private async applyAvailableCreditsToAllocation(
    tx: Prisma.TransactionClient,
    communityId: string,
    actorUserId: string,
    allocation: { id: string; propertyId: string; totalUsd: Prisma.Decimal },
  ) {
    const allocationUsed = await tx.paymentApplication.aggregate({
      where: { chargeNoticeAllocationId: allocation.id },
      _sum: { functionalAmount: true },
    });
    let remainingDebt = allocation.totalUsd.minus(
      allocationUsed._sum.functionalAmount ?? new Prisma.Decimal(0),
    );
    if (remainingDebt.lessThanOrEqualTo(0)) return [];
    const payments = await tx.ownerPayment.findMany({
      where: {
        communityId,
        propertyId: allocation.propertyId,
        status: 'RECONCILED',
        functionalCurrency: 'USD',
        functionalAmount: { not: null },
      },
      select: { id: true, functionalAmount: true, reconciledAt: true, createdAt: true },
      orderBy: [{ reconciledAt: 'asc' }, { id: 'asc' }],
    });
    const applications = [];
    for (const payment of payments) {
      if (remainingDebt.lessThanOrEqualTo(0)) break;
      // Lock each credit source before calculating its remainder. Concurrent
      // issuance of another notice must serialize on this same payment row.
      const locked = await tx.ownerPayment.updateMany({
        where: { id: payment.id, communityId, status: 'RECONCILED' },
        data: { status: 'RECONCILED' },
      });
      if (locked.count !== 1) continue;
      const used = await tx.paymentApplication.aggregate({
        where: { ownerPaymentId: payment.id },
        _sum: { functionalAmount: true },
      });
      const available = payment.functionalAmount!.minus(
        used._sum.functionalAmount ?? new Prisma.Decimal(0),
      );
      if (available.lessThanOrEqualTo(0)) continue;
      const functionalAmount = Prisma.Decimal.min(available, remainingDebt);
      const application = await tx.paymentApplication.create({
        data: { communityId, ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount, functionalCurrency: 'USD', appliedById: actorUserId },
      });
      applications.push(application);
      this.failpoint('issue-after-application');
      remainingDebt = remainingDebt.minus(functionalAmount);
      await this.audit(tx, communityId, actorUserId, 'PAYMENT_APPLICATION_CREATED', 'PaymentApplication', application.id, 'Saldo conciliado aplicado automáticamente a nuevo aviso.', application);
    }
    return applications;
  }

  async createPaymentApplication(
    communityId: string,
    actorUserId: string,
    input: CreatePaymentApplicationDto,
  ) {
    const requested = new Prisma.Decimal(input.functionalAmount);
    return this.withFinancialTransaction(async (tx) => {
      const payment = await tx.ownerPayment.findFirst({
        where: { id: input.ownerPaymentId, communityId, status: 'RECONCILED' },
        select: { id: true, propertyId: true, functionalAmount: true, functionalCurrency: true },
      });
      if (!payment || !payment.functionalAmount || payment.functionalCurrency !== 'USD') {
        throw new BadRequestException('El pago debe estar conciliado y tener un importe funcional USD.');
      }
      const allocation = await tx.chargeNoticeAllocation.findFirst({
        where: {
          id: input.chargeNoticeAllocationId,
          chargeNotice: { communityId, status: ChargeNoticeStatus.ISSUED },
        },
        select: { id: true, propertyId: true, chargeNoticeId: true, totalUsd: true },
      });
      if (!allocation) throw new NotFoundException('El aviso de cobro no pertenece a la comunidad o no está emitido.');
      if (allocation && allocation.propertyId !== payment.propertyId) {
        throw new BadRequestException('El pago solo puede aplicarse a deudas del mismo inmueble.');
      }
      // Serialize applications with voiding through the parent notice row.
      const activeNotice = await tx.chargeNotice.updateMany({
        where: { id: allocation!.chargeNoticeId, communityId, status: ChargeNoticeStatus.ISSUED },
        data: { status: ChargeNoticeStatus.ISSUED },
      });
      if (activeNotice.count !== 1) {
        throw new ConflictException('El aviso de cobro ya no está disponible para recibir aplicaciones.');
      }
      const lockedPayment = await tx.ownerPayment.updateMany({
        where: { id: payment.id, communityId, status: 'RECONCILED' },
        data: { status: 'RECONCILED' },
      });
      if (lockedPayment.count !== 1) {
        throw new ConflictException('El pago ya no está disponible para aplicar.');
      }
      const [paymentUsed, allocationUsed] = await Promise.all([
        tx.paymentApplication.aggregate({ where: { ownerPaymentId: payment.id }, _sum: { functionalAmount: true } }),
        tx.paymentApplication.aggregate({ where: { chargeNoticeAllocationId: allocation.id }, _sum: { functionalAmount: true } }),
      ]);
      const paymentRemaining = payment.functionalAmount.minus(paymentUsed._sum.functionalAmount ?? new Prisma.Decimal(0));
      const allocationRemaining = allocation.totalUsd.minus(allocationUsed._sum.functionalAmount ?? new Prisma.Decimal(0));
      if (requested.greaterThan(paymentRemaining) || requested.greaterThan(allocationRemaining)) {
        throw new ConflictException('La aplicación excede el saldo disponible del pago o del aviso.');
      }
      const application = await tx.paymentApplication.create({
        data: { communityId, ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount: requested, functionalCurrency: 'USD', appliedById: actorUserId },
      });
      await this.audit(tx, communityId, actorUserId, 'PAYMENT_APPLICATION_CREATED', 'PaymentApplication', application.id, 'Pago conciliado aplicado manualmente a aviso emitido.', application);
      return application;
    });
  }

  async prepareChargeNotice(
    communityId: string,
    actorUserId: string,
    billingPeriodId: string,
    input: PrepareChargeNoticeDto,
  ) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: billingPeriodId, communityId },
      include: {
        expenses: { where: { status: RecordStatus.ACTIVE } },
        chargeNotice: true,
      },
    });
    if (!period)
      throw new NotFoundException(
        'El período no pertenece a la comunidad seleccionada.',
      );
    if (period.status !== BillingPeriodStatus.DRAFT)
      throw new ConflictException(
        'El aviso solo puede prepararse mientras el período esté en borrador.',
      );
    const dueDate = new Date(input.dueDate);
    const periodStart = new Date(period.startsOn);
    periodStart.setUTCHours(0, 0, 0, 0);
    const normalizedDueDate = new Date(dueDate);
    normalizedDueDate.setUTCHours(0, 0, 0, 0);
    if (normalizedDueDate < periodStart) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior al inicio del período.',
      );
    }
    if (period.chargeNotice?.status === ChargeNoticeStatus.ISSUED)
      throw new ConflictException(
        'El aviso de cobro ya fue emitido y no puede recalcularse.',
      );
    if (period.expenses.some((expense) => !expense.journalEntryId)) {
      throw new ConflictException(
        'Todos los egresos deben estar contabilizados antes de preparar el aviso.',
      );
    }
    const [properties, receivableAccount, billingIncomeAccount] =
      await Promise.all([
        this.prisma.property.findMany({
          where: { communityId, status: RecordStatus.ACTIVE },
          orderBy: { code: 'asc' },
        }),
        this.prisma.ledgerAccount.findFirst({
          where: {
            id: input.receivableAccountId,
            communityId,
            status: RecordStatus.ACTIVE,
          },
        }),
        this.prisma.ledgerAccount.findFirst({
          where: {
            id: input.billingIncomeAccountId,
            communityId,
            status: RecordStatus.ACTIVE,
          },
        }),
      ]);
    if (
      !receivableAccount ||
      receivableAccount.type !== LedgerAccountType.ASSET ||
      !receivableAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'Selecciona una cuenta por cobrar de tipo activo que admita movimientos.',
      );
    }
    if (
      !billingIncomeAccount ||
      billingIncomeAccount.type !== LedgerAccountType.INCOME ||
      !billingIncomeAccount.acceptsEntries
    ) {
      throw new BadRequestException(
        'Selecciona una cuenta de ingreso por cuotas que admita movimientos.',
      );
    }
    if (!properties.length)
      throw new ConflictException(
        'La comunidad no tiene inmuebles activos para distribuir el aviso.',
      );
    if (properties.some((property) => property.currentAliquot === null)) {
      throw new ConflictException(
        'Todos los inmuebles activos deben tener una alícuota vigente.',
      );
    }
    const aliquotTotal = properties.reduce(
      (total, property) => total.add(property.currentAliquot!),
      new Prisma.Decimal(0),
    );
    if (aliquotTotal.minus(100).abs().greaterThan(new Prisma.Decimal('0.01'))) {
      throw new ConflictException(
        `Las alícuotas activas deben sumar 100%. Actualmente suman ${aliquotTotal.toFixed(6)}%.`,
      );
    }
    const totalExpensesVes = period.expenses.reduce(
      (total, expense) =>
        total.add(this.toVes(expense.amount, expense.currency, period.bcvRate)),
      new Prisma.Decimal(0),
    );
    const components = input.components.map((component) => ({
      ...component,
      amountDecimal: new Prisma.Decimal(component.amount),
      amountVes: this.toVes(
        new Prisma.Decimal(component.amount),
        component.currency,
        period.bcvRate,
      ),
    }));
    const totalComponentsVes = components.reduce(
      (total, component) => total.add(component.amountVes),
      new Prisma.Decimal(0),
    );
    const totalCommunityVes = totalExpensesVes.add(totalComponentsVes);
    const totalCommunityUsd = totalCommunityVes
      .div(period.bcvRate)
      .toDecimalPlaces(2);
    const allocationRows = properties.map((property) => {
      const aliquot = property.currentAliquot!;
      const expenseShareVes = period.expenses
        .reduce((total, expense) => {
          const base = this.toVes(
            expense.amount,
            expense.currency,
            period.bcvRate,
          );
          return total.add(
            expense.allocationMethod === ExpenseAllocationMethod.FIXED
              ? base.div(properties.length)
              : base.mul(aliquot).div(100),
          );
        }, new Prisma.Decimal(0))
        .toDecimalPlaces(2);
      const componentShareVes = components
        .reduce(
          (total, component) =>
            total.add(
              component.allocationMethod === ExpenseAllocationMethod.FIXED
                ? component.amountVes.div(properties.length)
                : component.amountVes.mul(aliquot).div(100),
            ),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(2);
      return {
        propertyId: property.id,
        aliquotSnapshot: aliquot,
        expenseShareVes,
        componentShareVes,
      };
    });
    const finalAllocation = allocationRows.at(-1);
    if (finalAllocation) {
      const roundedExpenses = allocationRows.reduce(
        (sum, row) => sum.add(row.expenseShareVes),
        new Prisma.Decimal(0),
      );
      const roundedComponents = allocationRows.reduce(
        (sum, row) => sum.add(row.componentShareVes),
        new Prisma.Decimal(0),
      );
      finalAllocation.expenseShareVes = finalAllocation.expenseShareVes.add(
        totalExpensesVes.toDecimalPlaces(2).sub(roundedExpenses),
      );
      finalAllocation.componentShareVes = finalAllocation.componentShareVes.add(
        totalComponentsVes.toDecimalPlaces(2).sub(roundedComponents),
      );
    }

    const allocationUsd = allocationRows.map(row => row.expenseShareVes.add(row.componentShareVes).div(period.bcvRate).toDecimalPlaces(2));
    if (allocationUsd.length) {
      const roundedUsd = allocationUsd.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
      allocationUsd[allocationUsd.length - 1] = allocationUsd[allocationUsd.length - 1].add(totalCommunityUsd.sub(roundedUsd));
    }

    return this.prisma.$transaction(async (tx) => {
      if (period.chargeNotice)
        await tx.chargeNotice.delete({ where: { id: period.chargeNotice.id } });
      const notice = await tx.chargeNotice.create({
        data: {
          communityId,
          billingPeriodId,
          status: ChargeNoticeStatus.PREPARED,
          totalExpensesVes: totalExpensesVes.toDecimalPlaces(2),
          totalComponentsVes: totalComponentsVes.toDecimalPlaces(2),
          totalCommunityVes: totalCommunityVes.toDecimalPlaces(2),
          totalCommunityUsd,
          dueDate,
          preparedAt: new Date(),
          createdById: actorUserId,
          receivableAccountId: receivableAccount.id,
          billingIncomeAccountId: billingIncomeAccount.id,
          components: {
            create: components.map((component) => ({
              type: component.type,
              label: component.label.trim(),
              amount: component.amountDecimal,
              currency: component.currency,
              amountVes: component.amountVes.toDecimalPlaces(2),
              allocationMethod: component.allocationMethod,
            })),
          },
          allocations: {
            create: allocationRows.map((row, index) => {
              const totalVes = row.expenseShareVes.add(row.componentShareVes);
              return {
                propertyId: row.propertyId,
                aliquotSnapshot: row.aliquotSnapshot,
                expenseShareVes: row.expenseShareVes,
                componentShareVes: row.componentShareVes,
                totalVes: totalVes.toDecimalPlaces(2),
                totalUsd: allocationUsd[index],
              };
            }),
          },
        },
        include: {
          components: true,
          allocations: {
            include: { property: true },
            orderBy: { property: { code: 'asc' } },
          },
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'CHARGE_NOTICE_PREPARED',
        'ChargeNotice',
        notice.id,
        'Aviso de cobro calculado con todos los egresos y conceptos del período',
        notice,
      );
      return notice;
    });
  }

  async issueChargeNotice(
    communityId: string,
    actorUserId: string,
    noticeId: string,
  ) {
    return this.withFinancialTransaction(async (tx) => {
      const notice = await tx.chargeNotice.findFirst({
        where: { id: noticeId, communityId },
        include: {
          billingPeriod: true,
          receivableAccount: true,
          billingIncomeAccount: true,
        },
      });
      if (!notice)
        throw new NotFoundException(
          'El aviso no pertenece a la comunidad seleccionada.',
        );
      if (notice.status !== ChargeNoticeStatus.PREPARED)
        throw new ConflictException(
          'Solo puede emitirse un aviso previamente preparado.',
        );
      if (
        !notice.receivableAccount ||
        !notice.billingIncomeAccount ||
        notice.journalEntryId
      ) {
        throw new ConflictException(
          'El aviso no tiene una configuración contable válida para su emisión.',
        );
      }
      const accountingPeriod = await tx.accountingPeriod.upsert({
        where: {
          communityId_periodKey: {
            communityId,
            periodKey: notice.billingPeriod.periodKey,
          },
        },
        create: {
          communityId,
          periodKey: notice.billingPeriod.periodKey,
          label: notice.billingPeriod.label,
          startsOn: notice.billingPeriod.startsOn,
          endsOn: notice.billingPeriod.endsOn,
        },
        update: {},
      });
      if (accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException(
          'El período contable correspondiente está cerrado o bloqueado.',
        );
      }
      await tx.communityAccountingSettings.upsert({
        where: { communityId },
        create: { communityId },
        update: {},
      });
      const sequence = await tx.communityAccountingSettings.update({
        where: { communityId },
        data: { nextJournalNumber: { increment: 1 } },
      });
      const issuedAt = new Date();
      const journalEntry = await tx.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: accountingPeriod.id,
          entryNumber: sequence.nextJournalNumber - 1,
          entryDate: issuedAt,
          description: `Aviso de cobro · ${notice.billingPeriod.label}`,
          source: JournalEntrySource.BILLING,
          sourceId: notice.id,
          status: JournalEntryStatus.POSTED,
          postedAt: issuedAt,
          postedById: actorUserId,
          createdById: actorUserId,
          lines: {
            create: [
              {
                communityId,
                accountId: notice.receivableAccount.id,
                lineNumber: 1,
                description: `Cuotas por cobrar · ${notice.billingPeriod.label}`,
                debit: notice.totalCommunityUsd,
                credit: new Prisma.Decimal(0),
                transactionAmount: notice.totalCommunityUsd,
                transactionCurrency: Currency.USD,
                exchangeRate: new Prisma.Decimal(1),
                referenceType: 'CHARGE_NOTICE',
                referenceId: notice.id,
              },
              {
                communityId,
                accountId: notice.billingIncomeAccount.id,
                lineNumber: 2,
                description: `Ingreso por cuotas · ${notice.billingPeriod.label}`,
                debit: new Prisma.Decimal(0),
                credit: notice.totalCommunityUsd,
                transactionAmount: notice.totalCommunityUsd,
                transactionCurrency: Currency.USD,
                exchangeRate: new Prisma.Decimal(1),
                referenceType: 'CHARGE_NOTICE',
                referenceId: notice.id,
              },
            ],
          },
        },
      });
      const result = await tx.chargeNotice.update({
        where: { id: notice.id },
        data: {
          status: ChargeNoticeStatus.ISSUED,
          issuedAt,
          journalEntryId: journalEntry.id,
        },
        include: {
          journalEntry: true,
          receivableAccount: true,
          billingIncomeAccount: true,
        },
      });
      await tx.billingPeriod.update({
        where: { id: notice.billingPeriodId },
        data: { status: BillingPeriodStatus.ISSUED, issuedAt },
      });
      const allocations = await tx.chargeNoticeAllocation.findMany({
        where: { chargeNoticeId: notice.id },
        select: { id: true, propertyId: true, totalUsd: true },
        orderBy: { propertyId: 'asc' },
      });
      for (const allocation of allocations) {
        await this.applyAvailableCreditsToAllocation(tx, communityId, actorUserId, allocation);
      }
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'CHARGE_NOTICE_ISSUED',
        'ChargeNotice',
        notice.id,
        `Aviso de cobro emitido y contabilizado en el asiento N.º ${sequence.nextJournalNumber - 1}`,
        result,
      );
      return result;
    });
  }

  async deleteBillingPeriod(
    communityId: string,
    actorUserId: string,
    billingPeriodId: string,
    input: DeleteBillingPeriodDto,
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('Indica el motivo para eliminar el mes de gestión.');
    }

    return this.withFinancialTransaction(async (tx) => {
      const period = await tx.billingPeriod.findFirst({
        where: { id: billingPeriodId, communityId },
        include: {
          chargeNotice: { include: { components: true, allocations: true } },
        },
      });
      if (!period) {
        throw new NotFoundException('El mes de gestión no pertenece a la comunidad seleccionada.');
      }
      if (period.status !== BillingPeriodStatus.DRAFT || period.issuedAt || period.closedAt) {
        throw new ConflictException('Solo puede eliminarse un mes de gestión que siga en borrador.');
      }

      const periodLock = await tx.billingPeriod.updateMany({
        where: { id: period.id, communityId, status: BillingPeriodStatus.DRAFT },
        data: { status: BillingPeriodStatus.DRAFT },
      });
      if (periodLock.count !== 1) {
        throw new ConflictException('El mes de gestión cambió durante la operación. Actualiza la pantalla e inténtalo de nuevo.');
      }

      const notice = period.chargeNotice;
      if (notice && (notice.status === ChargeNoticeStatus.ISSUED || notice.status === ChargeNoticeStatus.VOID || notice.journalEntryId)) {
        throw new ConflictException('No puede eliminarse un mes cuyo aviso ya fue emitido o anulado.');
      }

      const accountingPeriod = await tx.accountingPeriod.findUnique({
        where: { communityId_periodKey: { communityId, periodKey: period.periodKey } },
      });
      if (accountingPeriod) {
        const accountingPeriodLock = await tx.accountingPeriod.updateMany({
          where: {
            id: accountingPeriod.id,
            communityId,
            status: { in: [AccountingPeriodStatus.OPEN, AccountingPeriodStatus.CLOSED] },
            lockedAt: null,
          },
          data: { status: accountingPeriod.status },
        });
        if (accountingPeriodLock.count !== 1) {
          throw new ConflictException('El período contable está bloqueado y no se puede eliminar el mes.');
        }
      }

      const [expenseCount, applicationCount, paymentCount, journalEntryCount] = await Promise.all([
        tx.periodExpense.count({ where: { communityId, billingPeriodId: period.id } }),
        notice
          ? tx.paymentApplication.count({ where: { chargeNoticeAllocation: { chargeNoticeId: notice.id } } })
          : Promise.resolve(0),
        tx.ownerPayment.count({ where: { communityId, paidAt: { gte: period.startsOn, lte: period.endsOn } } }),
        accountingPeriod
          ? tx.journalEntry.count({ where: { communityId, accountingPeriodId: accountingPeriod.id } })
          : Promise.resolve(0),
      ]);
      if (expenseCount > 0) {
        throw new ConflictException('No puede eliminarse el mes porque tiene gastos registrados.');
      }
      if (applicationCount > 0) {
        throw new ConflictException('No puede eliminarse el mes porque el aviso tiene pagos aplicados.');
      }
      if (paymentCount > 0) {
        throw new ConflictException('No puede eliminarse el mes porque tiene pagos registrados en esas fechas.');
      }
      if (journalEntryCount > 0) {
        throw new ConflictException('No puede eliminarse el mes porque el período contable tiene asientos.');
      }

      if (notice) await tx.chargeNotice.delete({ where: { id: notice.id } });
      await tx.billingPeriod.delete({ where: { id: period.id } });
      if (accountingPeriod) await tx.accountingPeriod.delete({ where: { id: accountingPeriod.id } });
      await tx.auditEvent.create({
        data: {
          communityId,
          actorUserId,
          requestId: randomUUID(),
          action: 'BILLING_PERIOD_DELETED',
          entityType: 'BillingPeriod',
          entityId: period.id,
          detail: `Mes de gestión vacío eliminado: ${period.label}`,
          reason,
          before: JSON.parse(JSON.stringify({ period, accountingPeriod })) as Prisma.InputJsonValue,
        },
      });
      return { id: period.id, periodKey: period.periodKey, deleted: true };
    });
  }

  /**
   * Voiding only removes the notice from the active collection flow. It does
   * not affect independent owner payment reports or their reconciliation.
   */
  async voidChargeNotice(
    communityId: string,
    actorUserId: string,
    noticeId: string,
  ) {
    return this.withFinancialTransaction(async (tx) => {
      const notice = await tx.chargeNotice.findFirst({
        where: { id: noticeId, communityId },
        select: { id: true, status: true, journalEntryId: true },
      });
      if (!notice) {
        throw new NotFoundException('El aviso no pertenece a la comunidad seleccionada.');
      }
      if (notice.status === ChargeNoticeStatus.VOID) {
        const original = notice.journalEntryId
          ? await tx.journalEntry.findFirst({
              where: { id: notice.journalEntryId, communityId },
              select: { reversal: { select: { id: true } } },
            })
          : null;
        if (!original?.reversal) {
          throw new ConflictException('El aviso anulado no tiene un reverso contable verificable.');
        }
        return notice;
      }
      if (notice.status !== ChargeNoticeStatus.ISSUED) {
        throw new ConflictException('Solo puede anularse un aviso emitido.');
      }

      // Use the same row lock acquired by createPaymentApplication before the
      // absence check, so an application cannot slip in before VOID is set.
      const locked = await tx.chargeNotice.updateMany({
        where: { id: notice.id, communityId, status: ChargeNoticeStatus.ISSUED },
        data: { status: ChargeNoticeStatus.ISSUED },
      });
      if (locked.count !== 1) {
        throw new ConflictException('El estado del aviso cambió durante la operación.');
      }

      // Only confirmed money already applied blocks a void. REPORTED payments
      // have no application and are intentionally not consulted here.
      const reconciledApplications = await tx.paymentApplication.count({
        where: {
          chargeNoticeAllocation: { chargeNoticeId: notice.id },
          ownerPayment: { status: 'RECONCILED' },
        },
      });
      if (reconciledApplications > 0) {
        throw new ConflictException(
          'No puede anularse un aviso que tiene dinero conciliado aplicado.',
        );
      }

      if (!notice.journalEntryId) {
        throw new ConflictException('El aviso emitido no tiene asiento contable original; no puede anularse.');
      }
      const original = await tx.journalEntry.findFirst({
        where: {
          id: notice.journalEntryId,
          communityId,
          source: JournalEntrySource.BILLING,
          sourceId: notice.id,
        },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          reversal: true,
          accountingPeriod: true,
        },
      });
      if (!original) {
        throw new ConflictException('El asiento contable original del aviso es inconsistente.');
      }
      if (original.reversal || original.status !== JournalEntryStatus.POSTED) {
        throw new ConflictException('El asiento contable original no está disponible para reverso.');
      }
      if (original.accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException('El período contable original no está abierto; el aviso no puede anularse.');
      }

      const sequence = await tx.communityAccountingSettings.update({
        where: { communityId },
        data: { nextJournalNumber: { increment: 1 } },
      });
      const reversedAt = new Date();
      const reversal = await tx.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: original.accountingPeriodId,
          entryNumber: sequence.nextJournalNumber - 1,
          entryDate: original.entryDate,
          description: `Reverso de aviso de cobro · ${original.description}`,
          source: JournalEntrySource.BILLING,
          sourceId: notice.id,
          status: JournalEntryStatus.POSTED,
          postedAt: reversedAt,
          postedById: actorUserId,
          reversalOfId: original.id,
          createdById: actorUserId,
          lines: {
            create: original.lines.map((line) => ({
              communityId,
              accountId: line.accountId,
              lineNumber: line.lineNumber,
              description: line.description,
              debit: line.credit,
              credit: line.debit,
              transactionAmount: line.transactionAmount,
              transactionCurrency: line.transactionCurrency,
              exchangeRate: line.exchangeRate,
              referenceType: line.referenceType,
              referenceId: line.referenceId,
            })),
          },
        },
      });
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: JournalEntryStatus.REVERSED, reversedAt, reversedById: actorUserId },
      });
      this.failpoint('void-after-reversal');

      const updated = await tx.chargeNotice.updateMany({
        where: { id: notice.id, communityId, status: ChargeNoticeStatus.ISSUED },
        data: { status: ChargeNoticeStatus.VOID },
      });
      if (updated.count !== 1) {
        throw new ConflictException('El estado del aviso cambió durante la operación.');
      }
      const result = await tx.chargeNotice.findFirstOrThrow({
        where: { id: notice.id, communityId },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'CHARGE_NOTICE_VOIDED',
        'ChargeNotice',
        notice.id,
        'Aviso anulado y asiento contable reversado sin dinero conciliado aplicado.',
        { notice: result, originalJournalEntryId: original.id, reversalJournalEntryId: reversal.id },
      );
      return result;
    });
  }

  private toVes(
    amount: Prisma.Decimal,
    currency: Currency,
    bcvRate: Prisma.Decimal,
  ) {
    if (currency === Currency.VES) return amount;
    if (currency === Currency.USD) return amount.mul(bcvRate);
    throw new BadRequestException(
      'La conversión de EUR requiere una tasa explícita; usa VES o USD en esta etapa.',
    );
  }

  private async postReconciledOwnerPayment(
    tx: Prisma.TransactionClient,
    communityId: string,
    actorUserId: string,
    payment: {
      id: string;
      propertyId: string;
      bankAccountId: string | null;
      originalAmount: Prisma.Decimal | null;
      originalCurrency: string | null;
      exchangeRate: Prisma.Decimal;
      reference: string;
      paidAt: Date;
      functionalAmount: Prisma.Decimal | null;
      functionalCurrency: string | null;
    },
    applications: { functionalAmount: Prisma.Decimal }[],
  ) {
    if (!payment.functionalAmount || payment.functionalCurrency !== 'USD') {
      throw new BadRequestException('El pago conciliado debe tener importe funcional USD.');
    }
    const [bankAccount, property] = await Promise.all([
      payment.bankAccountId
        ? tx.bankAccount.findFirst({ where: { id: payment.bankAccountId, communityId }, include: { ledgerAccount: true } })
        : null,
      tx.property.findFirst({ where: { id: payment.propertyId, communityId }, select: { code: true } }),
    ]);
    const findActiveAccount = (accountId?: string | null, code?: string) => tx.ledgerAccount.findFirst({
      where: {
        communityId,
        status: RecordStatus.ACTIVE,
        acceptsEntries: true,
        ...(accountId ? { id: accountId } : { code }),
      },
    });
    const [cashAccount, receivableAccount, advanceAccount] = await Promise.all([
      findActiveAccount(bankAccount?.ledgerAccount?.id, '1.1.01'),
      findActiveAccount(null, '1.1.03'),
      findActiveAccount(null, '2.1.02'),
    ]);
    if (!cashAccount || cashAccount.type !== LedgerAccountType.ASSET) {
      throw new ConflictException('Configura una cuenta contable de activo para el banco receptor (o la cuenta base 1.1.01).');
    }
    if (!receivableAccount || receivableAccount.type !== LedgerAccountType.ASSET) {
      throw new ConflictException('Inicializa el catálogo contable: falta la cuenta de cuentas por cobrar 1.1.03.');
    }
    if (!advanceAccount || advanceAccount.type !== LedgerAccountType.LIABILITY) {
      throw new ConflictException('Inicializa el catálogo contable: falta la cuenta de anticipos 2.1.02.');
    }
    const appliedUsd = applications.reduce((total, application) => total.plus(application.functionalAmount), new Prisma.Decimal(0));
    const advanceUsd = payment.functionalAmount.minus(appliedUsd);
    if (advanceUsd.lessThan(0)) throw new ConflictException('Las aplicaciones del pago superan su importe funcional.');

    const localPaidAt = new Date(payment.paidAt.getTime() - 4 * 60 * 60 * 1000);
    const year = localPaidAt.getUTCFullYear();
    const month = localPaidAt.getUTCMonth();
    const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const startsOn = new Date(Date.UTC(year, month, 1, 4));
    const endsOn = new Date(Date.UTC(year, month + 1, 1, 3, 59, 59, 999));
    const labelText = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'America/Caracas' })
      .format(new Date(Date.UTC(year, month, 15, 16)));
    const label = labelText.charAt(0).toUpperCase() + labelText.slice(1);
    const period = await tx.accountingPeriod.upsert({
      where: { communityId_periodKey: { communityId, periodKey } },
      create: { communityId, periodKey, label, startsOn, endsOn },
      update: {},
    });
    if (period.status !== AccountingPeriodStatus.OPEN) {
      throw new ConflictException('El período del pago está cerrado; requiere un ajuste en un período abierto.');
    }
    await tx.communityAccountingSettings.upsert({ where: { communityId }, create: { communityId }, update: {} });
    const sequence = await tx.communityAccountingSettings.update({
      where: { communityId },
      data: { nextJournalNumber: { increment: 1 } },
    });
    const lines: Prisma.JournalLineCreateWithoutJournalEntryInput[] = [
      {
        community: { connect: { id: communityId } },
        account: { connect: { id: cashAccount.id } },
        lineNumber: 1,
        description: `Cobro recibido · ${payment.reference}`,
        debit: payment.functionalAmount,
        credit: new Prisma.Decimal(0),
        transactionAmount: payment.originalAmount,
        transactionCurrency: payment.originalCurrency && Object.values(Currency).includes(payment.originalCurrency as Currency)
          ? payment.originalCurrency as Currency
          : null,
        exchangeRate: payment.originalCurrency === Currency.USD ? new Prisma.Decimal(1) : payment.exchangeRate,
        referenceType: 'OWNER_PAYMENT',
        referenceId: payment.id,
      },
    ];
    if (appliedUsd.greaterThan(0)) lines.push({
      community: { connect: { id: communityId } },
      account: { connect: { id: receivableAccount.id } },
      lineNumber: 2,
      description: `Aplicación de pago · Inmueble ${property?.code ?? payment.propertyId}`,
      debit: new Prisma.Decimal(0),
      credit: appliedUsd,
      referenceType: 'OWNER_PAYMENT_APPLICATION',
      referenceId: payment.id,
    });
    if (advanceUsd.greaterThan(0)) lines.push({
      community: { connect: { id: communityId } },
      account: { connect: { id: advanceAccount.id } },
      lineNumber: lines.length + 1,
      description: `Anticipo de propietario · Inmueble ${property?.code ?? payment.propertyId}`,
      debit: new Prisma.Decimal(0),
      credit: advanceUsd,
      referenceType: 'OWNER_PAYMENT_ADVANCE',
      referenceId: payment.id,
    });
    const entry = await tx.journalEntry.create({
      data: {
        communityId,
        accountingPeriodId: period.id,
        entryNumber: sequence.nextJournalNumber - 1,
        entryDate: payment.paidAt,
        description: `Pago de propietario · ${payment.reference}`,
        source: JournalEntrySource.PAYMENT,
        sourceId: payment.id,
        status: JournalEntryStatus.POSTED,
        postedAt: new Date(),
        postedById: actorUserId,
        createdById: actorUserId,
        lines: { create: lines },
      },
    });
    await this.audit(tx, communityId, actorUserId, 'OWNER_PAYMENT_JOURNAL_POSTED', 'JournalEntry', entry.id, `Asiento USD de pago N.º ${entry.entryNumber} creado`, entry);
  }

  private toUsd(
    amount: Prisma.Decimal,
    currency: Currency,
    bcvRate: Prisma.Decimal,
  ) {
    if (currency === Currency.USD) return amount.toDecimalPlaces(2);
    if (currency === Currency.VES) {
      if (bcvRate.lte(0)) throw new BadRequestException('La tasa del período debe ser mayor que cero.');
      return amount.div(bcvRate).toDecimalPlaces(2);
    }
    throw new BadRequestException('La conversión de EUR requiere una tasa explícita; usa VES o USD en esta etapa.');
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
