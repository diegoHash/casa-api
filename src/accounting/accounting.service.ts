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
      });
      if (!parent) {
        throw new NotFoundException(
          'La cuenta padre no pertenece a la comunidad seleccionada.',
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
    const account = await this.prisma.ledgerAccount.create({
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
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'LEDGER_ACCOUNT_CREATED',
      'LedgerAccount',
      account.id,
      'Cuenta contable creada',
      account,
    );
    return account;
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
          throw new ConflictException('Una cuenta no puede ser su propio padre.');
        }
        const parent = await this.prisma.ledgerAccount.findFirst({
          where: { id: input.parentId, communityId },
        });
        if (!parent) {
          throw new NotFoundException(
            'La cuenta padre no pertenece a la comunidad seleccionada.',
          );
        }
      }
      data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
    }

    if (input.acceptsEntries !== undefined) {
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
        const effectiveCurrency = input.currency !== undefined ? input.currency : account.currency;
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

    const updatedAccount = await this.prisma.ledgerAccount.update({
      where: { id },
      data,
      include: { bankAccount: true },
    });

    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'LEDGER_ACCOUNT_UPDATED',
      'LedgerAccount',
      updatedAccount.id,
      'Cuenta contable actualizada',
      updatedAccount,
    );

    return updatedAccount;
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
    const startsOn = new Date(Date.UTC(year, month - 1, 1));
    const endsOn = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
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
    lines: CreateJournalLineDto[],
  ) {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        id: { in: accountIds },
        communityId,
        status: RecordStatus.ACTIVE,
        acceptsEntries: true,
      },
    });
    if (accounts.length !== accountIds.length) {
      throw new NotFoundException(
        'Una o más cuentas no pertenecen a la comunidad o no aceptan movimientos.',
      );
    }
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
