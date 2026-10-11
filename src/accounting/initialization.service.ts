import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountingPeriodStatus, Currency, JournalEntrySource, JournalEntryStatus, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AddInitializationRowsDto, CreateInitializationDto } from './dto/initialization.dto';

const ALLOWED_KINDS = new Set(['CHARGE_NOTICE', 'OWNER_PAYMENT', 'OWNER_BALANCE', 'PAYABLE', 'BANK_BALANCE']);

@Injectable()
export class InitializationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(communityId: string) {
    const item = await this.prisma.initializationCase.findUnique({
      where: { communityId },
      include: { rows: { orderBy: [{ eventDate: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!item) return null;
    return this.summary(item);
  }

  async create(communityId: string, actorUserId: string, input: CreateInitializationDto) {
    const existing = await this.prisma.initializationCase.findUnique({ where: { communityId } });
    if (existing && existing.status === 'APPLIED') {
      throw new ConflictException('La inicialización ya fue aplicada; cualquier corrección debe hacerse mediante un ajuste contable.');
    }
    const item = await this.prisma.initializationCase.upsert({
      where: { communityId },
      create: {
        communityId,
        createdById: actorUserId,
        cutoverDate: input.cutoverDate ? new Date(input.cutoverDate) : null,
        historyFrom: input.historyFrom ? new Date(input.historyFrom) : null,
        historyTo: input.historyTo ? new Date(input.historyTo) : null,
      },
      update: {
        cutoverDate: input.cutoverDate ? new Date(input.cutoverDate) : undefined,
        historyFrom: input.historyFrom ? new Date(input.historyFrom) : undefined,
        historyTo: input.historyTo ? new Date(input.historyTo) : undefined,
        status: 'DRAFT',
      },
      include: { rows: true },
    });
    await this.audit(communityId, actorUserId, 'INITIALIZATION_CREATED', item.id, 'Expediente de inicialización creado o actualizado');
    return this.summary(item);
  }

  async addRows(communityId: string, actorUserId: string, id: string, input: AddInitializationRowsDto) {
    const item = await this.prisma.initializationCase.findFirst({ where: { id, communityId } });
    if (!item) throw new NotFoundException('El expediente de inicialización no existe.');
    if (item.status === 'APPLIED') throw new ConflictException('No se pueden modificar filas después de aplicar la inicialización.');
    const propertyIds = [...new Set(input.rows.map(row => row.propertyId).filter(Boolean) as string[])];
    const vendorIds = [...new Set(input.rows.map(row => row.vendorId).filter(Boolean) as string[])];
    const [properties, vendors] = await Promise.all([
      this.prisma.property.findMany({ where: { id: { in: propertyIds }, communityId }, select: { id: true } }),
      this.prisma.vendor.findMany({ where: { id: { in: vendorIds }, communityId }, select: { id: true } }),
    ]);
    if (properties.length !== propertyIds.length) throw new BadRequestException('Uno o más inmuebles no pertenecen a la comunidad.');
    if (vendors.length !== vendorIds.length) throw new BadRequestException('Uno o más proveedores no pertenecen a la comunidad.');
    const requestedOwnerBalancePropertyIds = input.rows
      .filter((row) => row.kind === 'OWNER_BALANCE' && row.propertyId)
      .map((row) => row.propertyId as string);
    const ownerBalancePropertyIds = [...new Set(requestedOwnerBalancePropertyIds)];
    if (ownerBalancePropertyIds.length) {
      const existingBalances = await this.prisma.initializationRow.findMany({
        where: { initializationId: item.id, kind: 'OWNER_BALANCE', propertyId: { in: ownerBalancePropertyIds } },
        select: { propertyId: true },
      });
      if (existingBalances.length) {
        throw new ConflictException('Uno o más apartamentos ya tienen un saldo inicial guardado en este expediente.');
      }
    }
    if (ownerBalancePropertyIds.length !== input.rows.filter((row) => row.kind === 'OWNER_BALANCE').length) {
      throw new BadRequestException('Cada saldo inicial requiere un apartamento.');
    }
    if (ownerBalancePropertyIds.length !== requestedOwnerBalancePropertyIds.length) {
      throw new BadRequestException('No se puede cargar más de un saldo inicial para el mismo apartamento en una sola solicitud.');
    }
    for (const row of input.rows) {
      if (!ALLOWED_KINDS.has(row.kind)) throw new BadRequestException(`Tipo de fila no permitido: ${row.kind}.`);
      if (row.amount < 0) throw new BadRequestException(`El importe de ${row.externalRef} no puede ser negativo.`);
      if (row.amount === 0 && row.kind !== 'OWNER_BALANCE') throw new BadRequestException(`El importe de ${row.externalRef} debe ser mayor que cero.`);
      if (row.kind === 'PAYABLE' && !row.vendorId) throw new BadRequestException(`La cuenta por pagar ${row.externalRef} requiere proveedor.`);
      if (['CHARGE_NOTICE', 'OWNER_PAYMENT', 'OWNER_BALANCE'].includes(row.kind) && !row.propertyId) throw new BadRequestException(`${row.kind} ${row.externalRef} requiere inmueble.`);
      if (item.historyFrom && new Date(row.eventDate) < item.historyFrom) throw new BadRequestException(`${row.externalRef} está antes de la ventana histórica.`);
      if (item.historyTo && new Date(row.eventDate) > item.historyTo) throw new BadRequestException(`${row.externalRef} está después de la ventana histórica.`);
    }
    try {
      await this.prisma.initializationRow.createMany({
        data: input.rows.map(row => ({
          initializationId: item.id,
          kind: row.kind,
          externalRef: row.externalRef.trim(),
          propertyId: row.propertyId ?? null,
          vendorId: row.vendorId ?? null,
          eventDate: new Date(row.eventDate),
          description: row.description.trim(),
          amount: new Prisma.Decimal(row.amount),
          currency: row.currency,
          metadata: row.metadata as Prisma.InputJsonValue | undefined,
          status: row.kind === 'OWNER_BALANCE' && row.amount === 0 ? 'SOLVENT' : 'PENDING',
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      throw new BadRequestException('No se pudieron cargar las filas. Verifica referencias y duplicados.', { cause: error });
    }
    await this.prisma.initializationCase.update({ where: { id: item.id }, data: { status: 'DRAFT' } });
    await this.audit(communityId, actorUserId, 'INITIALIZATION_ROWS_LOADED', item.id, `${input.rows.length} filas recibidas; aún no afectan la contabilidad`);
    return this.get(communityId);
  }

  async validate(communityId: string, actorUserId: string) {
    const item = await this.prisma.initializationCase.findUnique({ where: { communityId }, include: { rows: true } });
    if (!item) throw new NotFoundException('Crea primero el expediente de inicialización.');
    const errors: string[] = [];
    if (!item.cutoverDate) errors.push('Falta la fecha de corte.');
    if (!item.historyFrom || !item.historyTo) errors.push('Falta definir la ventana histórica.');
    if (item.historyFrom && item.historyTo && item.historyFrom > item.historyTo) errors.push('La ventana histórica es inválida.');
    if (item.rows.length === 0) errors.push('No hay filas cargadas.');
    const byKind = new Map<string, Prisma.Decimal>();
    for (const row of item.rows) byKind.set(row.kind, (byKind.get(row.kind) ?? new Prisma.Decimal(0)).plus(row.amount));
    const nextStatus = errors.length ? 'DRAFT' : 'READY';
    await this.prisma.initializationCase.update({ where: { id: item.id }, data: { status: nextStatus } });
    await this.audit(communityId, actorUserId, 'INITIALIZATION_VALIDATED', item.id, errors.length ? `Validación fallida: ${errors.join(' ')}` : 'Inicialización lista para conciliación');
    return { ...(await this.get(communityId)), valid: errors.length === 0, errors, totals: Object.fromEntries([...byKind].map(([kind, amount]) => [kind, amount.toFixed(2)])) };
  }

  async apply(communityId: string, actorUserId: string) {
    const item = await this.prisma.initializationCase.findUnique({ where: { communityId }, include: { rows: { where: { status: 'PENDING' } } } });
    if (!item) throw new NotFoundException('Crea primero el expediente de inicialización.');
    if (item.status !== 'READY') throw new ConflictException('La inicialización debe validarse antes de aplicarse.');
    if (!item.cutoverDate) throw new BadRequestException('Falta la fecha de corte.');
    const cutoverDate = item.cutoverDate;
    if (!item.rows.length) throw new BadRequestException('No hay filas para aplicar.');

    const accountIds = new Set<string>();
    const rowAccounts = item.rows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      let debitAccountId = typeof metadata.debitAccountId === 'string' ? metadata.debitAccountId : '';
      let creditAccountId = typeof metadata.creditAccountId === 'string' ? metadata.creditAccountId : '';
      if (row.kind === 'OWNER_BALANCE' && typeof metadata.signedBalance === 'number') {
        const signedBalance = metadata.signedBalance;
        const receivableAccountId = typeof metadata.receivableAccountId === 'string' ? metadata.receivableAccountId : '';
        const advanceAccountId = typeof metadata.advanceAccountId === 'string' ? metadata.advanceAccountId : '';
        const openingOffsetAccountId = typeof metadata.openingOffsetAccountId === 'string' ? metadata.openingOffsetAccountId : '';
        if (!receivableAccountId || !advanceAccountId || !openingOffsetAccountId) throw new BadRequestException(`El saldo de ${row.externalRef} requiere cuentas de cobrar, anticipos y apertura.`);
        if (signedBalance > 0) { debitAccountId = receivableAccountId; creditAccountId = openingOffsetAccountId; }
        else if (signedBalance < 0) { debitAccountId = openingOffsetAccountId; creditAccountId = advanceAccountId; }
        else throw new BadRequestException(`El saldo de ${row.externalRef} no puede ser cero; usa un registro solvente sin movimiento.`);
      }
      if (!debitAccountId || !creditAccountId) throw new BadRequestException(`La fila ${row.externalRef} no tiene cuentas contables de débito y crédito.`);
      accountIds.add(debitAccountId); accountIds.add(creditAccountId);
      return { row, debitAccountId, creditAccountId };
    });
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: [...accountIds] }, communityId, status: RecordStatus.ACTIVE, acceptsEntries: true, children: { none: {} } },
      select: { id: true },
    });
    if (accounts.length !== accountIds.size) throw new BadRequestException('Una o más cuentas de la apertura no pertenecen a la comunidad, están inactivas o son agrupadoras.');
    const periodKey = `${item.cutoverDate.getUTCFullYear()}-${String(item.cutoverDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const startsOn = new Date(Date.UTC(item.cutoverDate.getUTCFullYear(), item.cutoverDate.getUTCMonth(), 1));
    const endsOn = new Date(Date.UTC(item.cutoverDate.getUTCFullYear(), item.cutoverDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey } },
        create: { communityId, periodKey, label: `Período de apertura ${periodKey}`, startsOn, endsOn },
        update: {},
      });
      if (period.status !== AccountingPeriodStatus.OPEN) throw new ConflictException('El período de apertura no está abierto.');
      const settings = await tx.communityAccountingSettings.upsert({ where: { communityId }, create: { communityId }, update: {} });
      const sequence = await tx.communityAccountingSettings.update({ where: { communityId }, data: { nextJournalNumber: { increment: 1 } } });
      const materialized = new Map<string, { type: string; id: string }>();
      const noticeRows = item.rows.filter((row) => row.kind === 'CHARGE_NOTICE');
      const rowsByPeriod = new Map<string, typeof noticeRows>();
      for (const row of noticeRows) {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const periodKey = typeof metadata.periodKey === 'string' ? metadata.periodKey : '';
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException(`El aviso ${row.externalRef} requiere metadata.periodKey válido.`);
        rowsByPeriod.set(periodKey, [...(rowsByPeriod.get(periodKey) ?? []), row]);
      }
      for (const [periodKey, rows] of rowsByPeriod) {
        const firstMetadata = (rows[0].metadata ?? {}) as Record<string, unknown>;
        const receivableAccountId = typeof firstMetadata.receivableAccountId === 'string' ? firstMetadata.receivableAccountId : '';
        const incomeAccountId = typeof firstMetadata.billingIncomeAccountId === 'string' ? firstMetadata.billingIncomeAccountId : '';
        if (!receivableAccountId || !incomeAccountId) throw new BadRequestException(`El período ${periodKey} requiere cuentas por cobrar e ingreso.`);
        if (rows.some(row => {
          const metadata = (row.metadata ?? {}) as Record<string, unknown>;
          return metadata.receivableAccountId !== receivableAccountId || metadata.billingIncomeAccountId !== incomeAccountId;
        })) throw new BadRequestException(`Las filas del período ${periodKey} deben usar las mismas cuentas contables.`);
        const startsOn = new Date(`${periodKey}-01T00:00:00.000Z`);
        const [year, month] = periodKey.split('-').map(Number);
        const endsOn = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        const billingPeriod = await tx.billingPeriod.upsert({
          where: { communityId_periodKey: { communityId, periodKey } },
          create: { communityId, periodKey, label: `Período ${periodKey}`, startsOn, endsOn, bcvRate: new Prisma.Decimal(1), status: 'ISSUED', issuedAt: endsOn },
          update: {},
        });
        const existingNotice = await tx.chargeNotice.findUnique({ where: { billingPeriodId: billingPeriod.id }, select: { id: true } });
        if (existingNotice) throw new ConflictException(`El aviso del período ${periodKey} ya existe; no se duplicará.`);
        const total = rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
        const notice = await tx.chargeNotice.create({
          data: {
            communityId, billingPeriodId: billingPeriod.id, status: 'ISSUED', dueDate: endsOn, totalExpensesVes: total, totalComponentsVes: 0,
            totalCommunityVes: total, totalCommunityUsd: total, issuedAt: endsOn, createdById: actorUserId,
            receivableAccountId, billingIncomeAccountId: incomeAccountId,
            allocations: { create: rows.map(row => { const metadata = (row.metadata ?? {}) as Record<string, unknown>; return {
              propertyId: row.propertyId!, aliquotSnapshot: new Prisma.Decimal(typeof metadata.aliquotSnapshot === 'number' ? metadata.aliquotSnapshot : 0),
              expenseShareVes: row.amount, componentShareVes: 0, totalVes: row.amount, totalUsd: row.amount,
            }; }) },
          },
        });
        for (const row of rows) materialized.set(row.id, { type: 'ChargeNotice', id: notice.id });
      }
      for (const { row } of rowAccounts) {
        if (row.kind === 'CHARGE_NOTICE') continue;
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        if (row.kind === 'OWNER_PAYMENT') {
          const [paymentMethod, bankAccount, payer] = await Promise.all([
            typeof metadata.paymentMethodId === 'string' ? tx.paymentMethod.findFirst({ where: { id: metadata.paymentMethodId, communityId } }) : null,
            typeof metadata.bankAccountId === 'string' ? tx.bankAccount.findFirst({ where: { id: metadata.bankAccountId, communityId } }) : null,
            typeof metadata.payerPersonId === 'string' ? tx.ownership.findFirst({ where: { communityId, propertyId: row.propertyId!, personId: metadata.payerPersonId, status: 'ACTIVE' } }) : null,
          ]);
          if (metadata.paymentMethodId && !paymentMethod) throw new BadRequestException(`El método de pago de ${row.externalRef} no pertenece a la comunidad.`);
          if (metadata.bankAccountId && !bankAccount) throw new BadRequestException(`La cuenta bancaria de ${row.externalRef} no pertenece a la comunidad.`);
          if (metadata.payerPersonId && !payer) throw new BadRequestException(`El pagador de ${row.externalRef} no es propietario del inmueble.`);
          const payment = await tx.ownerPayment.create({
            data: {
              communityId,
              propertyId: row.propertyId!,
              payerPersonId: typeof metadata.payerPersonId === 'string' ? metadata.payerPersonId : null,
              paymentMethodId: typeof metadata.paymentMethodId === 'string' ? metadata.paymentMethodId : null,
              bankAccountId: typeof metadata.bankAccountId === 'string' ? metadata.bankAccountId : null,
              exchangeRate: new Prisma.Decimal(typeof metadata.exchangeRate === 'number' ? metadata.exchangeRate : 1),
              originalAmount: row.amount,
              originalCurrency: row.currency,
              functionalAmount: row.amount,
              functionalCurrency: row.currency,
              reference: row.externalRef,
              paidAt: row.eventDate,
              notes: row.description,
              status: 'RECONCILED',
              createdById: actorUserId,
              reportedAt: row.eventDate,
              reportedById: actorUserId,
              reconciledAt: row.eventDate,
              reconciledById: actorUserId,
            },
          });
          materialized.set(row.id, { type: 'OwnerPayment', id: payment.id });
        } else if (row.kind === 'PAYABLE') {
          const billingPeriodId = typeof metadata.billingPeriodId === 'string' ? metadata.billingPeriodId : '';
          const conceptId = typeof metadata.conceptId === 'string' ? metadata.conceptId : '';
          if (!billingPeriodId || !conceptId || !row.vendorId) throw new BadRequestException(`La cuenta por pagar ${row.externalRef} requiere billingPeriodId, conceptId y vendorId.`);
          const vendor = await tx.vendor.findFirst({ where: { id: row.vendorId, communityId } });
          if (!vendor) throw new BadRequestException(`El proveedor de ${row.externalRef} no pertenece a la comunidad.`);
          const expense = await tx.periodExpense.create({
            data: {
              communityId, billingPeriodId, conceptId, description: row.description, amount: row.amount, currency: row.currency,
              beneficiaryName: vendor.legalName, beneficiaryDocument: vendor.document, invoiceNumber: row.externalRef, status: 'ACTIVE',
            },
          });
          materialized.set(row.id, { type: 'PeriodExpense', id: expense.id });
        }
      }
      const entry = await tx.journalEntry.create({
        data: {
          communityId, accountingPeriodId: period.id, entryNumber: sequence.nextJournalNumber - 1,
          entryDate: cutoverDate, description: 'Asiento de apertura · inicialización financiera', source: JournalEntrySource.OPENING,
          sourceId: item.id, status: JournalEntryStatus.POSTED, postedAt: new Date(), postedById: actorUserId, createdById: actorUserId,
          lines: { create: rowAccounts.flatMap(({ row, debitAccountId, creditAccountId }, index) => [
            { communityId, accountId: debitAccountId, lineNumber: index * 2 + 1, description: row.description, debit: row.amount, credit: 0, referenceType: 'INITIALIZATION_ROW', referenceId: row.id },
            { communityId, accountId: creditAccountId, lineNumber: index * 2 + 2, description: row.description, debit: 0, credit: row.amount, referenceType: 'INITIALIZATION_ROW', referenceId: row.id },
          ]) },
        },
      });
      for (const row of item.rows) {
        const operational = materialized.get(row.id);
        await tx.initializationRow.update({ where: { id: row.id }, data: { status: 'APPLIED', operationalEntityType: operational?.type ?? null, operationalEntityId: operational?.id ?? null } });
      }
      const applied = await tx.initializationCase.update({ where: { id: item.id }, data: { status: 'APPLIED', appliedAt: new Date(), journalEntryId: entry.id } });
      await tx.auditEvent.create({ data: { communityId, actorUserId, requestId: `initialization-apply-${item.id}`, action: 'INITIALIZATION_APPLIED', entityType: 'InitializationCase', entityId: item.id, detail: `Asiento de apertura N.º ${entry.entryNumber} contabilizado` } });
      return { status: applied.status, initializationId: applied.id, journalEntryId: entry.id, entryNumber: entry.entryNumber, rowsApplied: rowAccounts.length };
    });
  }

  private summary(item: any) {
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of item.rows ?? []) totals.set(row.kind, (totals.get(row.kind) ?? new Prisma.Decimal(0)).plus(row.amount));
    return { ...item, totals: Object.fromEntries([...totals].map(([kind, amount]) => [kind, amount.toFixed(2)])), rowCount: item.rows?.length ?? 0 };
  }

  private audit(communityId: string, actorUserId: string, action: string, entityId: string, detail: string) {
    return this.prisma.auditEvent.create({ data: { communityId, actorUserId, requestId: `initialization-${Date.now()}`, action, entityType: 'InitializationCase', entityId, detail } });
  }
}
