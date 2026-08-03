import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  BillingPeriodStatus,
  ChargeNoticeStatus,
  Currency,
  ExpenseAllocationMethod,
  ExpensePaymentSource,
  JournalEntrySource,
  JournalEntryStatus,
  LedgerAccountType,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CreateBillingPeriodDto,
  CreateExpenseCategoryDto,
  CreateExpenseConceptDto,
  CreateVendorDto,
  ListExpenseConceptsQueryDto,
  ListVendorsQueryDto,
  CreateOwnerPaymentDto,
  CreatePeriodExpenseDto,
  PrepareChargeNoticeDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseConceptDto,
} from './dto/billing.dto';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

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

  snapshot(communityId: string) {
    return this.prisma.community.findUniqueOrThrow({
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
                journalEntry: { select: { id: true, entryNumber: true, status: true } },
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
                  include: { property: { select: { id: true, code: true, kind: true } } },
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
            chargeNoticeAllocation: {
              include: {
                chargeNotice: {
                  select: {
                    id: true,
                    status: true,
                    billingPeriod: {
                      select: { id: true, periodKey: true, label: true },
                    },
                  },
                },
              },
            },
            paymentMethod: true,
            bankAccount: true,
            receiptAccount: true,
            receivableAccount: true,
            advanceAccount: true,
            journalEntry: {
              select: { id: true, entryNumber: true, status: true },
            },
          },
        },
      },
    });
  }

  async createCategory(communityId: string, actorUserId: string, input: CreateExpenseCategoryDto) {
    const code = input.code.trim().toUpperCase().replace(/\s+/g, '-');
    if (await this.prisma.expenseCategory.findUnique({ where: { communityId_code: { communityId, code } } })) {
      throw new ConflictException('Ya existe una categoría de gasto con este código.');
    }
    const category = await this.prisma.expenseCategory.create({
      data: { communityId, code, name: input.name.trim(), description: input.description?.trim() || null },
    });
    await this.audit(this.prisma, communityId, actorUserId, 'EXPENSE_CATEGORY_CREATED', 'ExpenseCategory', category.id, 'Categoría de gasto creada', category);
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

  async listConcepts(
    communityId: string,
    query: ListExpenseConceptsQueryDto,
  ) {
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
        orderBy: [
          { category: { code: 'asc' } },
          { code: 'asc' },
        ],
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
      throw new ConflictException('Ya existe un beneficiario con este RIF o cédula.');
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
      },
      include: { category: true },
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
      },
      include: { category: true },
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

  async createPeriod(communityId: string, actorUserId: string, input: CreateBillingPeriodDto) {
    if (await this.prisma.billingPeriod.findUnique({ where: { communityId_periodKey: { communityId, periodKey: input.periodKey } } })) {
      throw new ConflictException('El período indicado ya existe para esta comunidad.');
    }
    const [year, month] = input.periodKey.split('-').map(Number);
    const startsOn = new Date(Date.UTC(year, month - 1, 1));
    const endsOn = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const officialRate = await this.officialExchangeRate();
    const period = await this.prisma.billingPeriod.create({
      data: {
        communityId,
        periodKey: input.periodKey,
        label: input.label.trim(),
        startsOn,
        endsOn,
        bcvRate: new Prisma.Decimal(officialRate.promedio),
      },
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

  async createExpense(communityId: string, actorUserId: string, billingPeriodId: string, input: CreatePeriodExpenseDto) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: billingPeriodId, communityId },
    });
    if (!period) throw new NotFoundException('El período no pertenece a la comunidad seleccionada.');
    if (period.status !== BillingPeriodStatus.DRAFT) throw new ConflictException('Solo se pueden registrar egresos en un período en borrador.');
    const [concept, expenseAccount, paymentAccount, bankAccount, paymentMethod] = await Promise.all([
      this.prisma.expenseConcept.findFirst({
        where: {
          id: input.conceptId,
          communityId,
          status: RecordStatus.ACTIVE,
          category: { status: RecordStatus.ACTIVE },
        },
        include: { category: true },
      }),
      this.prisma.ledgerAccount.findFirst({ where: { id: input.expenseAccountId, communityId, status: RecordStatus.ACTIVE } }),
      this.prisma.ledgerAccount.findFirst({ where: { id: input.paymentAccountId, communityId, status: RecordStatus.ACTIVE } }),
      input.bankAccountId ? this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, communityId, status: RecordStatus.ACTIVE } }) : null,
      input.paymentMethodId ? this.prisma.paymentMethod.findFirst({ where: { id: input.paymentMethodId, communityId, status: RecordStatus.ACTIVE } }) : null,
    ]);
    if (!concept) {
      throw new NotFoundException(
        'El concepto no pertenece a una categoría activa de esta comunidad.',
      );
    }
    if (!expenseAccount || expenseAccount.type !== LedgerAccountType.EXPENSE || !expenseAccount.acceptsEntries) {
      throw new BadRequestException('Selecciona una cuenta contable de gasto que admita movimientos.');
    }
    if (!paymentAccount || paymentAccount.type !== LedgerAccountType.ASSET || !paymentAccount.acceptsEntries) {
      throw new BadRequestException('La cuenta debitada debe ser una cuenta contable de activo.');
    }
    if (input.paymentSource === ExpensePaymentSource.BANK_ACCOUNT && !bankAccount) {
      throw new BadRequestException('Selecciona una cuenta bancaria válida.');
    }
    if (bankAccount && paymentAccount.bankAccountId !== bankAccount.id) {
      throw new BadRequestException('La cuenta contable de pago no corresponde a la cuenta bancaria seleccionada.');
    }
    if (input.paymentMethodId && !paymentMethod) throw new BadRequestException('El método de pago no pertenece a la comunidad.');

    const amount = new Prisma.Decimal(input.amount);
    const amountVes = this.toVes(amount, input.currency, period.bcvRate);
    const paidAt = new Date(input.paidAt);
    if (paidAt < period.startsOn || paidAt > period.endsOn) {
      throw new BadRequestException(
        `La fecha del egreso debe pertenecer al mes de gestión ${period.periodKey}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const accountingPeriod = await tx.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey: period.periodKey } },
        create: { communityId, periodKey: period.periodKey, label: period.label, startsOn: period.startsOn, endsOn: period.endsOn },
        update: {},
      });
      if (accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException('El período contable correspondiente está cerrado o bloqueado.');
      }
      await tx.communityAccountingSettings.upsert({ where: { communityId }, create: { communityId }, update: {} });
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
          allocationMethod: input.allocationMethod ?? ExpenseAllocationMethod.ALIQUOT,
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
          expenseAccountId: expenseAccount.id,
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
                communityId, accountId: expenseAccount.id, lineNumber: 1,
                description: input.description.trim(), debit: amountVes, credit: new Prisma.Decimal(0),
                transactionAmount: amount, transactionCurrency: input.currency,
                exchangeRate: input.currency === Currency.USD ? period.bcvRate : new Prisma.Decimal(1),
                referenceType: 'EXPENSE', referenceId: expense.id,
              },
              {
                communityId, accountId: paymentAccount.id, lineNumber: 2,
                description: `Pago a ${input.beneficiaryName.trim()}`, debit: new Prisma.Decimal(0), credit: amountVes,
                transactionAmount: amount, transactionCurrency: input.currency,
                exchangeRate: input.currency === Currency.USD ? period.bcvRate : new Prisma.Decimal(1),
                referenceType: 'PAYMENT', referenceId: input.paymentReference.trim(),
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
      await this.audit(tx, communityId, actorUserId, 'EXPENSE_POSTED', 'PeriodExpense', expense.id, 'Egreso registrado y contabilizado por partida doble', result);
      return result;
    });
  }

  async createOwnerPayment(
    communityId: string,
    actorUserId: string,
    input: CreateOwnerPaymentDto,
  ) {
    const paidAt = new Date(input.paidAt);
    const amount = new Prisma.Decimal(input.amount);
    const exchangeRate = new Prisma.Decimal(input.exchangeRate);
    const amountVes = this.toVes(amount, input.currency, exchangeRate).toDecimalPlaces(2);

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
        where: { id: input.propertyId, communityId, status: RecordStatus.ACTIVE },
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
    if (paymentMethod && paymentMethod.currency !== input.currency) {
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
                debit: amountVes,
                credit: new Prisma.Decimal(0),
                transactionAmount: amount,
                transactionCurrency: input.currency,
                exchangeRate,
                referenceType: 'OWNER_PAYMENT',
                referenceId: paymentId,
              },
              ...(appliedToNoticeVes.greaterThan(0)
                ? [
                    {
                      communityId,
                      accountId: receivableAccount.id,
                      lineNumber: 2,
                      description: `Aplicación a cuenta por cobrar · ${property.code}`,
                      debit: new Prisma.Decimal(0),
                      credit: appliedToNoticeVes,
                      transactionAmount: null,
                      transactionCurrency: null,
                      exchangeRate: null,
                      referenceType: 'CHARGE_NOTICE_ALLOCATION',
                      referenceId: allocation?.id ?? null,
                    },
                  ]
                : []),
              ...(advanceVes.greaterThan(0) && advanceAccount
                ? [
                    {
                      communityId,
                      accountId: advanceAccount.id,
                      lineNumber: appliedToNoticeVes.greaterThan(0) ? 3 : 2,
                      description: `Anticipo del inmueble ${property.code}`,
                      debit: new Prisma.Decimal(0),
                      credit: advanceVes,
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
          currency: input.currency,
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

  async prepareChargeNotice(communityId: string, actorUserId: string, billingPeriodId: string, input: PrepareChargeNoticeDto) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: billingPeriodId, communityId },
      include: { expenses: { where: { status: RecordStatus.ACTIVE } }, chargeNotice: true },
    });
    if (!period) throw new NotFoundException('El período no pertenece a la comunidad seleccionada.');
    if (period.status !== BillingPeriodStatus.DRAFT) throw new ConflictException('El aviso solo puede prepararse mientras el período esté en borrador.');
    if (period.chargeNotice?.status === ChargeNoticeStatus.ISSUED) throw new ConflictException('El aviso de cobro ya fue emitido y no puede recalcularse.');
    if (period.expenses.some((expense) => !expense.journalEntryId)) {
      throw new ConflictException('Todos los egresos deben estar contabilizados antes de preparar el aviso.');
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
    if (!properties.length) throw new ConflictException('La comunidad no tiene inmuebles activos para distribuir el aviso.');
    if (properties.some((property) => property.currentAliquot === null)) {
      throw new ConflictException('Todos los inmuebles activos deben tener una alícuota vigente.');
    }
    const aliquotTotal = properties.reduce((total, property) => total.add(property.currentAliquot!), new Prisma.Decimal(0));
    if (aliquotTotal.minus(100).abs().greaterThan(new Prisma.Decimal('0.01'))) {
      throw new ConflictException(`Las alícuotas activas deben sumar 100%. Actualmente suman ${aliquotTotal.toFixed(6)}%.`);
    }
    const totalExpensesVes = period.expenses.reduce(
      (total, expense) => total.add(this.toVes(expense.amount, expense.currency, period.bcvRate)),
      new Prisma.Decimal(0),
    );
    const components = input.components.map((component) => ({
      ...component,
      amountDecimal: new Prisma.Decimal(component.amount),
      amountVes: this.toVes(new Prisma.Decimal(component.amount), component.currency, period.bcvRate),
    }));
    const totalComponentsVes = components.reduce((total, component) => total.add(component.amountVes), new Prisma.Decimal(0));
    const totalCommunityVes = totalExpensesVes.add(totalComponentsVes);
    const totalCommunityUsd = totalCommunityVes.div(period.bcvRate).toDecimalPlaces(2);
    const allocationRows = properties.map((property) => {
      const aliquot = property.currentAliquot!;
      const expenseShareVes = period.expenses.reduce((total, expense) => {
        const base = this.toVes(expense.amount, expense.currency, period.bcvRate);
        return total.add(expense.allocationMethod === ExpenseAllocationMethod.FIXED ? base.div(properties.length) : base.mul(aliquot).div(100));
      }, new Prisma.Decimal(0)).toDecimalPlaces(2);
      const componentShareVes = components.reduce((total, component) =>
        total.add(component.allocationMethod === ExpenseAllocationMethod.FIXED ? component.amountVes.div(properties.length) : component.amountVes.mul(aliquot).div(100)),
      new Prisma.Decimal(0)).toDecimalPlaces(2);
      return { propertyId: property.id, aliquotSnapshot: aliquot, expenseShareVes, componentShareVes };
    });
    const finalAllocation = allocationRows.at(-1);
    if (finalAllocation) {
      const roundedExpenses = allocationRows.reduce((sum, row) => sum.add(row.expenseShareVes), new Prisma.Decimal(0));
      const roundedComponents = allocationRows.reduce((sum, row) => sum.add(row.componentShareVes), new Prisma.Decimal(0));
      finalAllocation.expenseShareVes = finalAllocation.expenseShareVes.add(totalExpensesVes.toDecimalPlaces(2).sub(roundedExpenses));
      finalAllocation.componentShareVes = finalAllocation.componentShareVes.add(totalComponentsVes.toDecimalPlaces(2).sub(roundedComponents));
    }

    return this.prisma.$transaction(async (tx) => {
      if (period.chargeNotice) await tx.chargeNotice.delete({ where: { id: period.chargeNotice.id } });
      const notice = await tx.chargeNotice.create({
        data: {
          communityId,
          billingPeriodId,
          status: ChargeNoticeStatus.PREPARED,
          totalExpensesVes: totalExpensesVes.toDecimalPlaces(2),
          totalComponentsVes: totalComponentsVes.toDecimalPlaces(2),
          totalCommunityVes: totalCommunityVes.toDecimalPlaces(2),
          totalCommunityUsd,
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
            create: allocationRows.map((row) => {
              const totalVes = row.expenseShareVes.add(row.componentShareVes);
              return {
                propertyId: row.propertyId,
                aliquotSnapshot: row.aliquotSnapshot,
                expenseShareVes: row.expenseShareVes,
                componentShareVes: row.componentShareVes,
                totalVes: totalVes.toDecimalPlaces(2),
                totalUsd: totalVes.div(period.bcvRate).toDecimalPlaces(2),
              };
            }),
          },
        },
        include: { components: true, allocations: { include: { property: true }, orderBy: { property: { code: 'asc' } } } },
      });
      await this.audit(tx, communityId, actorUserId, 'CHARGE_NOTICE_PREPARED', 'ChargeNotice', notice.id, 'Aviso de cobro calculado con todos los egresos y conceptos del período', notice);
      return notice;
    });
  }

  async issueChargeNotice(communityId: string, actorUserId: string, noticeId: string) {
    return this.prisma.$transaction(async (tx) => {
      const notice = await tx.chargeNotice.findFirst({
        where: { id: noticeId, communityId },
        include: {
          billingPeriod: true,
          receivableAccount: true,
          billingIncomeAccount: true,
        },
      });
      if (!notice) throw new NotFoundException('El aviso no pertenece a la comunidad seleccionada.');
      if (notice.status !== ChargeNoticeStatus.PREPARED) throw new ConflictException('Solo puede emitirse un aviso previamente preparado.');
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
                debit: notice.totalCommunityVes,
                credit: new Prisma.Decimal(0),
                transactionAmount: notice.totalCommunityUsd,
                transactionCurrency: Currency.USD,
                exchangeRate: notice.billingPeriod.bcvRate,
                referenceType: 'CHARGE_NOTICE',
                referenceId: notice.id,
              },
              {
                communityId,
                accountId: notice.billingIncomeAccount.id,
                lineNumber: 2,
                description: `Ingreso por cuotas · ${notice.billingPeriod.label}`,
                debit: new Prisma.Decimal(0),
                credit: notice.totalCommunityVes,
                transactionAmount: notice.totalCommunityUsd,
                transactionCurrency: Currency.USD,
                exchangeRate: notice.billingPeriod.bcvRate,
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
      await tx.billingPeriod.update({ where: { id: notice.billingPeriodId }, data: { status: BillingPeriodStatus.ISSUED, issuedAt } });
      await this.audit(tx, communityId, actorUserId, 'CHARGE_NOTICE_ISSUED', 'ChargeNotice', notice.id, `Aviso de cobro emitido y contabilizado en el asiento N.º ${sequence.nextJournalNumber - 1}`, result);
      return result;
    });
  }

  private toVes(amount: Prisma.Decimal, currency: Currency, bcvRate: Prisma.Decimal) {
    if (currency === Currency.VES) return amount;
    if (currency === Currency.USD) return amount.mul(bcvRate);
    throw new BadRequestException('La conversión de EUR requiere una tasa explícita; usa VES o USD en esta etapa.');
  }

  private audit(client: PrismaService | Prisma.TransactionClient, communityId: string, actorUserId: string, action: string, entityType: string, entityId: string, detail: string, after: unknown) {
    return client.auditEvent.create({
      data: { communityId, actorUserId, requestId: randomUUID(), action, entityType, entityId, detail, after: after as Prisma.InputJsonValue },
    });
  }
}
