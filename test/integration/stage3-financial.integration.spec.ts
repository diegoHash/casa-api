import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma, RecordStatus, PropertyKind, OwnerPaymentStatus, ChargeNoticeStatus, CommunityStatus, AdministrationMode, AccessStatus, LedgerAccountType, NormalBalance } from '@prisma/client';
import { BillingService } from '../../src/billing/billing.service';
import { AccountingService } from '../../src/accounting/accounting.service';
import type { AuthPrincipal } from '../../src/auth/auth.types';

const prisma = new PrismaClient();
const d = (value: string | number) => new Prisma.Decimal(value);

async function clean() {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  await prisma.paymentApplication.deleteMany();
  await prisma.ownerPayment.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.chargeNotice.updateMany({ data: { journalEntryId: null } });
  await prisma.periodExpense.updateMany({ data: { journalEntryId: null } });
  await prisma.chargeNotice.updateMany({ data: { receivableAccountId: null, billingIncomeAccountId: null } });
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.updateMany({ data: { reversalOfId: null } });
  await prisma.journalEntry.deleteMany();
  await prisma.periodExpense.deleteMany();
  await prisma.accountingPeriod.deleteMany();
  await prisma.communityAccountingSettings.deleteMany();
  await prisma.chargeNoticeAllocation.deleteMany();
  await prisma.chargeNotice.deleteMany();
  await prisma.ledgerAccount.updateMany({ data: { parentId: null } });
  await prisma.ledgerAccount.deleteMany();
  await prisma.billingPeriod.deleteMany();
  await prisma.communityAccess.deleteMany();
  await prisma.appUser.deleteMany();
  await prisma.property.deleteMany();
  await prisma.community.deleteMany();
  await prisma.client.deleteMany();
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

async function fixture() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const client = await prisma.client.create({ data: { name: 'Integration', legalName: 'Integration LLC', rif: `J-${suffix}`, contactName: 'Tester', contactEmail: `test-${suffix}@example.test`, contactPhone: '000' } });
  const community = await prisma.community.create({ data: { clientId: client.id, name: 'Community', legalName: 'Community LLC', rif: `C-${suffix}`, phone: '000', email: `community-${suffix}@example.test`, address: 'Test', state: 'Test', city: 'Test', postalCode: '0000', status: CommunityStatus.ACTIVE, administrationMode: AdministrationMode.INTERNAL } });
  const property = await prisma.property.create({ data: { communityId: community.id, code: 'A-01', kind: PropertyKind.APARTMENT, currentAliquot: d(100), status: RecordStatus.ACTIVE } });
  const user = await prisma.appUser.create({ data: { email: `admin-${suffix}@example.test`, passwordHash: 'test', status: AccessStatus.ACTIVE } });
  await prisma.communityAccess.create({ data: { userId: user.id, communityId: community.id, roleCode: 'ADMIN', scopes: ['billing.payments.reconcile'], status: AccessStatus.ACTIVE, startsOn: new Date('2020-01-01') } });
  const auth: AuthPrincipal = { userId: user.id, email: user.email, platformRole: null, tokenVersion: 0, communityId: community.id, communityRole: 'ADMIN', scopes: ['billing.payments.reconcile'], workspaces: [] };
  return { community, property, user, auth, service: new BillingService(prisma as never) };
}

async function issuedAllocation(communityId: string, propertyId: string, amount: string, order: number) {
  const period = await prisma.billingPeriod.create({ data: { communityId, periodKey: `2026-${String(order).padStart(2, '0')}`, label: `Period ${order}`, startsOn: new Date(`2026-${String(order).padStart(2, '0')}-01`), endsOn: new Date(`2026-${String(order).padStart(2, '0')}-28`), bcvRate: d(1), status: 'ISSUED' } });
  const notice = await prisma.chargeNotice.create({ data: { communityId, billingPeriodId: period.id, status: ChargeNoticeStatus.ISSUED, totalExpensesVes: d(amount), totalComponentsVes: d(0), totalCommunityVes: d(amount), totalCommunityUsd: d(amount), createdById: 'integration', issuedAt: new Date(`2026-${String(order).padStart(2, '0')}-01`) } });
  return prisma.chargeNoticeAllocation.create({ data: { chargeNoticeId: notice.id, propertyId, aliquotSnapshot: d(100), expenseShareVes: d(amount), componentShareVes: d(0), totalVes: d(amount), totalUsd: d(amount) } });
}

async function preparedNotice(f: Awaited<ReturnType<typeof fixture>>, amount: string, order: number) {
  const receivable = await prisma.ledgerAccount.create({ data: { communityId: f.community.id, code: `AR-${order}`, name: 'Receivable', type: LedgerAccountType.ASSET, normalBalance: NormalBalance.DEBIT } });
  const income = await prisma.ledgerAccount.create({ data: { communityId: f.community.id, code: `IN-${order}`, name: 'Income', type: LedgerAccountType.INCOME, normalBalance: NormalBalance.CREDIT } });
  const period = await prisma.billingPeriod.create({ data: { communityId: f.community.id, periodKey: `2027-${String(order).padStart(2, '0')}`, label: `Issue ${order}`, startsOn: new Date(`2027-${String(order).padStart(2, '0')}-01`), endsOn: new Date(`2027-${String(order).padStart(2, '0')}-28`), bcvRate: d(1) } });
  const notice = await prisma.chargeNotice.create({ data: { communityId: f.community.id, billingPeriodId: period.id, status: ChargeNoticeStatus.PREPARED, totalExpensesVes: d(amount), totalComponentsVes: d(0), totalCommunityVes: d(amount), totalCommunityUsd: d(amount), createdById: f.user.id, preparedAt: new Date(), receivableAccountId: receivable.id, billingIncomeAccountId: income.id, allocations: { create: { propertyId: f.property.id, aliquotSnapshot: d(100), expenseShareVes: d(amount), componentShareVes: d(0), totalVes: d(amount), totalUsd: d(amount) } } } });
  return notice;
}

async function issuedNotice(f: Awaited<ReturnType<typeof fixture>>, amount: string, order: number) {
  const notice = await preparedNotice(f, amount, order);
  await f.service.issueChargeNotice(f.community.id, f.user.id, notice.id);
  return prisma.chargeNotice.findUniqueOrThrow({
    where: { id: notice.id },
    include: { journalEntry: { include: { lines: { orderBy: { lineNumber: 'asc' } } } } },
  });
}

function entryTotals(lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[]) {
  return lines.reduce(
    (total, line) => ({ debit: total.debit.plus(line.debit), credit: total.credit.plus(line.credit) }),
    { debit: d(0), credit: d(0) },
  );
}

async function reportedPayment(communityId: string, propertyId: string, userId: string, amount: string) {
  return prisma.ownerPayment.create({ data: { communityId, propertyId, exchangeRate: d(1), originalAmount: d(amount), originalCurrency: 'USD', functionalAmount: d(amount), functionalCurrency: 'USD', reference: `PAY-${Math.random()}`, paidAt: new Date(), status: OwnerPaymentStatus.REPORTED, createdById: userId, reportedAt: new Date(), reportedById: userId } });
}

async function applied(paymentId: string) {
  const rows = await prisma.paymentApplication.findMany({ where: { ownerPaymentId: paymentId }, orderBy: { createdAt: 'asc' } });
  return rows.reduce((sum, row) => sum.plus(row.functionalAmount), d(0));
}

beforeAll(async () => prisma.$connect());
beforeEach(clean);
afterAll(async () => { await clean(); await prisma.$disconnect(); });

describe('Stage 3 financial integration', () => {
  it('receivables summary uses issued notices and payment applications once, isolated by community', async () => {
    const first = await fixture();
    const accounting = new AccountingService(prisma as never);
    await issuedAllocation(first.community.id, first.property.id, '100', 1);
    await issuedAllocation(first.community.id, first.property.id, '200', 2);
    const payment = await reportedPayment(first.community.id, first.property.id, first.user.id, '150');
    await first.service.reconcileOwnerPayment(first.community.id, first.auth, payment.id);

    const second = await fixture();
    await issuedAllocation(second.community.id, second.property.id, '999', 1);

    const summary = await accounting.receivables(first.community.id);
    expect(summary.totalIssuedUsd).toBe('300.00');
    expect(summary.totalPaidUsd).toBe('150.00');
    expect(summary.totalPendingUsd).toBe('150.00');
    expect(summary.notices).toHaveLength(2);
    expect(summary.notices.reduce((sum, notice) => sum + Number(notice.paidUsd), 0)).toBe(150);
    expect(summary.notices.reduce((sum, notice) => sum + Number(notice.pendingUsd), 0)).toBe(150);
  });

  it('A exact payment persists reconciled, fully applied, and no remainder', async () => {
    const f = await fixture(); await issuedAllocation(f.community.id, f.property.id, '500', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '500');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    expect((await prisma.ownerPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('RECONCILED');
    expect((await applied(payment.id)).toString()).toBe('500');
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('0');
  });

  it('B preserves the excess as derived balance', async () => {
    const f = await fixture(); await issuedAllocation(f.community.id, f.property.id, '500', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '700');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    expect((await applied(payment.id)).toString()).toBe('500');
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('200');
  });

  it('G applies one payment FIFO to multiple issued notices', async () => {
    const f = await fixture();
    await issuedAllocation(f.community.id, f.property.id, '100', 1); await issuedAllocation(f.community.id, f.property.id, '200', 2); await issuedAllocation(f.community.id, f.property.id, '300', 3);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '450');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    expect((await prisma.paymentApplication.findMany({ where: { ownerPaymentId: payment.id }, orderBy: { createdAt: 'asc' } })).map((x) => x.functionalAmount.toString())).toEqual(['100', '200', '150']);
  });

  it('H/I repeated reconciliation after commit never duplicates applications', async () => {
    const f = await fixture(); await issuedAllocation(f.community.id, f.property.id, '500', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '500');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const before = await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } });
    await expect(f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id)).rejects.toThrow();
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(before);
    expect((await applied(payment.id)).toString()).toBe('500');
  });

  it.each([['C', '200', '200', '0'], ['D', '200', '300', '0'], ['E', '200', '120', '80']])('%s consumes reconciled credit when a real prepared notice is issued', async (_case, credit, debt, expectedRemainder) => {
    const f = await fixture();
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, credit);
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const notice = await preparedNotice(f, debt, 1);
    await f.service.issueChargeNotice(f.community.id, f.user.id, notice.id);
    const allocation = await prisma.chargeNoticeAllocation.findFirstOrThrow({ where: { chargeNoticeId: notice.id } });
    const used = await prisma.paymentApplication.aggregate({ where: { chargeNoticeAllocationId: allocation.id }, _sum: { functionalAmount: true } });
    expect((used._sum.functionalAmount ?? d(0)).toString()).toBe(Prisma.Decimal.min(d(credit), d(debt)).toString());
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe(expectedRemainder);
  });

  it('F consumes available payments in reconciliation FIFO order', async () => {
    const f = await fixture();
    const first = await reportedPayment(f.community.id, f.property.id, f.user.id, '50');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, first.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await reportedPayment(f.community.id, f.property.id, f.user.id, '100');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, second.id);
    const notice = await preparedNotice(f, '120', 1);
    await f.service.issueChargeNotice(f.community.id, f.user.id, notice.id);
    const rows = await prisma.paymentApplication.findMany({ where: { chargeNoticeAllocation: { chargeNoticeId: notice.id } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => [row.ownerPaymentId, row.functionalAmount.toString()])).toEqual([[first.id, '50'], [second.id, '70']]);
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('30');
  });

  it('J concurrent reconciliations persist one transition and one application set', async () => {
    const f = await fixture(); await issuedAllocation(f.community.id, f.property.id, '200', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '200');
    const results = await Promise.allSettled([
      f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id),
      f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await prisma.ownerPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('RECONCILED');
    expect((await applied(payment.id)).toString()).toBe('200');
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(1);
  });

  it('K concurrent issued notices cannot consume credit twice', async () => {
    const f = await fixture(); const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '200');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const first = await preparedNotice(f, '150', 1); const second = await preparedNotice(f, '150', 2);
    const results = await Promise.allSettled([
      f.service.issueChargeNotice(f.community.id, f.user.id, first.id),
      f.service.issueChargeNotice(f.community.id, f.user.id, second.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((await applied(payment.id)).lessThanOrEqualTo(d(200))).toBe(true);
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.greaterThanOrEqualTo(d(0))).toBe(true);
  });

  it('manual concurrent applications cannot consume the same credit twice', async () => {
    const f = await fixture();
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '100');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const first = await issuedAllocation(f.community.id, f.property.id, '100', 1);
    const second = await issuedAllocation(f.community.id, f.property.id, '100', 2);
    const results = await Promise.allSettled([
      f.service.createPaymentApplication(f.community.id, f.user.id, { ownerPaymentId: payment.id, chargeNoticeAllocationId: first.id, functionalAmount: 100 }),
      f.service.createPaymentApplication(f.community.id, f.user.id, { ownerPaymentId: payment.id, chargeNoticeAllocationId: second.id, functionalAmount: 100 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await applied(payment.id)).toString()).toBe('100');
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(1);
  });

  it('L rolls back reconciliation and applications after an in-transaction failure', async () => {
    const f = await fixture(); await issuedAllocation(f.community.id, f.property.id, '100', 1); await issuedAllocation(f.community.id, f.property.id, '200', 2);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '300');
    process.env.CASA_TEST_FAILPOINT = 'reconcile-after-application';
    await expect(f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id)).rejects.toThrow('failpoint');
    delete process.env.CASA_TEST_FAILPOINT;
    expect((await prisma.ownerPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REPORTED');
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(0);
  });

  it('M rolls back notice issuance and credit consumption after an in-transaction failure', async () => {
    const f = await fixture(); const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '200');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const notice = await preparedNotice(f, '200', 1);
    process.env.CASA_TEST_FAILPOINT = 'issue-after-application';
    await expect(f.service.issueChargeNotice(f.community.id, f.user.id, notice.id)).rejects.toThrow('failpoint');
    delete process.env.CASA_TEST_FAILPOINT;
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('PREPARED');
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('200');
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(0);
  });

  it.each(['REPORTED', 'REJECTED'] as const)('N/O %s payment cannot be manually applied', async (status) => {
    const f = await fixture(); const allocation = await issuedAllocation(f.community.id, f.property.id, '100', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '100');
    if (status === 'REJECTED') await prisma.ownerPayment.update({ where: { id: payment.id }, data: { status: 'REJECTED' } });
    await expect(f.service.createPaymentApplication(f.community.id, f.user.id, { ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount: 10 })).rejects.toThrow();
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(0);
  });

  it('P void notice rejects a manual application and leaves credit untouched', async () => {
    const f = await fixture(); const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '100');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    const allocation = await issuedAllocation(f.community.id, f.property.id, '100', 1);
    await prisma.chargeNotice.update({ where: { id: allocation.chargeNoticeId }, data: { status: 'VOID' } });
    await expect(f.service.createPaymentApplication(f.community.id, f.user.id, { ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount: 10 })).rejects.toThrow();
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('100');
  });

  it('Q does not transfer credit between properties in one community', async () => {
    const f = await fixture();
    const secondProperty = await prisma.property.create({ data: { communityId: f.community.id, code: 'B-01', kind: PropertyKind.APARTMENT, currentAliquot: d(100), status: RecordStatus.ACTIVE } });
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '500'); await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    await issuedAllocation(f.community.id, secondProperty.id, '300', 1);
    expect((await f.service.ownerPaymentBalance(f.community.id, f.property.id)).availableAmount.toString()).toBe('500');
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(0);
  });

  it('R does not transfer credit across communities', async () => {
    const first = await fixture(); const payment = await reportedPayment(first.community.id, first.property.id, first.user.id, '100'); await first.service.reconcileOwnerPayment(first.community.id, first.auth, payment.id);
    const second = await fixture(); const allocation = await issuedAllocation(second.community.id, second.property.id, '100', 1);
    await expect(first.service.createPaymentApplication(first.community.id, first.user.id, { ownerPaymentId: payment.id, chargeNoticeAllocationId: allocation.id, functionalAmount: 10 })).rejects.toThrow();
    expect(await prisma.paymentApplication.count({ where: { ownerPaymentId: payment.id } })).toBe(0);
  });
});

describe('Stage 4 charge notice accounting reversal integration', () => {
  it('A voids an issued notice with its intact original and one reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    const originalId = notice.journalEntryId!;
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    const persisted = await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } });
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: originalId }, include: { reversal: { include: { lines: true } }, lines: true } });
    expect(persisted.status).toBe('VOID'); expect(original.status).toBe('REVERSED');
    expect(original.reversal?.reversalOfId).toBe(original.id); expect(original.lines).toHaveLength(2);
  });

  it('B repeated void is idempotent without another reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(1);
  });

  it('I retry after a committed void response is lost does not create another reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    // Simulates a client retry after the committed response was not received.
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(1);
  });

  it('C rolls back reversal and VOID status after an in-transaction failure', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    process.env.CASA_TEST_FAILPOINT = 'void-after-reversal';
    await expect(f.service.voidChargeNotice(f.community.id, f.user.id, notice.id)).rejects.toThrow('failpoint');
    delete process.env.CASA_TEST_FAILPOINT;
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('ISSUED');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(0);
    expect(await prisma.journalLine.count({ where: { journalEntry: { reversalOfId: notice.journalEntryId! } } })).toBe(0);
  });

  it('D blocks a void with reconciled money applied before creating a reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    const payment = await reportedPayment(f.community.id, f.property.id, f.user.id, '100');
    await f.service.reconcileOwnerPayment(f.community.id, f.auth, payment.id);
    await expect(f.service.voidChargeNotice(f.community.id, f.user.id, notice.id)).rejects.toThrow();
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('ISSUED');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(0);
  });

  it('E refuses an issued notice without an original journal entry', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    await prisma.chargeNotice.update({ where: { id: notice.id }, data: { journalEntryId: null } });
    await expect(f.service.voidChargeNotice(f.community.id, f.user.id, notice.id)).rejects.toThrow();
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('ISSUED');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(0);
  });

  it('F balances both original and reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: notice.journalEntryId! }, include: { lines: true, reversal: { include: { lines: true } } } });
    const originalTotals = entryTotals(original.lines); const reversalTotals = entryTotals(original.reversal!.lines);
    expect(originalTotals.debit.equals(originalTotals.credit)).toBe(true);
    expect(reversalTotals.debit.equals(reversalTotals.credit)).toBe(true);
  });

  it('G neutralizes every account of the original entry', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    await f.service.voidChargeNotice(f.community.id, f.user.id, notice.id);
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: notice.journalEntryId! }, include: { lines: true, reversal: { include: { lines: true } } } });
    for (const line of original.lines) {
      const reverse = original.reversal!.lines.find((candidate) => candidate.accountId === line.accountId)!;
      expect(line.debit.plus(reverse.debit).minus(line.credit.plus(reverse.credit)).isZero()).toBe(true);
    }
  });

  it('H concurrent void attempts create exactly one reversal', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    const results = await Promise.allSettled([
      f.service.voidChargeNotice(f.community.id, f.user.id, notice.id),
      f.service.voidChargeNotice(f.community.id, f.user.id, notice.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('VOID');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: notice.journalEntryId! } })).toBe(1);
  });

  it('J isolates a reversal to its own notice and community', async () => {
    const first = await fixture(); const firstNotice = await issuedNotice(first, '100', 1);
    const second = await fixture(); const secondNotice = await issuedNotice(second, '200', 1);
    await first.service.voidChargeNotice(first.community.id, first.user.id, firstNotice.id);
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: secondNotice.id } })).status).toBe('ISSUED');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: secondNotice.journalEntryId! } })).toBe(0);
  });

  it('does not alter an issued notice when its original accounting period is closed', async () => {
    const f = await fixture(); const notice = await issuedNotice(f, '100', 1);
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: notice.journalEntryId! } });
    await prisma.accountingPeriod.update({ where: { id: original.accountingPeriodId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await expect(f.service.voidChargeNotice(f.community.id, f.user.id, notice.id)).rejects.toThrow('período contable original no está abierto');
    expect((await prisma.chargeNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe('ISSUED');
    expect(await prisma.journalEntry.count({ where: { reversalOfId: original.id } })).toBe(0);
  });
});
