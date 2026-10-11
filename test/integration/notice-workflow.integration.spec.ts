import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma, ExpenseAllocationMethod } from '@prisma/client';
import { BillingService } from '../../src/billing/billing.service';
import { OwnerServiceService } from '../../src/owner-service/owner-service.service';

const prisma = new PrismaClient();
const d = (value: number | string) => new Prisma.Decimal(value);
afterAll(() => prisma.$disconnect());

describe('notice preparation, issuance and owner reception', () => {
  for (const method of ['FIXED', 'ALIQUOT'] as ExpenseAllocationMethod[]) {
    it(`publishes an extraordinary ${method} fee to every allocated owner`, async () => {
      const url = new URL(process.env.DATABASE_URL ?? '');
      expect(process.env.NODE_ENV).toBe('test');
      expect(url.hostname).toBe('localhost');
      expect(url.port).toBe('3308');
      expect(url.pathname).toBe('/casa_test');
      const rollback = new Error('rollback workflow fixture');
      try {
        await prisma.$transaction(
          async (tx) => {
            const suffix = `${Date.now().toString(36)}-${method}`;
            const client = await tx.client.create({
              data: {
                name: 'Workflow test',
                legalName: 'Workflow test',
                rif: `J-${suffix}`,
                contactName: 'Test',
                contactEmail: 'test@example.test',
                contactPhone: '000',
              },
            });
            const community = await tx.community.create({
              data: {
                clientId: client.id,
                name: 'Test',
                legalName: 'Test',
                rif: `C-${suffix}`,
                phone: '000',
                email: 'test@example.test',
                address: 'Test',
                state: 'Test',
                city: 'Test',
                postalCode: '000',
                status: 'ACTIVE',
                administrationMode: 'INTERNAL',
              },
            });
            const ownerIds: string[] = [];
            const propertyIds: string[] = [];
            for (const [index, aliquot] of [0.5, 29.5, 70].entries()) {
              const property = await tx.property.create({
                data: {
                  communityId: community.id,
                  code: `A-${index}`,
                  kind: 'APARTMENT',
                  currentAliquot: d(aliquot),
                  status: 'ACTIVE',
                },
              });
              const person = await tx.person.create({
                data: {
                  firstName: 'Owner',
                  lastName: String(index),
                  documentType: 'V',
                  documentNumber: `${suffix}-${index}`,
                  email: `owner-${suffix}-${index}@example.test`,
                },
              });
              const user = await tx.appUser.create({
                data: {
                  personId: person.id,
                  email: person.email!,
                  passwordHash: 'unused-test-password',
                  status: 'ACTIVE',
                },
              });
              await tx.ownership.create({
                data: {
                  communityId: community.id,
                  propertyId: property.id,
                  personId: person.id,
                  ownershipPercentage: d(100),
                  startsOn: new Date('2020-01-01'),
                },
              });
              ownerIds.push(user.id);
              propertyIds.push(property.id);
            }
            const receivable = await tx.ledgerAccount.create({
              data: {
                communityId: community.id,
                code: 'AR',
                name: 'Receivable',
                type: 'ASSET',
                normalBalance: 'DEBIT',
              },
            });
            const income = await tx.ledgerAccount.create({
              data: {
                communityId: community.id,
                code: 'IN',
                name: 'Income',
                type: 'INCOME',
                normalBalance: 'CREDIT',
              },
            });
            const period = await tx.billingPeriod.create({
              data: {
                communityId: community.id,
                periodKey: '2026-09',
                label: 'September',
                startsOn: new Date('2026-09-01'),
                endsOn: new Date('2026-09-30'),
                bcvRate: d(100),
              },
            });
            // Reuse the real transaction so every fixture is rolled back, even on failure.
            const transactionalPrisma = new Proxy(tx, {
              get(target, key, receiver) {
                return key === '$transaction'
                  ? (operation: (transaction: typeof tx) => Promise<unknown>) =>
                      operation(tx)
                  : (Reflect.get(target, key, receiver) as unknown);
              },
            });
            const billing = new BillingService(transactionalPrisma as never);
            const ownerService = new OwnerServiceService(
              transactionalPrisma as never,
              {} as never,
              {} as never,
            );
            const prepared = await billing.prepareChargeNotice(
              community.id,
              ownerIds[0],
              period.id,
              {
                receivableAccountId: receivable.id,
                billingIncomeAccountId: income.id,
                components: [
                  {
                    type: 'EXTRA_FEE',
                    label: 'Extraordinary repair',
                    amount: 100.01,
                    currency: 'USD',
                    allocationMethod: method,
                  },
                ],
              },
            );
            expect(prepared.allocations).toHaveLength(3);
            expect(
              prepared.allocations
                .reduce((sum, row) => sum.add(row.totalUsd), d(0))
                .toFixed(2),
            ).toBe('100.01');
            expect(
              prepared.allocations
                .reduce((sum, row) => sum.add(row.totalVes), d(0))
                .toFixed(2),
            ).toBe('10001.00');
            const expected =
              method === 'FIXED'
                ? ['3333.67', '3333.67', '3333.66']
                : ['50.01', '2950.30', '7000.69'];
            expect(
              prepared.allocations.map((row) =>
                row.componentShareVes.toFixed(2),
              ),
            ).toEqual(expected);
            for (const ownerId of ownerIds) {
              expect(
                (
                  await ownerService.getOwnerPortalOverview(
                    community.id,
                    ownerId,
                  )
                ).notices,
              ).toHaveLength(0);
            }
            await billing.issueChargeNotice(
              community.id,
              ownerIds[0],
              prepared.id,
            );
            await expect(
              billing.issueChargeNotice(community.id, ownerIds[0], prepared.id),
            ).rejects.toThrow('previamente preparado');
            for (const [index, ownerId] of ownerIds.entries()) {
              const overview = await ownerService.getOwnerPortalOverview(
                community.id,
                ownerId,
              );
              expect(overview.property.id).toBe(propertyIds[index]);
              expect(overview.notices).toHaveLength(1);
              expect(overview.notices[0].allocation?.componentShareVes).toBe(
                Number(expected[index]),
              );
              expect(overview.notices[0].components[0].allocationMethod).toBe(
                method,
              );
              expect(overview.notices[0].components[0].propertyAmountVes).toBe(
                Number(expected[index]),
              );
              expect(overview.notices[0].components[0].propertyAmountUsd).toBe(
                Number(prepared.allocations[index].totalUsd),
              );
              expect(overview.notices[0].allocation?.outstandingUsd).toBe(
                Number(prepared.allocations[index].totalUsd),
              );
            }
            await expect(
              ownerService.getOwnerPortalOverview(
                'another-community',
                ownerIds[0],
              ),
            ).rejects.toThrow('propietario activo');
            const journal = await tx.journalEntry.findFirstOrThrow({
              where: { communityId: community.id, sourceId: prepared.id },
              include: { lines: true },
            });
            expect(
              journal.lines
                .reduce(
                  (sum, line) => sum.add(line.debit).sub(line.credit),
                  d(0),
                )
                .toFixed(2),
            ).toBe('0.00');
            throw rollback;
          },
          { timeout: 60000 },
        );
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }, 90000);
  }
});
