require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const baseUrl = 'http://localhost:3001/v1';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function main() {
  const startedAt = new Date();
  const community = await prisma.community.findFirstOrThrow();
  const temporaryCode = `VERIFY-${Date.now()}`;
  let temporaryConcessionId = null;
  let login = null;

  try {
    login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: process.env.ROOT_BOOTSTRAP_EMAIL,
        password: process.env.ROOT_BOOTSTRAP_PASSWORD,
      }),
    });
    const context = await request('/auth/select-context', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({ communityId: community.id }),
    });
    const authorization = {
      Authorization: `Bearer ${context.accessToken}`,
    };

    const savedCommunity = await request('/core/community', {
      method: 'PATCH',
      headers: authorization,
      body: JSON.stringify({
        name: community.name,
        legalName: community.legalName,
        rif: community.rif,
        phone: community.phone,
        email: community.email,
        address: community.address,
        state: community.state,
        city: community.city,
        postalCode: community.postalCode,
        administrationMode: community.administrationMode,
        administratorName: community.administratorName ?? undefined,
        administratorRif: community.administratorRif ?? undefined,
      }),
    });
    if (
      savedCommunity.id !== community.id ||
      savedCommunity.rif !== community.rif
    ) {
      throw new Error('La configuración de comunidad no se guardó correctamente.');
    }

    const created = await request('/core/concessions', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({
        code: temporaryCode,
        name: 'Concesión temporal de verificación',
        holderName: 'CASA QA',
        holderDocument: 'J-00000000-0',
        locationDescription: 'Registro temporal',
        monthlyAmount: 1,
        currency: 'USD',
        startsOn: '2026-08-01',
      }),
    });
    temporaryConcessionId = created.id;

    const updated = await request(`/core/concessions/${created.id}`, {
      method: 'PATCH',
      headers: authorization,
      body: JSON.stringify({
        name: 'Concesión temporal actualizada',
        monthlyAmount: 2,
      }),
    });
    if (
      updated.name !== 'Concesión temporal actualizada' ||
      Number(updated.monthlyAmount) !== 2
    ) {
      throw new Error('La edición de concesión no persistió correctamente.');
    }

    const snapshot = await request('/core/snapshot', {
      headers: authorization,
    });
    if (!snapshot.concessions.some((item) => item.id === created.id)) {
      throw new Error('La concesión no aparece en el snapshot de la comunidad.');
    }

    process.stdout.write(
      `${JSON.stringify({
        communitySettings: 'ok',
        concessionCreate: 'ok',
        concessionUpdate: 'ok',
        concessionSnapshot: 'ok',
      })}\n`,
    );
  } finally {
    if (temporaryConcessionId) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'Concession', entityId: temporaryConcessionId },
      });
      await prisma.concession.deleteMany({
        where: { id: temporaryConcessionId },
      });
    }
    await prisma.auditEvent.deleteMany({
      where: {
        communityId: community.id,
        entityType: 'Community',
        entityId: community.id,
        action: 'COMMUNITY_UPDATED',
        createdAt: { gte: startedAt },
      },
    });
    if (login?.refreshToken) {
      await request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: login.refreshToken }),
      }).catch(() => undefined);
    }
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
