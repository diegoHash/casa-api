const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const entries = await Promise.all(
    [
      ['communities', prisma.community.count()],
      ['people', prisma.person.count()],
      ['properties', prisma.property.count()],
      ['ownerships', prisma.ownership.count()],
      ['boardAppointments', prisma.boardAppointment.count()],
      ['bankAccounts', prisma.bankAccount.count()],
      ['paymentMethods', prisma.paymentMethod.count()],
      ['concessions', prisma.concession.count()],
      ['auditEvents', prisma.auditEvent.count()],
    ].map(async ([name, request]) => [name, await request]),
  );
  const database = await prisma.$queryRawUnsafe(
    'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()',
  );
  process.stdout.write(
    `${JSON.stringify({ counts: Object.fromEntries(entries), database })}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
