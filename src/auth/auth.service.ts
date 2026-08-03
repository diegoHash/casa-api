import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessStatus, PlatformRole, Prisma } from '@prisma/client';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthPrincipal, RequestMetadata } from './auth.types';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailService } from './email.service';
import { ResetPasswordDto } from './dto/password-reset.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async requestPasswordReset(
    emailInput: string,
    metadata: RequestMetadata,
  ) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.appUser.findUnique({
      where: { email },
      include: { person: true },
    });
    if (!user || user.status !== AccessStatus.ACTIVE) {
      return { accepted: true };
    }

    const token = randomBytes(32).toString('base64url');
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresInMinutes = 15;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
    const challengeId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.passwordResetChallenge.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetChallenge.create({
        data: {
          id: challengeId,
          userId: user.id,
          tokenHash: this.resetHash(token),
          pinHash: this.resetHash(`${challengeId}:${pin}`),
          expiresAt,
          requestedIp: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: user.id,
          requestId: randomUUID(),
          action: 'PASSWORD_RESET_REQUESTED',
          entityType: 'AppUser',
          entityId: user.id,
          detail: 'Recuperación de contraseña solicitada',
          ...metadata,
        },
      }),
    ]);

    const webUrl = (
      this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    await this.email.sendPasswordReset({
      to: user.email,
      displayName: user.person?.firstName ?? 'usuario CASA',
      pin,
      resetUrl: `${webUrl}/restablecer-clave?token=${encodeURIComponent(token)}`,
      expiresInMinutes,
    });
    return { accepted: true };
  }

  async resetPassword(input: ResetPasswordDto, metadata: RequestMetadata) {
    const now = new Date();
    let challenge;
    if (input.token) {
      challenge = await this.prisma.passwordResetChallenge.findUnique({
        where: { tokenHash: this.resetHash(input.token) },
        include: { user: true },
      });
    } else {
      const user = await this.prisma.appUser.findUnique({
        where: { email: input.email?.trim().toLowerCase() },
      });
      challenge = user
        ? await this.prisma.passwordResetChallenge.findFirst({
            where: {
              userId: user.id,
              usedAt: null,
              expiresAt: { gt: now },
            },
            orderBy: { createdAt: 'desc' },
            include: { user: true },
          })
        : null;
      if (
        challenge &&
        this.resetHash(`${challenge.id}:${input.pin}`) !== challenge.pinHash
      ) {
        await this.prisma.passwordResetChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
        challenge = null;
      }
    }
    if (
      !challenge ||
      challenge.usedAt ||
      challenge.expiresAt <= now ||
      challenge.attempts >= 5
    ) {
      throw new BadRequestException(
        'El enlace o PIN no es válido, ya fue utilizado o está vencido.',
      );
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetChallenge.update({
        where: { id: challenge.id },
        data: { usedAt: now },
      }),
      this.prisma.appUser.update({
        where: { id: challenge.userId },
        data: {
          passwordHash,
          passwordSetAt: now,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: challenge.userId,
          requestId: randomUUID(),
          action: 'PASSWORD_RESET_COMPLETED',
          entityType: 'AppUser',
          entityId: challenge.userId,
          detail: 'Contraseña restablecida y sesiones anteriores revocadas',
          ...metadata,
        },
      }),
    ]);
    return { success: true, requiresLogin: true };
  }

  private resetHash(value: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update(value)
      .digest('hex');
  }

  async login(emailInput: string, password: string, metadata: RequestMetadata) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.appUser.findUnique({
      where: { email },
      include: { person: true },
    });
    if (
      !user ||
      user.status !== AccessStatus.ACTIVE ||
      !(await this.passwords.verify(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    const refresh = this.tokens.issueRefreshToken();
    const loggedInAt = new Date();
    await this.prisma.$transaction([
      this.prisma.authSession.create({
        data: {
          userId: user.id,
          tokenHash: refresh.tokenHash,
          expiresAt: refresh.expiresAt,
          ...metadata,
        },
      }),
      this.prisma.appUser.update({
        where: { id: user.id },
        data: { lastAccessAt: loggedInAt },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: user.id,
          requestId: randomUUID(),
          action: 'AUTH_LOGIN',
          entityType: 'AppUser',
          entityId: user.id,
          detail: 'Inicio de sesión exitoso',
          ...metadata,
        },
      }),
    ]);

    return {
      ...this.tokens.issueAccessToken(this.baseClaims(user)),
      refreshToken: refresh.refreshToken,
      refreshExpiresAt: refresh.expiresAt,
      user: this.publicUser({ ...user, lastAccessAt: loggedInAt }),
    };
  }

  async refresh(
    refreshToken: string,
    communityId: string | undefined,
    metadata: RequestMetadata,
  ) {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== AccessStatus.ACTIVE
    ) {
      throw new UnauthorizedException(
        'La sesión de renovación venció o fue revocada.',
      );
    }

    const context = communityId
      ? await this.resolveCommunityContext(
          session.user.id,
          session.user.platformRole,
          communityId,
        )
      : {};
    const next = this.tokens.issueRefreshToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now, lastUsedAt: now },
      }),
      this.prisma.authSession.create({
        data: {
          userId: session.user.id,
          tokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
          ...metadata,
        },
      }),
    ]);

    return {
      ...this.tokens.issueAccessToken({
        ...this.baseClaims(session.user),
        ...context,
      }),
      refreshToken: next.refreshToken,
      refreshExpiresAt: next.expiresAt,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    await this.prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async logoutAll(auth: AuthPrincipal) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: auth.userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: auth.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: auth.userId,
          requestId: randomUUID(),
          action: 'AUTH_LOGOUT_ALL',
          entityType: 'AppUser',
          entityId: auth.userId,
          detail: 'Cierre de todas las sesiones activas',
        },
      }),
    ]);
    return { success: true };
  }

  async changePassword(
    auth: AuthPrincipal,
    currentPassword: string,
    newPassword: string,
    metadata: RequestMetadata,
  ) {
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, passwordHash: true },
    });
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('La contraseña actual es incorrecta.');
    }
    if (await this.passwords.verify(newPassword, user.passwordHash)) {
      throw new ForbiddenException(
        'La contraseña nueva debe ser diferente de la actual.',
      );
    }

    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: auth.userId },
        data: {
          passwordHash,
          passwordSetAt: now,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: auth.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: auth.userId,
          requestId: randomUUID(),
          action: 'AUTH_PASSWORD_CHANGED',
          entityType: 'AppUser',
          entityId: auth.userId,
          detail: 'Contraseña actualizada y sesiones revocadas',
          ...metadata,
        },
      }),
    ]);
    return { success: true, requiresLogin: true };
  }

  async me(auth: AuthPrincipal) {
    const user = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: auth.userId },
      include: { person: true },
    });
    return {
      user: this.publicUser(user),
      selectedContext: auth.communityId
        ? {
            communityId: auth.communityId,
            roleCode: auth.communityRole,
            scopes: auth.scopes,
            workspaces: auth.workspaces,
          }
        : null,
    };
  }

  async listContexts(auth: AuthPrincipal) {
    if (auth.platformRole === PlatformRole.ROOT) {
      const communities = await this.prisma.community.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          legalName: true,
          rif: true,
          status: true,
          client: { select: { standing: true } },
          activeLicense: { select: { status: true, periodEnd: true } },
        },
      });
      return communities.map((community) => ({
        communityId: community.id,
        name: community.name,
        legalName: community.legalName,
        rif: community.rif,
        status: community.status,
        standing: community.client.standing,
        license: community.activeLicense,
        roleCode: 'ROOT',
        scopes: ['*'],
        workspaces: ['*'],
      }));
    }

    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const access = await this.prisma.communityAccess.findMany({
      where: {
        userId: auth.userId,
        status: AccessStatus.ACTIVE,
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
      },
      orderBy: { community: { name: 'asc' } },
      include: {
        workspaces: {
          where: {
            status: 'ACTIVE',
            startsOn: { lte: now },
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
          },
        },
        community: {
          select: {
            id: true,
            name: true,
            legalName: true,
            rif: true,
            status: true,
          },
        },
      },
    });
    const personId = (
      await this.prisma.appUser.findUnique({
        where: { id: auth.userId },
        select: { personId: true },
      })
    )?.personId;
    const relationships = personId
      ? await this.prisma.$transaction([
          this.prisma.ownership.findMany({
            where: {
              personId,
              status: 'ACTIVE',
              OR: [{ endsOn: null }, { endsOn: { gte: today } }],
            },
            select: { communityId: true },
          }),
          this.prisma.employment.findMany({
            where: {
              personId,
              status: 'ACTIVE',
              OR: [{ endsOn: null }, { endsOn: { gte: today } }],
            },
            select: { communityId: true },
          }),
          this.prisma.boardAppointment.findMany({
            where: {
              personId,
              status: 'ACTIVE',
              OR: [{ endsOn: null }, { endsOn: { gte: today } }],
            },
            select: { communityId: true },
          }),
        ])
      : [[], [], []] as const;
    const [ownerships, employments, boardAppointments] = relationships;
    return access.map((item) => {
      const relationTypes: string[] = [];
      if (ownerships.some((entry) => entry.communityId === item.communityId)) {
        relationTypes.push('OWNER');
      }
      if (employments.some((entry) => entry.communityId === item.communityId)) {
        relationTypes.push('STAFF');
      }
      if (
        boardAppointments.some(
          (entry) => entry.communityId === item.communityId,
        )
      ) {
        relationTypes.push('BOARD_MEMBER');
      }
      if (item.roleCode.toUpperCase().includes('ADMIN')) {
        relationTypes.push('ADMINISTRATOR');
      }
      return {
        communityId: item.community.id,
        name: item.community.name,
        legalName: item.community.legalName,
        rif: item.community.rif,
        status: item.community.status,
        roleCode: item.roleCode,
        relationTypes,
        scopes: this.parseScopes(item.scopes),
        workspaces: item.workspaces.map(
          (assignment) => assignment.workspaceCode,
        ),
      };
    });
  }

  async selectContext(auth: AuthPrincipal, communityId: string) {
    const context = await this.resolveCommunityContext(
      auth.userId,
      auth.platformRole,
      communityId,
    );
    return this.tokens.issueAccessToken({
      sub: auth.userId,
      email: auth.email,
      platformRole: auth.platformRole,
      tokenVersion: auth.tokenVersion,
      ...context,
    });
  }

  private async resolveCommunityContext(
    userId: string,
    platformRole: PlatformRole | null,
    communityId: string,
  ) {
    if (platformRole === PlatformRole.ROOT) {
      const community = await this.prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true },
      });
      if (!community) {
        throw new ForbiddenException('La comunidad seleccionada no existe.');
      }
      return {
        communityId,
        communityRole: 'ROOT',
        scopes: ['*'],
        workspaces: ['*'],
      };
    }

    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const access = await this.prisma.communityAccess.findFirst({
      where: {
        userId,
        communityId,
        status: AccessStatus.ACTIVE,
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        workspaces: {
          where: {
            status: 'ACTIVE',
            startsOn: { lte: now },
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
          },
        },
      },
    });
    if (!access) {
      throw new ForbiddenException(
        'No tienes acceso vigente a esta comunidad.',
      );
    }
    return {
      communityId,
      communityRole: access.roleCode,
      scopes: this.parseScopes(access.scopes),
      workspaces: access.workspaces.map(
        (assignment) => assignment.workspaceCode,
      ),
    };
  }

  private baseClaims(user: {
    id: string;
    email: string;
    platformRole: PlatformRole | null;
    tokenVersion: number;
  }) {
    return {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
      tokenVersion: user.tokenVersion,
    };
  }

  private publicUser(user: {
    id: string;
    email: string;
    platformRole: PlatformRole | null;
    status: AccessStatus;
    lastAccessAt: Date | null;
    person?: {
      firstName: string;
      lastName: string;
      documentType: string;
      documentNumber: string;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      platformRole: user.platformRole,
      status: user.status,
      lastAccessAt: user.lastAccessAt,
      person: user.person ?? null,
    };
  }

  private parseScopes(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
