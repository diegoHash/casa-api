import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  LedgerAccountType,
  NormalBalance,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  CreateAccountingPeriodDto,
  CreateJournalEntryDto,
  CreateJournalLineDto,
  CreateLedgerAccountDto,
  ReverseJournalEntryDto,
  UpdateLedgerAccountDto,
} from './dto/accounting.dto';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  snapshot(communityId: string) {
    return this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
      select: {
        id: true,
        name: true,
        legalName: true,
        rif: true,
        address: true,
        state: true,
        city: true,
        postalCode: true,
        email: true,
        accountingSettings: true,
        ledgerAccounts: {
          orderBy: { code: 'asc' },
          include: { bankAccount: true },
        },
        accountingPeriods: {
          orderBy: { startsOn: 'desc' },
          take: 24,
        },
        journalEntries: {
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          take: 100,
          include: {
            accountingPeriod: true,
            lines: {
              orderBy: { lineNumber: 'asc' },
              include: { account: true },
            },
          },
        },
      },
    });
  }

  async receivables(communityId: string) {
    const issuedFilter = { communityId, status: 'ISSUED' as const };
    const notices = await this.prisma.chargeNotice.findMany({
      where: issuedFilter,
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        issuedAt: true,
        billingPeriod: { select: { id: true, label: true, periodKey: true } },
      },
    });

    const noticeIds = notices.map((notice) => notice.id);
    const allocations = noticeIds.length
      ? await this.prisma.chargeNoticeAllocation.findMany({
          where: { chargeNoticeId: { in: noticeIds } },
          select: {
            id: true,
            chargeNoticeId: true,
            totalUsd: true,
            property: {
              select: { id: true, code: true },
            },
          },
        })
      : [];
    const allocationIds = allocations.map((allocation) => allocation.id);
    const appliedByAllocation = allocationIds.length
      ? await this.prisma.paymentApplication.groupBy({
          by: ['chargeNoticeAllocationId'],
          where: { communityId, functionalCurrency: 'USD', chargeNoticeAllocationId: { in: allocationIds } },
          _sum: { functionalAmount: true },
        })
      : [];
    const paidByAllocationId = new Map(appliedByAllocation.map((item) => [item.chargeNoticeAllocationId, item._sum.functionalAmount ?? new Prisma.Decimal(0)]));
    const allocationsByNoticeId = new Map<string, typeof allocations>();
    for (const allocation of allocations) {
      allocationsByNoticeId.set(allocation.chargeNoticeId, [...(allocationsByNoticeId.get(allocation.chargeNoticeId) ?? []), allocation]);
    }

    const detail = notices.map((notice) => {
      const noticeAllocations = allocationsByNoticeId.get(notice.id) ?? [];
      const issuedUsd = noticeAllocations.reduce(
        (total, allocation) => total.plus(allocation.totalUsd),
        new Prisma.Decimal(0),
      );
      const paidUsd = noticeAllocations.reduce(
        (total, allocation) => total.plus(paidByAllocationId.get(allocation.id) ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );
      const pendingUsd = Prisma.Decimal.max(new Prisma.Decimal(0), issuedUsd.minus(paidUsd));
      return {
        id: notice.id,
        issuedAt: notice.issuedAt,
        billingPeriod: notice.billingPeriod,
        issuedUsd: issuedUsd.toFixed(2),
        paidUsd: paidUsd.toFixed(2),
        pendingUsd: pendingUsd.toFixed(2),
      };
    });

    const totalIssuedUsd = detail.reduce((sum, item) => sum.plus(item.issuedUsd), new Prisma.Decimal(0));
    const totalPaidUsd = detail.reduce((sum, item) => sum.plus(item.paidUsd), new Prisma.Decimal(0));
    const totalPendingUsd = Prisma.Decimal.max(new Prisma.Decimal(0), totalIssuedUsd.minus(totalPaidUsd));

    const propertyMap = new Map<string, { code: string; issuedUsd: Prisma.Decimal; paidUsd: Prisma.Decimal; pendingUsd: Prisma.Decimal }>();
    for (const allocation of allocations) {
      const paidUsd = paidByAllocationId.get(allocation.id) ?? new Prisma.Decimal(0);
      const pendingUsd = Prisma.Decimal.max(new Prisma.Decimal(0), allocation.totalUsd.minus(paidUsd));
      const current = propertyMap.get(allocation.property.id) ?? {
        code: allocation.property.code,
        issuedUsd: new Prisma.Decimal(0),
        paidUsd: new Prisma.Decimal(0),
        pendingUsd: new Prisma.Decimal(0),
      };
      current.issuedUsd = current.issuedUsd.plus(allocation.totalUsd);
      current.paidUsd = current.paidUsd.plus(paidUsd);
      current.pendingUsd = current.pendingUsd.plus(pendingUsd);
      propertyMap.set(allocation.property.id, current);
    }
    const propertyBalances = [...propertyMap.entries()].map(([id, item]) => ({
      id,
      property: item.code,
      issuedUsd: item.issuedUsd.toFixed(2),
      paidUsd: item.paidUsd.toFixed(2),
      pendingUsd: item.pendingUsd.toFixed(2),
    })).sort((left, right) => Number(right.pendingUsd) - Number(left.pendingUsd));
    const current = detail[0] ?? null;
    const currentPeriod = current
      ? { ...current, collectionRate: current.issuedUsd === '0.00' ? 0 : Number(new Prisma.Decimal(current.paidUsd).div(current.issuedUsd).mul(100).toFixed(2)) }
      : null;

    return {
      currency: 'USD' as const,
      totalIssuedUsd: totalIssuedUsd.toFixed(2),
      totalPaidUsd: totalPaidUsd.toFixed(2),
      totalPendingUsd: totalPendingUsd.toFixed(2),
      notices: detail,
      propertyBalances,
      currentPeriod,
    };
  }

  async createAccount(
    communityId: string,
    actorUserId: string,
    input: CreateLedgerAccountDto,
  ) {
    const code = input.code.trim().toUpperCase().replace(/\s+/g, '');
    const duplicate = await this.prisma.ledgerAccount.findUnique({
      where: { communityId_code: { communityId, code } },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe una cuenta contable con este código.',
      );
    }
    if (input.parentId) {
      const parent = await this.prisma.ledgerAccount.findFirst({
        where: { id: input.parentId, communityId },
        include: { journalLines: { take: 1 } },
      });
      if (!parent) {
        throw new NotFoundException(
          'La cuenta padre no pertenece a la comunidad seleccionada.',
        );
      }
      if (parent.journalLines.length > 0) {
        throw new ConflictException(
          'No se puede convertir una cuenta con movimientos en cuenta agrupadora.',
        );
      }
    }
    if (input.bankAccountId) {
      const bankAccount = await this.prisma.bankAccount.findFirst({
        where: { id: input.bankAccountId, communityId },
        include: { ledgerAccount: true },
      });
      if (!bankAccount) {
        throw new NotFoundException(
          'La cuenta bancaria no pertenece a la comunidad seleccionada.',
        );
      }
      if (bankAccount.ledgerAccount) {
        throw new ConflictException(
          'La cuenta bancaria ya está vinculada a otra cuenta contable.',
        );
      }
      if (input.currency && input.currency !== bankAccount.currency) {
        throw new ConflictException(
          'La moneda contable debe coincidir con la cuenta bancaria.',
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.create({
        data: {
          communityId,
          parentId: input.parentId ?? null,
          bankAccountId: input.bankAccountId ?? null,
          code,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          type: input.type,
          normalBalance: this.normalBalanceFor(input.type),
          currency: input.currency ?? null,
          acceptsEntries: input.acceptsEntries ?? true,
        },
        include: { bankAccount: true },
      });
      if (input.parentId) {
        await tx.ledgerAccount.update({
          where: { id: input.parentId },
          data: { acceptsEntries: false },
        });
      }
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'LEDGER_ACCOUNT_CREATED',
        'LedgerAccount',
        account.id,
        'Cuenta contable creada',
        account,
      );
      return account;
    });
  }

  async updateAccount(
    communityId: string,
    actorUserId: string,
    id: string,
    input: UpdateLedgerAccountDto,
  ) {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id, communityId },
    });
    if (!account) {
      throw new NotFoundException('La cuenta contable no existe.');
    }

    const data: Prisma.LedgerAccountUpdateInput = {};

    if (input.code !== undefined) {
      const code = input.code.trim().toUpperCase().replace(/\s+/g, '');
      if (code !== account.code) {
        const duplicate = await this.prisma.ledgerAccount.findUnique({
          where: { communityId_code: { communityId, code } },
        });
        if (duplicate) {
          throw new ConflictException(
            'Ya existe una cuenta contable con este código.',
          );
        }
        data.code = code;
      }
    }

    if (input.name !== undefined) {
      data.name = input.name.trim();
    }

    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }

    if (input.type !== undefined) {
      data.type = input.type;
      data.normalBalance = this.normalBalanceFor(input.type);
    }

    if (input.currency !== undefined) {
      data.currency = input.currency ?? null;
    }

    if (input.parentId !== undefined) {
      if (input.parentId) {
        if (input.parentId === id) {
          throw new ConflictException(
            'Una cuenta no puede ser su propio padre.',
          );
        }
        const parent = await this.prisma.ledgerAccount.findFirst({
          where: { id: input.parentId, communityId },
          include: { journalLines: { take: 1 } },
        });
        if (!parent) {
          throw new NotFoundException(
            'La cuenta padre no pertenece a la comunidad seleccionada.',
          );
        }
        if (parent.journalLines.length > 0) {
          throw new ConflictException(
            'No se puede convertir una cuenta con movimientos en cuenta agrupadora.',
          );
        }
      }
      data.parent = input.parentId
        ? { connect: { id: input.parentId } }
        : { disconnect: true };
    }

    if (input.acceptsEntries !== undefined) {
      if (input.acceptsEntries) {
        const child = await this.prisma.ledgerAccount.findFirst({
          where: { parentId: id, communityId },
          select: { id: true },
        });
        if (child) {
          throw new ConflictException(
            'Una cuenta agrupadora no puede aceptar movimientos contables.',
          );
        }
      }
      data.acceptsEntries = input.acceptsEntries;
    }

    if (input.bankAccountId !== undefined) {
      if (input.bankAccountId) {
        const bankAccount = await this.prisma.bankAccount.findFirst({
          where: { id: input.bankAccountId, communityId },
          include: { ledgerAccount: true },
        });
        if (!bankAccount) {
          throw new NotFoundException(
            'La cuenta bancaria no pertenece a la comunidad seleccionada.',
          );
        }
        if (bankAccount.ledgerAccount && bankAccount.ledgerAccount.id !== id) {
          throw new ConflictException(
            'La cuenta bancaria ya está vinculada a otra cuenta contable.',
          );
        }
        const effectiveCurrency =
          input.currency !== undefined ? input.currency : account.currency;
        if (effectiveCurrency && effectiveCurrency !== bankAccount.currency) {
          throw new ConflictException(
            'La moneda contable debe coincidir con la cuenta bancaria.',
          );
        }
        data.bankAccount = { connect: { id: input.bankAccountId } };
      } else {
        data.bankAccount = { disconnect: true };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedAccount = await tx.ledgerAccount.update({
        where: { id },
        data,
        include: { bankAccount: true },
      });

      if (input.parentId) {
        await tx.ledgerAccount.update({
          where: { id: input.parentId },
          data: { acceptsEntries: false },
        });
      }

      await this.audit(
        tx,
        communityId,
        actorUserId,
        'LEDGER_ACCOUNT_UPDATED',
        'LedgerAccount',
        updatedAccount.id,
        'Cuenta contable actualizada',
        updatedAccount,
      );

      return updatedAccount;
    });
  }

  async deleteAccount(
    communityId: string,
    actorUserId: string,
    id: string,
  ) {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id, communityId },
      include: {
        children: { take: 1 },
        journalLines: { take: 1 },
      },
    });
    if (!account) {
      throw new NotFoundException('La cuenta contable no existe.');
    }
    if (account.journalLines.length > 0) {
      throw new ConflictException(
        'No se puede eliminar esta cuenta porque ya tiene movimientos contables registrados.',
      );
    }
    if (account.children.length > 0) {
      throw new ConflictException(
        'No se puede eliminar esta cuenta porque tiene cuentas hijas asociadas. Elimina primero las subcuentas.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.ledgerAccount.delete({ where: { id } });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'LEDGER_ACCOUNT_DELETED',
        'LedgerAccount',
        id,
        `Cuenta contable eliminada: ${account.code} · ${account.name}`,
        account,
      );
      return { deleted: true, id, code: account.code, name: account.name };
    });
  }

  async createPeriod(
    communityId: string,
    actorUserId: string,
    input: CreateAccountingPeriodDto,
  ) {
    const duplicate = await this.prisma.accountingPeriod.findUnique({
      where: {
        communityId_periodKey: {
          communityId,
          periodKey: input.periodKey,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException(
        'El período contable ya existe para esta comunidad.',
      );
    }
    const [year, month] = input.periodKey.split('-').map(Number);
    const startsOn = new Date(Date.UTC(year, month - 1, 1, 4));
    const endsOn = new Date(Date.UTC(year, month, 1, 3, 59, 59, 999));
    const period = await this.prisma.accountingPeriod.create({
      data: {
        communityId,
        periodKey: input.periodKey,
        label: input.label.trim(),
        startsOn,
        endsOn,
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'ACCOUNTING_PERIOD_CREATED',
      'AccountingPeriod',
      period.id,
      'Período contable abierto',
      period,
    );
    return period;
  }

  async createEntry(
    communityId: string,
    actorUserId: string,
    input: CreateJournalEntryDto,
  ) {
    const entryDate = new Date(input.entryDate);
    const period = await this.requireOpenPeriod(
      this.prisma,
      communityId,
      input.accountingPeriodId,
      entryDate,
    );
    await this.requireAccounts(communityId, input.lines);
    this.assertBalanced(input.lines);

    return this.prisma.$transaction(async (transaction) => {
      const entry = await transaction.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: period.id,
          entryDate,
          description: input.description.trim(),
          source: input.source,
          sourceId: input.sourceId?.trim() || null,
          createdById: actorUserId,
          lines: {
            create: input.lines.map((line, index) => ({
              communityId,
              accountId: line.accountId,
              lineNumber: index + 1,
              description: line.description?.trim() || null,
              debit: new Prisma.Decimal(line.debit),
              credit: new Prisma.Decimal(line.credit),
              transactionAmount:
                line.transactionAmount === undefined
                  ? null
                  : new Prisma.Decimal(line.transactionAmount),
              transactionCurrency: line.transactionCurrency ?? null,
              exchangeRate:
                line.exchangeRate === undefined
                  ? null
                  : new Prisma.Decimal(line.exchangeRate),
              referenceType: line.referenceType?.trim() || null,
              referenceId: line.referenceId?.trim() || null,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'JOURNAL_ENTRY_CREATED',
        'JournalEntry',
        entry.id,
        'Asiento contable creado en borrador',
        entry,
      );
      return entry;
    });
  }

  async postEntry(communityId: string, actorUserId: string, entryId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const entry = await transaction.journalEntry.findFirst({
        where: { id: entryId, communityId },
        include: { lines: true, accountingPeriod: true },
      });
      if (!entry) {
        throw new NotFoundException(
          'El asiento no pertenece a la comunidad seleccionada.',
        );
      }
      if (entry.status !== JournalEntryStatus.DRAFT) {
        throw new ConflictException(
          'Solo se pueden contabilizar asientos en borrador.',
        );
      }
      this.assertPeriodOpenForDate(entry.accountingPeriod, entry.entryDate);
      await this.requireAccounts(communityId, entry.lines, transaction);
      this.assertBalanced(entry.lines);
      const entryNumber = await this.nextEntryNumber(transaction, communityId);
      const posted = await transaction.journalEntry.update({
        where: { id: entry.id },
        data: {
          entryNumber,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedById: actorUserId,
        },
        include: {
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: { account: true },
          },
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'JOURNAL_ENTRY_POSTED',
        'JournalEntry',
        entry.id,
        `Asiento contable N.º ${entryNumber} contabilizado`,
        posted,
      );
      return posted;
    });
  }

  async reverseEntry(
    communityId: string,
    actorUserId: string,
    entryId: string,
    input: ReverseJournalEntryDto,
  ) {
    const reversalDate = new Date(input.entryDate);
    return this.prisma.$transaction(async (transaction) => {
      const original = await transaction.journalEntry.findFirst({
        where: { id: entryId, communityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } }, reversal: true },
      });
      if (!original) {
        throw new NotFoundException(
          'El asiento no pertenece a la comunidad seleccionada.',
        );
      }
      if (original.status !== JournalEntryStatus.POSTED || original.reversal) {
        throw new ConflictException(
          'El asiento no está disponible para reverso.',
        );
      }
      const period = await this.requireOpenPeriod(
        transaction,
        communityId,
        input.accountingPeriodId,
        reversalDate,
      );
      const entryNumber = await this.nextEntryNumber(transaction, communityId);
      const reversal = await transaction.journalEntry.create({
        data: {
          communityId,
          accountingPeriodId: period.id,
          entryNumber,
          entryDate: reversalDate,
          description: `Reverso: ${input.reason.trim()}`,
          source: original.source,
          sourceId: original.sourceId,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
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
        include: {
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: { account: true },
          },
        },
      });
      await transaction.journalEntry.update({
        where: { id: original.id },
        data: {
          status: JournalEntryStatus.REVERSED,
          reversedAt: new Date(),
          reversedById: actorUserId,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'JOURNAL_ENTRY_REVERSED',
        'JournalEntry',
        original.id,
        `Asiento reversado mediante N.º ${entryNumber}`,
        { reason: input.reason.trim(), reversal },
      );
      return reversal;
    });
  }

  async closePeriod(
    communityId: string,
    actorUserId: string,
    periodId: string,
  ) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, communityId },
    });
    if (!period) {
      throw new NotFoundException(
        'El período no pertenece a la comunidad seleccionada.',
      );
    }
    if (period.status !== AccountingPeriodStatus.OPEN) {
      throw new ConflictException('El período contable ya no está abierto.');
    }
    const drafts = await this.prisma.journalEntry.count({
      where: {
        communityId,
        accountingPeriodId: period.id,
        status: JournalEntryStatus.DRAFT,
      },
    });
    if (drafts) {
      throw new ConflictException(
        'No se puede cerrar un período con asientos en borrador.',
      );
    }
    const closed = await this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: { status: AccountingPeriodStatus.CLOSED, closedAt: new Date() },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'ACCOUNTING_PERIOD_CLOSED',
      'AccountingPeriod',
      period.id,
      'Período contable cerrado',
      closed,
    );
    return closed;
  }

  private async requireOpenPeriod(
    client: PrismaService | TransactionClient,
    communityId: string,
    periodId: string,
    entryDate: Date,
  ) {
    const period = await client.accountingPeriod.findFirst({
      where: { id: periodId, communityId },
    });
    if (!period) {
      throw new NotFoundException(
        'El período contable no pertenece a la comunidad seleccionada.',
      );
    }
    this.assertPeriodOpenForDate(period, entryDate);
    return period;
  }

  private assertPeriodOpenForDate(
    period: {
      status: AccountingPeriodStatus;
      startsOn: Date;
      endsOn: Date;
    },
    entryDate: Date,
  ) {
    if (period.status !== AccountingPeriodStatus.OPEN) {
      throw new ConflictException(
        'El período contable no se encuentra abierto.',
      );
    }
    if (entryDate < period.startsOn || entryDate > period.endsOn) {
      throw new ConflictException(
        'La fecha del asiento está fuera del período contable.',
      );
    }
  }

  private async requireAccounts(
    communityId: string,
    lines: Array<{ accountId: string }>,
    client: PrismaService | TransactionClient = this.prisma,
  ) {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await client.ledgerAccount.findMany({
      where: {
        id: { in: accountIds },
        communityId,
        status: RecordStatus.ACTIVE,
        acceptsEntries: true,
        children: { none: {} },
      },
    });
    if (accounts.length !== accountIds.length) {
      throw new NotFoundException(
        'Una o más cuentas no pertenecen a la comunidad o no aceptan movimientos.',
      );
    }
  }

  async getAccountLedger(
    communityId: string,
    accountId: string,
    periodId?: string,
  ) {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id: accountId, communityId },
      include: { parent: true },
    });
    if (!account) {
      throw new NotFoundException('La cuenta contable no fue encontrada.');
    }

    const hierarchy = await this.prisma.ledgerAccount.findMany({
      where: { communityId },
      select: { id: true, parentId: true },
    });
    const childIdsByParentId = new Map<string, string[]>();
    for (const item of hierarchy) {
      if (item.parentId) {
        childIdsByParentId.set(item.parentId, [
          ...(childIdsByParentId.get(item.parentId) ?? []),
          item.id,
        ]);
      }
    }
    const descendantIds = (parentId: string): string[] =>
      (childIdsByParentId.get(parentId) ?? []).flatMap((childId) => [
        childId,
        ...descendantIds(childId),
      ]);
    const childAccountIds = descendantIds(account.id);
    // Una agrupadora no tiene movimientos propios: su mayor consolida sus hijas.
    const accountIds = childAccountIds.length > 0 ? childAccountIds : [account.id];

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: { in: accountIds },
        journalEntry: {
          communityId,
          status: 'POSTED',
          ...(periodId ? { accountingPeriodId: periodId } : {}),
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { lineNumber: 'asc' }],
      include: {
        journalEntry: {
          include: { accountingPeriod: true },
        },
      },
    });

    let runningBalance = 0;
    const isDebitNormal = account.normalBalance === 'DEBIT';

    const history = lines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      if (isDebitNormal) {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }
      return {
        id: line.id,
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate,
        source: line.journalEntry.source,
        description: line.description || line.journalEntry.description,
        debit,
        credit,
        runningBalance,
      };
    });

    return {
      account,
      accountIds,
      history,
      currentBalance: runningBalance,
    };
  }

  async getTrialBalance(communityId: string, periodId?: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { communityId, status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    });

    const lines = await this.prisma.journalLine.findMany({
      where: {
        journalEntry: {
          communityId,
          status: 'POSTED',
          ...(periodId ? { accountingPeriodId: periodId } : {}),
        },
      },
      select: {
        accountId: true,
        debit: true,
        credit: true,
      },
    });

    const totalsByAccount: Record<string, { debit: number; credit: number }> = {};
    for (const line of lines) {
      if (!totalsByAccount[line.accountId]) {
        totalsByAccount[line.accountId] = { debit: 0, credit: 0 };
      }
      totalsByAccount[line.accountId].debit += Number(line.debit);
      totalsByAccount[line.accountId].credit += Number(line.credit);
    }

    const childrenByParentId = new Map<string, string[]>();
    for (const account of accounts) {
      if (account.parentId) {
        childrenByParentId.set(account.parentId, [
          ...(childrenByParentId.get(account.parentId) ?? []),
          account.id,
        ]);
      }
    }

    const aggregateTotals = (accountId: string): { debit: number; credit: number } => {
      const childIds = childrenByParentId.get(accountId) ?? [];
      if (childIds.length === 0) {
        return totalsByAccount[accountId] ?? { debit: 0, credit: 0 };
      }
      return childIds.reduce(
        (total, childId) => {
          const child = aggregateTotals(childId);
          return { debit: total.debit + child.debit, credit: total.credit + child.credit };
        },
        { debit: 0, credit: 0 },
      );
    };

    let totalDebit = 0;
    let totalCredit = 0;

    const rows = accounts.map((account) => {
      const initial = 0;
      // Las cuentas agrupadoras representan exclusivamente la suma de sus hijas.
      const { debit, credit } = aggregateTotals(account.id);
      const isDebitNormal = account.normalBalance === 'DEBIT';
      const finalBalance = isDebitNormal
        ? initial + debit - credit
        : initial + credit - debit;

      if (account.acceptsEntries) {
        totalDebit += debit;
        totalCredit += credit;
      }

      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        acceptsEntries: account.acceptsEntries,
        initialBalance: initial,
        debit,
        credit,
        finalBalance,
      };
    });

    return {
      rows,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
      },
    };
  }

  async getIncomeStatement(communityId: string, periodId?: string) {
    const trialBalance = await this.getTrialBalance(communityId, periodId);
    const incomeRows = trialBalance.rows.filter((r) => r.type === 'INCOME');
    const expenseRows = trialBalance.rows.filter((r) => r.type === 'EXPENSE');

    const totalIncome = incomeRows.reduce((sum, r) => sum + r.finalBalance, 0);
    const totalExpenses = expenseRows.reduce((sum, r) => sum + r.finalBalance, 0);
    const netResult = totalIncome - totalExpenses;

    return {
      incomeRows,
      expenseRows,
      totalIncome,
      totalExpenses,
      netResult,
      isSurplus: netResult >= 0,
    };
  }

  async getBalanceSheet(communityId: string, periodId?: string) {
    const trialBalance = await this.getTrialBalance(communityId, periodId);
    const assetRows = trialBalance.rows.filter((r) => r.type === 'ASSET');
    const liabilityRows = trialBalance.rows.filter((r) => r.type === 'LIABILITY');
    const equityRows = trialBalance.rows.filter((r) => r.type === 'EQUITY');

    const totalAssets = assetRows.reduce((sum, r) => sum + r.finalBalance, 0);
    const totalLiabilities = liabilityRows.reduce((sum, r) => sum + r.finalBalance, 0);
    const totalEquity = equityRows.reduce((sum, r) => sum + r.finalBalance, 0);

    const incomeStatement = await this.getIncomeStatement(communityId, periodId);
    const totalEquityAndLiabilities =
      totalLiabilities + totalEquity + incomeStatement.netResult;

    return {
      assetRows,
      liabilityRows,
      equityRows,
      totalAssets,
      totalLiabilities,
      totalEquity,
      periodNetResult: incomeStatement.netResult,
      totalEquityAndLiabilities,
      isBalanced: Math.abs(totalAssets - totalEquityAndLiabilities) < 0.05,
    };
  }

  private assertBalanced(
    lines: Array<{
      debit: number | Prisma.Decimal;
      credit: number | Prisma.Decimal;
    }>,
  ) {
    if (lines.length < 2) {
      throw new ConflictException(
        'Un asiento debe contener al menos dos líneas.',
      );
    }
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const line of lines) {
      const lineDebit = new Prisma.Decimal(line.debit);
      const lineCredit = new Prisma.Decimal(line.credit);
      const hasDebit = lineDebit.greaterThan(0);
      const hasCredit = lineCredit.greaterThan(0);
      if (hasDebit === hasCredit) {
        throw new ConflictException(
          'Cada línea debe tener un débito o un crédito, nunca ambos.',
        );
      }
      debit = debit.add(lineDebit);
      credit = credit.add(lineCredit);
    }
    if (debit.lessThanOrEqualTo(0) || !debit.equals(credit)) {
      throw new ConflictException(
        'El asiento no está balanceado: los débitos deben igualar los créditos.',
      );
    }
  }

  private normalBalanceFor(type: LedgerAccountType) {
    return type === LedgerAccountType.ASSET ||
      type === LedgerAccountType.EXPENSE
      ? NormalBalance.DEBIT
      : NormalBalance.CREDIT;
  }

  private async nextEntryNumber(
    transaction: TransactionClient,
    communityId: string,
  ) {
    await transaction.communityAccountingSettings.upsert({
      where: { communityId },
      create: { communityId },
      update: {},
    });
    const sequence = await transaction.communityAccountingSettings.update({
      where: { communityId },
      data: { nextJournalNumber: { increment: 1 } },
    });
    return sequence.nextJournalNumber - 1;
  }

  private audit(
    client: PrismaService | TransactionClient,
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
