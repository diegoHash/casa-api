import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessStatus, PlatformRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from './password.service';

@Injectable()
export class RootBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(RootBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async onModuleInit() {
    const email = this.config
      .getOrThrow<string>('ROOT_BOOTSTRAP_EMAIL')
      .trim()
      .toLowerCase();
    const existing = await this.prisma.appUser.findUnique({ where: { email } });
    if (existing) {
      if (existing.platformRole !== PlatformRole.ROOT) {
        throw new Error(
          `El correo bootstrap ${email} ya pertenece a un usuario que no es root.`,
        );
      }
      if (existing.status !== AccessStatus.ACTIVE) {
        this.logger.warn(
          `El usuario root ${email} existe, pero su estado no es ACTIVE.`,
        );
      }
      return;
    }

    const passwordHash = await this.passwords.hash(
      this.config.getOrThrow<string>('ROOT_BOOTSTRAP_PASSWORD'),
    );
    const requestId = randomUUID();
    await this.prisma.$transaction(async (transaction) => {
      const root = await transaction.appUser.create({
        data: {
          email,
          passwordHash,
          platformRole: PlatformRole.ROOT,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: root.id,
          requestId,
          action: 'ROOT_BOOTSTRAPPED',
          entityType: 'AppUser',
          entityId: root.id,
          detail: 'Usuario root inicial creado',
          reason: 'Inicialización segura de CASA API',
          after: { email, platformRole: PlatformRole.ROOT },
        },
      });
    });
    this.logger.log(`Usuario root inicial creado: ${email}`);
  }
}
