const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes, randomUUID, scrypt } = require('node:crypto');
const { PrismaClient, PlatformRole, AccessStatus } = require('@prisma/client');

const root = resolve(__dirname, '..');
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

function derive(password, salt) {
  return new Promise((resolveKey, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolveKey(key);
    });
  });
}

async function main() {
  const email = process.env.ROOT_BOOTSTRAP_EMAIL.trim().toLowerCase();
  const password = process.env.ROOT_BOOTSTRAP_PASSWORD;
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  const passwordHash = ['scrypt', 32768, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.$transaction(async (tx) => {
      const rootUser = await tx.appUser.upsert({
        where: { email },
        create: { email, passwordHash, platformRole: PlatformRole.ROOT, status: AccessStatus.ACTIVE, passwordSetAt: new Date() },
        update: { passwordHash, platformRole: PlatformRole.ROOT, status: AccessStatus.ACTIVE, passwordSetAt: new Date(), tokenVersion: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: rootUser.id,
          requestId: randomUUID(),
          action: 'ROOT_BOOTSTRAPPED',
          entityType: 'AppUser',
          entityId: rootUser.id,
          detail: 'Usuario root restaurado después de reinicialización local',
          reason: 'Restauración solicitada por administrador',
          after: { email, platformRole: PlatformRole.ROOT },
        },
      });
      return rootUser;
    });
    console.log(`Root active: ${user.email} (${user.platformRole})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
