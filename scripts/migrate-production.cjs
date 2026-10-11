const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Prisma, PrismaClient } = require('@prisma/client');
const { loadProductionSecrets } = require('../dist/config/aws-secrets');

const legacyRetirementMigration = '20260809040000_retire_owner_payment_legacy';
const legacyPaymentColumns = [
  'chargeNoticeAllocationId',
  'receiptAccountId',
  'receivableAccountId',
  'advanceAccountId',
  'journalEntryId',
  'receiptNumber',
  'amount',
  'currency',
  'amountVes',
  'appliedToNoticeVes',
  'advanceVes',
];

async function guardLegacyPaymentRetirement() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const tables = await prisma.$queryRaw`
      SELECT TABLE_NAME AS tableName
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('_prisma_migrations', 'OwnerPayment')
    `;
    const tableNames = new Set(tables.map((table) => table.tableName));

    if (!tableNames.has('OwnerPayment')) return;

    if (tableNames.has('_prisma_migrations')) {
      const applied = await prisma.$queryRaw`
        SELECT COUNT(*) AS appliedCount
        FROM _prisma_migrations
        WHERE migration_name = ${legacyRetirementMigration}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      `;
      if (Number(applied[0].appliedCount) > 0) return;
    }

    const legacyColumns = await prisma.$queryRaw`
      SELECT COLUMN_NAME AS columnName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'OwnerPayment'
        AND COLUMN_NAME IN (${Prisma.join(legacyPaymentColumns)})
    `;
    if (legacyColumns.length === 0) return;

    const [{ rowCount }] = await prisma.$queryRaw`
      SELECT COUNT(*) AS rowCount FROM OwnerPayment
    `;
    if (Number(rowCount) > 0) {
      throw new Error(
        `Deployment stopped: ${legacyRetirementMigration} drops legacy payment columns, and OwnerPayment has ${rowCount} rows. Run scripts/verify-owner-payment-legacy-retirement.sql and approve a data-preserving migration before deploying.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Set NODE_ENV=production to run production migrations.');
  }

  await loadProductionSecrets();
  await guardLegacyPaymentRetirement();

  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit' },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
