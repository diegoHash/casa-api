import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ClientStanding,
  Currency,
  LicenseStatus,
  LedgerAccountType,
  NormalBalance,
  PlatformRole,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { PasswordService } from "../auth/password.service";
import { COMMUNITY_SCOPE_SET } from "../auth/scope-catalog";
import {
  COMMUNITY_WORKSPACES,
  COMMUNITY_WORKSPACE_SET,
  normalizeCommunityWorkspaceCode,
} from "../auth/workspace-catalog";
import { AuthPrincipal } from "../auth/auth.types";
import { CreateClientDto } from "./dto/create-client.dto";
import { CreateCommunityAccessDto } from "./dto/create-community-access.dto";
import { UpdateCommunityAccessDto } from "./dto/update-community-access.dto";
import { UpdateCommunityWorkspacesDto } from "./dto/update-community-workspaces.dto";
import { RevokeCommunityAccessDto } from "./dto/revoke-community-access.dto";
import {
  ReconcileLicenseDto,
  CreateLicensePaymentDto,
  RevokeLicenseDto,
  UpdateAutoRenewDto,
  UpdateLicenseSettingsDto,
  UpdateLicenseStatusDto,
  UpdateClientStandingDto,
} from "./dto/manage-client.dto";

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  list() {
    return this.prisma.client.findMany({
      orderBy: { joinedAt: "desc" },
      include: {
        community: {
          include: {
            activeLicense: true,
            properties: {
              orderBy: { code: "asc" },
              include: { location: true },
            },
          },
        },
        onboarding: true,
      },
    });
  }

  async listAudit(communityId?: string, rawLimit?: string) {
    const parsedLimit = Number(rawLimit);
    const take =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000)
        : 500;
    const normalizedCommunityId = communityId?.trim();
    return this.prisma.auditEvent.findMany({
      where: normalizedCommunityId
        ? { communityId: normalizedCommunityId }
        : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      include: {
        community: {
          select: { id: true, name: true, clientId: true },
        },
        actor: {
          select: {
            id: true,
            email: true,
            platformRole: true,
            person: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                documentType: true,
                documentNumber: true,
              },
            },
          },
        },
      },
    });
  }

  get(id: string) {
    return this.prisma.client.findUniqueOrThrow({
      where: { id },
      include: {
        community: {
          include: {
            activeLicense: true,
            properties: {
              orderBy: { code: "asc" },
              include: { location: true },
            },
          },
        },
        licenses: { orderBy: { createdAt: "desc" } },
        licensePayments: { orderBy: { paidAt: "desc" } },
        onboarding: true,
      },
    });
  }

  async listAccessUsers(clientId: string) {
    const communityId = await this.communityIdFor(clientId);
    return this.listAccessUsersForCommunity(communityId);
  }

  async listAccessPersonnel(clientId: string) {
    const communityId = await this.communityIdFor(clientId);
    return this.listAccessPersonnelForCommunity(communityId);
  }

  async listAccessPersonnelForCommunity(communityId: string) {
    const employments = await this.prisma.employment.findMany({
      where: {
        communityId,
        status: "ACTIVE",
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
      },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
      include: {
        person: {
          include: {
            user: {
              include: {
                communities: {
                  where: { communityId },
                  include: {
                    workspaces: {
                      orderBy: { startsOn: "desc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const seen = new Set<string>();
    return employments.flatMap((employment) => {
      if (seen.has(employment.personId)) return [];
      seen.add(employment.personId);
      const access = employment.person.user?.communities[0] ?? null;
      return [
        {
          employmentId: employment.id,
          personId: employment.person.id,
          firstName: employment.person.firstName,
          lastName: employment.person.lastName,
          documentType: employment.person.documentType,
          documentNumber: employment.person.documentNumber,
          email: employment.person.email,
          phone: employment.person.phone,
          position: employment.position,
          department: employment.department,
          engagementType: employment.engagementType,
          startsOn: employment.startsOn,
          hasCasaUser: Boolean(employment.person.user),
          loginEmail: employment.person.user?.email ?? employment.person.email,
          access: access
            ? {
                ...access,
                employmentActive: true,
                workspaces: access.workspaces.map((workspace) => ({
                  ...workspace,
                  workspaceCode: normalizeCommunityWorkspaceCode(
                    workspace.workspaceCode,
                  ),
                })),
              }
            : null,
          canCreateAccess:
            Boolean(employment.person.email) &&
            (!access || access.status === "BLOCKED"),
          blockingReason: access
            ? access.status === "BLOCKED"
              ? "El acceso anterior está bloqueado y puede reactivarse con una nueva configuración."
              : "Este trabajador ya posee acceso vigente en la comunidad."
            : employment.person.email
              ? null
              : "Registra un correo principal en la ficha de la persona antes de crear su acceso.",
        },
      ];
    });
  }

  async listAccessUsersForCommunity(communityId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [accesses, activeEmployments] = await Promise.all([
      this.prisma.communityAccess.findMany({
        where: { communityId },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: {
          workspaces: {
            orderBy: { startsOn: "desc" },
          },
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              lastAccessAt: true,
              person: true,
            },
          },
        },
      }),
      this.prisma.employment.findMany({
        where: {
          communityId,
          status: "ACTIVE",
          OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        },
        select: { personId: true },
      }),
    ]);
    const activePersonnel = new Set(
      activeEmployments.map((employment) => employment.personId),
    );
    return accesses.map((access) => ({
      ...access,
      workspaces: access.workspaces.map((workspace) => ({
        ...workspace,
        workspaceCode: normalizeCommunityWorkspaceCode(workspace.workspaceCode),
      })),
      employmentActive: Boolean(
        access.user.person?.id && activePersonnel.has(access.user.person.id),
      ),
    }));
  }

  async createAccessUser(
    actorUserId: string,
    clientId: string,
    input: CreateCommunityAccessDto,
  ) {
    const communityId = await this.communityIdFor(clientId);
    return this.createAccessUserInCommunity(actorUserId, communityId, input);
  }

  createAccessUserForCommunity(
    auth: AuthPrincipal,
    communityId: string,
    input: CreateCommunityAccessDto,
  ) {
    this.assertDelegatedGrants(auth, input.scopes, input.workspaceCodes);
    return this.createAccessUserInCommunity(auth.userId, communityId, input);
  }

  private async createAccessUserInCommunity(
    actorUserId: string,
    communityId: string,
    input: CreateCommunityAccessDto,
  ) {
    const scopes = this.normalizeScopes(input.scopes);
    const workspaceCodes = this.workspaceCodesForScopes(
      scopes,
      input.workspaceCodes,
    );

    return this.prisma.$transaction(async (transaction) => {
      const employment = await transaction.employment.findFirst({
        where: {
          communityId,
          personId: input.personId,
          status: "ACTIVE",
          OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        },
        include: { person: true },
      });
      if (!employment) {
        throw new BadRequestException(
          "La persona seleccionada no es personal vigente de esta comunidad.",
        );
      }
      const person = employment.person;

      const personUser = await transaction.appUser.findUnique({
        where: { personId: person.id },
      });
      const email = (person.email ?? personUser?.email)?.trim().toLowerCase();
      if (!email) {
        throw new BadRequestException(
          "El trabajador debe tener un correo principal antes de recibir acceso.",
        );
      }

      const emailOwner = await transaction.appUser.findUnique({
        where: { email },
      });
      if (emailOwner && emailOwner.personId !== person.id) {
        throw new ConflictException(
          "El correo ya pertenece a otra identidad registrada en CASA.",
        );
      }
      if (!emailOwner && !input.temporaryPassword) {
        throw new BadRequestException(
          "La contraseña temporal es obligatoria para un usuario nuevo.",
        );
      }
      const existingUser = personUser ?? emailOwner;
      let user =
        existingUser ??
        (await transaction.appUser.create({
          data: {
            personId: person.id,
            email,
            passwordHash: await this.passwords.hash(
              input.temporaryPassword as string,
            ),
          },
        }));
      if (existingUser && existingUser.email !== email) {
        user = await transaction.appUser.update({
          where: { id: existingUser.id },
          data: { email, tokenVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { userId: existingUser.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await transaction.communityPerson.upsert({
        where: {
          communityId_personId: { communityId, personId: person.id },
        },
        create: { communityId, personId: person.id },
        update: { status: "ACTIVE" },
      });

      const existingAccess = await transaction.communityAccess.findUnique({
        where: {
          userId_communityId: { userId: user.id, communityId },
        },
      });
      if (existingAccess) {
        if (existingAccess.status !== "BLOCKED") {
          throw new ConflictException(
            existingAccess.status === "ACTIVE"
              ? "Este usuario ya tiene acceso vigente en la comunidad."
              : "Este acceso no puede reactivarse desde la configuración de personal.",
          );
        }
        const now = new Date();
        await transaction.communityWorkspaceAssignment.updateMany({
          where: { accessId: existingAccess.id, status: "ACTIVE" },
          data: {
            status: "ENDED",
            endsOn: now,
            endReason: "Reconfiguración por reactivación de acceso",
          },
        });
        const access = await transaction.communityAccess.update({
          where: { id: existingAccess.id },
          data: {
            roleCode: input.roleCode.trim().toUpperCase(),
            scopes,
            status: "ACTIVE",
            startsOn: now,
            endsOn: null,
            workspaces: {
              create: workspaceCodes.map((workspaceCode) => ({
                communityId,
                workspaceCode,
                startsOn: now,
              })),
            },
          },
          include: { workspaces: true },
        });
        await transaction.appUser.update({
          where: { id: user.id },
          data: { status: "ACTIVE", tokenVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.auditEvent.create({
          data: {
            communityId,
            actorUserId,
            requestId: randomUUID(),
            action: "COMMUNITY_ACCESS_REACTIVATED",
            entityType: "CommunityAccess",
            entityId: access.id,
            detail: `Acceso de ${email} reactivado como ${access.roleCode}`,
            before: {
              status: existingAccess.status,
              roleCode: existingAccess.roleCode,
              scopes: this.parseStoredScopes(existingAccess.scopes),
            },
            after: {
              status: access.status,
              roleCode: access.roleCode,
              scopes,
              workspaceCodes,
            },
          },
        });
        return {
          access,
          user: {
            id: user.id,
            email: user.email,
            status: "ACTIVE",
            person,
          },
          createdUser: false,
          reactivated: true,
        };
      }
      const access = await transaction.communityAccess.create({
        data: {
          userId: user.id,
          communityId,
          roleCode: input.roleCode.trim().toUpperCase(),
          scopes,
          workspaces: {
            create: workspaceCodes.map((workspaceCode) => ({
              communityId,
              workspaceCode,
            })),
          },
        },
        include: { workspaces: true },
      });
      await transaction.auditEvent.create({
        data: {
          communityId,
          actorUserId,
          requestId: randomUUID(),
          action: "COMMUNITY_ACCESS_CREATED",
          entityType: "CommunityAccess",
          entityId: access.id,
          detail: `Acceso ${access.roleCode} asignado a ${email}`,
          after: {
            userId: user.id,
            roleCode: access.roleCode,
            scopes,
            workspaceCodes,
          },
        },
      });
      return {
        access,
        user: {
          id: user.id,
          email: user.email,
          status: user.status,
          person,
        },
        createdUser: !existingUser,
      };
    });
  }

  async updateAccess(
    auth: AuthPrincipal,
    clientId: string,
    accessId: string,
    input: UpdateCommunityAccessDto,
  ) {
    const communityId = await this.communityIdFor(clientId);
    return this.updateAccessForCommunity(auth, communityId, accessId, input);
  }

  async updateAccessForCommunity(
    auth: AuthPrincipal,
    communityId: string,
    accessId: string,
    input: UpdateCommunityAccessDto,
  ) {
    const scopes = this.normalizeScopes(input.scopes);
    const workspaceCodes = this.workspaceCodesForScopes(
      scopes,
      input.workspaceCodes,
    );
    this.assertDelegatedGrants(auth, scopes, workspaceCodes);

    return this.prisma.$transaction(async (transaction) => {
      const access = await transaction.communityAccess.findFirst({
        where: { id: accessId, communityId },
        include: {
          workspaces: { where: { status: "ACTIVE" } },
          user: { select: { id: true, personId: true, platformRole: true } },
        },
      });
      if (!access) {
        throw new NotFoundException(
          "El acceso no pertenece a la comunidad seleccionada.",
        );
      }
      if (access.userId === auth.userId) {
        throw new ForbiddenException("No puedes modificar tu propio acceso.");
      }
      if (access.user.platformRole) {
        throw new ForbiddenException(
          "Este acceso es administrado exclusivamente por CASA.",
        );
      }
      if (access.status === "REVOKED") {
        throw new ConflictException(
          "Este acceso fue revocado y requiere un proceso explícito de rehabilitación.",
        );
      }
      if (!access.user.personId) {
        throw new ConflictException(
          "El acceso no está vinculado a una persona del Núcleo CASA.",
        );
      }
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const activeEmployment = await transaction.employment.findFirst({
        where: {
          communityId,
          personId: access.user.personId,
          status: "ACTIVE",
          OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        },
        select: { id: true },
      });
      if (!activeEmployment) {
        throw new ConflictException(
          "No se puede modificar este acceso porque la persona no tiene una relación laboral vigente en la comunidad. El registro permanece disponible únicamente como histórico.",
        );
      }

      const currentCodes = access.workspaces.map(
        (assignment) => assignment.workspaceCode,
      );
      const currentScopes = this.parseStoredScopes(access.scopes);
      this.assertDelegatedGrants(auth, currentScopes, currentCodes);
      const removed = access.workspaces.filter(
        (assignment) =>
          !workspaceCodes.includes(
            normalizeCommunityWorkspaceCode(assignment.workspaceCode),
          ),
      );
      const added = workspaceCodes.filter(
        (code) => !currentCodes.includes(code),
      );
      const now = new Date();

      await transaction.communityAccess.update({
        where: { id: accessId },
        data: {
          roleCode: input.roleCode.trim().toUpperCase(),
          scopes,
          status: "ACTIVE",
          startsOn: access.status === "BLOCKED" ? now : access.startsOn,
          endsOn: null,
        },
      });
      if (removed.length) {
        await transaction.communityWorkspaceAssignment.updateMany({
          where: { id: { in: removed.map((assignment) => assignment.id) } },
          data: {
            status: "ENDED",
            endsOn: now,
            endReason: input.reason.trim(),
          },
        });
      }
      if (added.length) {
        await transaction.communityWorkspaceAssignment.createMany({
          data: added.map((workspaceCode) => ({
            accessId,
            communityId,
            workspaceCode,
          })),
        });
      }

      await transaction.auditEvent.create({
        data: {
          communityId,
          actorUserId: auth.userId,
          requestId: randomUUID(),
          action:
            access.status === "BLOCKED"
              ? "COMMUNITY_ACCESS_REACTIVATED"
              : "COMMUNITY_ACCESS_DELEGATED_UPDATE",
          entityType: "CommunityAccess",
          entityId: accessId,
          detail:
            access.status === "BLOCKED"
              ? "Acceso del personal reactivado con una nueva configuración"
              : "Rol, permisos o espacios del personal actualizados",
          reason: input.reason.trim(),
          before: {
            roleCode: access.roleCode,
            scopes: currentScopes,
            workspaceCodes: currentCodes,
          },
          after: {
            roleCode: input.roleCode.trim().toUpperCase(),
            scopes,
            workspaceCodes,
          },
        },
      });
      await transaction.appUser.update({
        where: { id: access.userId },
        data: { tokenVersion: { increment: 1 } },
      });
      await transaction.authSession.updateMany({
        where: { userId: access.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return transaction.communityAccess.findUniqueOrThrow({
        where: { id: accessId },
        include: {
          workspaces: { orderBy: { startsOn: "desc" } },
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              lastAccessAt: true,
              person: true,
            },
          },
        },
      });
    });
  }

  async revokeAccess(
    auth: AuthPrincipal,
    clientId: string,
    accessId: string,
    input: RevokeCommunityAccessDto,
  ) {
    const communityId = await this.communityIdFor(clientId);
    return this.revokeAccessForCommunity(auth, communityId, accessId, input);
  }

  async revokeAccessForCommunity(
    auth: AuthPrincipal,
    communityId: string,
    accessId: string,
    input: RevokeCommunityAccessDto,
  ) {
    const reason = input.reason.trim();
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const access = await transaction.communityAccess.findFirst({
        where: { id: accessId, communityId },
        include: {
          workspaces: { where: { status: "ACTIVE" } },
          user: { select: { id: true, email: true, platformRole: true } },
        },
      });
      if (!access) {
        throw new NotFoundException(
          "El acceso no pertenece a la comunidad seleccionada.",
        );
      }
      if (access.userId === auth.userId) {
        throw new ForbiddenException("No puedes revocar tu propio acceso.");
      }
      if (access.user.platformRole) {
        throw new ForbiddenException(
          "Este acceso es administrado exclusivamente por CASA.",
        );
      }
      if (access.status === "REVOKED") {
        throw new ConflictException("Este acceso ya fue revocado.");
      }

      if (auth.platformRole !== PlatformRole.ROOT) {
        this.assertDelegatedGrants(
          auth,
          this.parseStoredScopes(access.scopes),
          access.workspaces.map((workspace) => workspace.workspaceCode),
        );
      }

      await transaction.communityWorkspaceAssignment.updateMany({
        where: { accessId, status: "ACTIVE" },
        data: {
          status: "ENDED",
          endsOn: now,
          endReason: reason,
        },
      });
      const revoked = await transaction.communityAccess.update({
        where: { id: accessId },
        data: { status: "REVOKED", endsOn: now },
        include: {
          workspaces: { orderBy: { startsOn: "desc" } },
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              lastAccessAt: true,
              person: true,
            },
          },
        },
      });

      await transaction.appUser.update({
        where: { id: access.userId },
        data: { tokenVersion: { increment: 1 } },
      });
      await transaction.authSession.updateMany({
        where: { userId: access.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.auditEvent.create({
        data: {
          communityId,
          actorUserId: auth.userId,
          requestId: randomUUID(),
          action: "COMMUNITY_ACCESS_REVOKED",
          entityType: "CommunityAccess",
          entityId: accessId,
          detail: `Acceso de ${access.user.email} revocado`,
          reason,
          before: {
            status: access.status,
            roleCode: access.roleCode,
            scopes: this.parseStoredScopes(access.scopes),
            workspaceCodes: access.workspaces.map(
              (workspace) => workspace.workspaceCode,
            ),
          },
          after: { status: revoked.status, endsOn: now },
        },
      });

      return revoked;
    });
  }

  async updateAccessWorkspaces(
    actorUserId: string,
    clientId: string,
    accessId: string,
    input: UpdateCommunityWorkspacesDto,
  ) {
    const communityId = await this.communityIdFor(clientId);
    const workspaceCodes = this.normalizeWorkspaces(input.workspaceCodes);
    return this.prisma.$transaction(async (transaction) => {
      const access = await transaction.communityAccess.findFirst({
        where: { id: accessId, communityId },
        include: {
          workspaces: {
            where: { status: "ACTIVE" },
          },
        },
      });
      if (!access) {
        throw new NotFoundException(
          "El acceso no pertenece a la comunidad seleccionada.",
        );
      }

      const currentCodes = access.workspaces.map(
        (assignment) => assignment.workspaceCode,
      );
      const removed = access.workspaces.filter(
        (assignment) =>
          !workspaceCodes.includes(
            normalizeCommunityWorkspaceCode(assignment.workspaceCode),
          ),
      );
      const added = workspaceCodes.filter(
        (code) => !currentCodes.includes(code),
      );
      const now = new Date();

      if (removed.length) {
        await transaction.communityWorkspaceAssignment.updateMany({
          where: { id: { in: removed.map((assignment) => assignment.id) } },
          data: {
            status: "ENDED",
            endsOn: now,
            endReason: input.reason.trim(),
          },
        });
      }
      if (added.length) {
        await transaction.communityWorkspaceAssignment.createMany({
          data: added.map((workspaceCode) => ({
            accessId,
            communityId,
            workspaceCode,
          })),
        });
      }

      await transaction.auditEvent.create({
        data: {
          communityId,
          actorUserId,
          requestId: randomUUID(),
          action: "COMMUNITY_WORKSPACES_CHANGED",
          entityType: "CommunityAccess",
          entityId: accessId,
          detail: "Espacios de trabajo del personal actualizados",
          reason: input.reason.trim(),
          before: { workspaceCodes: currentCodes },
          after: { workspaceCodes },
        },
      });

      if (removed.length || added.length) {
        await transaction.appUser.update({
          where: { id: access.userId },
          data: {
            tokenVersion: {
              increment: 1,
            },
          },
        });
        await transaction.authSession.updateMany({
          where: {
            userId: access.userId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });
      }

      return transaction.communityAccess.findUniqueOrThrow({
        where: { id: accessId },
        include: {
          workspaces: { orderBy: { startsOn: "desc" } },
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              lastAccessAt: true,
              person: true,
            },
          },
        },
      });
    });
  }

  async createIntegralClient(actorUserId: string, input: CreateClientDto) {
    const normalizedRif = input.rif.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const duplicate = await this.prisma.client.findUnique({
      where: { rif: normalizedRif },
    });
    if (duplicate) {
      throw new ConflictException(
        "Ya existe un cliente registrado con este RIF.",
      );
    }

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);
    const graceUntil = new Date(periodEnd);
    graceUntil.setDate(graceUntil.getDate() + 5);
    const requestId = randomUUID();

    return this.prisma.$transaction(
      async (transaction) => {
        const client = await transaction.client.create({
          data: {
            name: input.name.trim(),
            legalName: input.legalName.trim(),
            rif: normalizedRif,
            contactName: input.contactName.trim(),
            contactEmail: input.contactEmail.trim().toLowerCase(),
            contactPhone: input.contactPhone.trim(),
            onboardingProgress: input.onboardingProgress,
          },
        });

        const license = await transaction.license.create({
          data: {
            clientId: client.id,
            monthlyFee: new Prisma.Decimal(input.monthlyFee),
            currency: Currency.USD,
            periodStart,
            periodEnd,
            graceUntil,
          },
        });

        const community = await transaction.community.create({
          data: {
            clientId: client.id,
            activeLicenseId: license.id,
            name: input.name.trim(),
            legalName: input.legalName.trim(),
            rif: normalizedRif,
            phone: input.contactPhone.trim(),
            email: input.contactEmail.trim().toLowerCase(),
            address: input.address.trim(),
            state: input.state.trim(),
            city: input.city.trim(),
            postalCode: input.postalCode.trim(),
          },
        });

        const caracasNow = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const year = caracasNow.getUTCFullYear();
        const month = caracasNow.getUTCMonth();
        const periodKey = `${year}-${String(month + 1).padStart(2, "0")}`;
        const startsOn = new Date(Date.UTC(year, month, 1, 4));
        const endsOn = new Date(Date.UTC(year, month + 1, 1, 3, 59, 59, 999));
        const periodLabel = new Intl.DateTimeFormat("es-VE", {
          month: "long",
          year: "numeric",
          timeZone: "America/Caracas",
        }).format(caracasNow);
        await transaction.communityAccountingSettings.create({
          data: { communityId: community.id, functionalCurrency: Currency.USD },
        });
        await transaction.accountingPeriod.create({
          data: {
            communityId: community.id,
            periodKey,
            label: periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1),
            startsOn,
            endsOn,
          },
        });
        await transaction.ledgerAccount.createMany({
          data: [
            {
              communityId: community.id,
              code: "1.1.01",
              name: "Caja y bancos",
              type: LedgerAccountType.ASSET,
              normalBalance: NormalBalance.DEBIT,
            },
            {
              communityId: community.id,
              code: "1.1.03",
              name: "Cuentas por cobrar a propietarios",
              type: LedgerAccountType.ASSET,
              normalBalance: NormalBalance.DEBIT,
            },
            {
              communityId: community.id,
              code: "2.1.01",
              name: "Cuentas por pagar a proveedores",
              type: LedgerAccountType.LIABILITY,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "2.1.02",
              name: "Anticipos de propietarios",
              type: LedgerAccountType.LIABILITY,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "3.1.01",
              name: "Patrimonio / saldo inicial",
              type: LedgerAccountType.EQUITY,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "2.2.01",
              name: "Fondo de reserva",
              type: LedgerAccountType.LIABILITY,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "4.1.01",
              name: "Ingresos por cuotas de mantenimiento",
              type: LedgerAccountType.INCOME,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "4.2.01",
              name: "Ganancia cambiaria",
              type: LedgerAccountType.INCOME,
              normalBalance: NormalBalance.CREDIT,
            },
            {
              communityId: community.id,
              code: "5.1.01",
              name: "Gastos comunes",
              type: LedgerAccountType.EXPENSE,
              normalBalance: NormalBalance.DEBIT,
            },
            {
              communityId: community.id,
              code: "5.2.01",
              name: "Pérdida cambiaria",
              type: LedgerAccountType.EXPENSE,
              normalBalance: NormalBalance.DEBIT,
            },
          ],
        });

        const onboarding = await transaction.onboardingCase.create({
          data: {
            clientId: client.id,
            communityId: community.id,
          },
        });

        await transaction.auditEvent.create({
          data: {
            communityId: community.id,
            actorUserId,
            requestId,
            action: "CLIENT_INTEGRAL_CREATED",
            entityType: "Client",
            entityId: client.id,
            detail: `Alta integral de ${client.name}`,
            reason: "Registro inicial desde CASA Control",
            after: {
              clientId: client.id,
              communityId: community.id,
              licenseId: license.id,
              onboardingId: onboarding.id,
            },
          },
        });

        return { client, license, community, onboarding, requestId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateStanding(
    actorUserId: string,
    id: string,
    input: UpdateClientStandingDto,
  ) {
    const before = await this.prisma.client.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException("El cliente CASA no existe.");
    }
    const after = await this.prisma.client.update({
      where: { id },
      data: { standing: input.standing },
    });
    await this.prisma.auditEvent.create({
      data: {
        communityId: await this.communityIdFor(id),
        actorUserId,
        requestId: randomUUID(),
        action: "CLIENT_STANDING_CHANGED",
        entityType: "Client",
        entityId: id,
        detail: `Estado de solvencia actualizado a ${input.standing}`,
        reason: input.reason.trim(),
        before: { standing: before.standing },
        after: { standing: after.standing },
      },
    });
    return after;
  }

  async revokeLicense(
    actorUserId: string,
    clientId: string,
    input: RevokeLicenseDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const community = await transaction.community.findUnique({
        where: { clientId },
        include: { activeLicense: true },
      });
      if (!community?.activeLicense) {
        throw new NotFoundException(
          "El cliente no tiene una licencia activa asociada.",
        );
      }
      if (community.activeLicense.status === LicenseStatus.REVOKED) {
        throw new ConflictException("La licencia ya fue revocada.");
      }
      const license = await transaction.license.update({
        where: { id: community.activeLicense.id },
        data: {
          status: LicenseStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: input.reason.trim(),
        },
      });
      await transaction.client.update({
        where: { id: clientId },
        data: { standing: ClientStanding.SUSPENDED },
      });
      await transaction.auditEvent.create({
        data: {
          communityId: community.id,
          actorUserId,
          requestId: randomUUID(),
          action: "LICENSE_REVOKED",
          entityType: "License",
          entityId: license.id,
          detail: "Licencia integral revocada",
          reason: input.reason.trim(),
          after: { status: license.status, revokedAt: license.revokedAt },
        },
      });
      return license;
    });
  }

  async reconcileLicense(
    actorUserId: string,
    clientId: string,
    input: ReconcileLicenseDto,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const community = await transaction.community.findUnique({
          where: { clientId },
          include: { activeLicense: true },
        });
        if (!community?.activeLicense) {
          throw new NotFoundException(
            "El cliente no tiene una licencia asociada.",
          );
        }
        const reconciledAt = input.reconciledAt
          ? new Date(input.reconciledAt)
          : new Date();
        let license = await transaction.license.update({
          where: { id: community.activeLicense.id },
          data: { lastReconciledAt: reconciledAt },
        });

        if (community.activeLicense.autoRenewOnReconciliation) {
          const dayAfterCurrentPeriod = new Date(
            community.activeLicense.periodEnd,
          );
          dayAfterCurrentPeriod.setDate(dayAfterCurrentPeriod.getDate() + 1);
          const periodStart =
            dayAfterCurrentPeriod > reconciledAt
              ? dayAfterCurrentPeriod
              : reconciledAt;
          const periodEnd = new Date(periodStart);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          periodEnd.setDate(periodEnd.getDate() - 1);
          const graceUntil = new Date(periodEnd);
          graceUntil.setDate(graceUntil.getDate() + 5);
          license = await transaction.license.create({
            data: {
              clientId,
              status: LicenseStatus.ACTIVE,
              autoRenewOnReconciliation:
                community.activeLicense.autoRenewOnReconciliation,
              monthlyFee: community.activeLicense.monthlyFee,
              currency: community.activeLicense.currency,
              periodStart,
              periodEnd,
              graceUntil,
              graceDays: community.activeLicense.graceDays,
              isTrial: false,
              lastReconciledAt: reconciledAt,
            },
          });
          await transaction.community.update({
            where: { id: community.id },
            data: { activeLicenseId: license.id },
          });
        }
        await transaction.client.update({
          where: { id: clientId },
          data: { standing: ClientStanding.SOLVENT },
        });
        await transaction.auditEvent.create({
          data: {
            communityId: community.id,
            actorUserId,
            requestId: randomUUID(),
            action: "LICENSE_PAYMENT_RECONCILED",
            entityType: "License",
            entityId: license.id,
            detail: "Pago mensual conciliado",
            reason: `Referencia: ${input.reference.trim()}`,
            after: {
              licenseId: license.id,
              status: license.status,
              periodStart: license.periodStart,
              periodEnd: license.periodEnd,
            },
          },
        });
        return license;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateAutoRenew(
    actorUserId: string,
    clientId: string,
    input: UpdateAutoRenewDto,
  ) {
    const community = await this.prisma.community.findUnique({
      where: { clientId },
      include: { activeLicense: true },
    });
    if (!community?.activeLicense) {
      throw new NotFoundException("El cliente no tiene una licencia asociada.");
    }
    if (community.activeLicense.status === LicenseStatus.REVOKED) {
      throw new ConflictException(
        "No se puede modificar una licencia revocada.",
      );
    }
    const license = await this.prisma.license.update({
      where: { id: community.activeLicense.id },
      data: { autoRenewOnReconciliation: input.enabled },
    });
    await this.prisma.auditEvent.create({
      data: {
        communityId: community.id,
        actorUserId,
        requestId: randomUUID(),
        action: "LICENSE_AUTO_RENEW_CHANGED",
        entityType: "License",
        entityId: license.id,
        detail: input.enabled
          ? "Renovación automática activada"
          : "Renovación automática desactivada",
        reason: input.reason.trim(),
        before: {
          autoRenewOnReconciliation:
            community.activeLicense.autoRenewOnReconciliation,
        },
        after: { autoRenewOnReconciliation: input.enabled },
      },
    });
    return license;
  }

  async updateLicenseStatus(
    actorUserId: string,
    clientId: string,
    input: UpdateLicenseStatusDto,
  ) {
    if (
      input.status !== LicenseStatus.ACTIVE &&
      input.status !== LicenseStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        "Desde este control solo se puede suspender o reactivar una licencia.",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const community = await transaction.community.findUnique({
        where: { clientId },
        include: { activeLicense: true },
      });
      if (!community?.activeLicense) {
        throw new NotFoundException(
          "El cliente no tiene una licencia asociada.",
        );
      }
      if (community.activeLicense.status === LicenseStatus.REVOKED) {
        throw new ConflictException(
          "No se puede reactivar una licencia revocada.",
        );
      }
      const license = await transaction.license.update({
        where: { id: community.activeLicense.id },
        data: {
          status: input.status,
          ...(input.status === LicenseStatus.ACTIVE
            ? { revokedAt: null, revokedReason: null }
            : {}),
        },
      });
      await transaction.client.update({
        where: { id: clientId },
        data: {
          standing:
            input.status === LicenseStatus.ACTIVE
              ? ClientStanding.SOLVENT
              : ClientStanding.SUSPENDED,
        },
      });
      await transaction.auditEvent.create({
        data: {
          communityId: community.id,
          actorUserId,
          requestId: randomUUID(),
          action:
            input.status === LicenseStatus.ACTIVE
              ? "LICENSE_REACTIVATED"
              : "LICENSE_SUSPENDED",
          entityType: "License",
          entityId: license.id,
          detail:
            input.status === LicenseStatus.ACTIVE
              ? "Licencia reactivada manualmente"
              : "Licencia suspendida manualmente",
          reason: input.reason.trim(),
          before: { status: community.activeLicense.status },
          after: { status: license.status },
        },
      });
      return license;
    });
  }

  async updateLicenseSettings(
    actorUserId: string,
    clientId: string,
    input: UpdateLicenseSettingsDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const community = await transaction.community.findUnique({
        where: { clientId },
        include: { activeLicense: true },
      });
      if (!community?.activeLicense) {
        throw new NotFoundException(
          "El cliente no tiene una licencia asociada.",
        );
      }
      if (community.activeLicense.status === LicenseStatus.REVOKED) {
        throw new ConflictException(
          "No se puede configurar una licencia revocada.",
        );
      }
      if (
        input.graceDays !== undefined &&
        (!Number.isInteger(input.graceDays) || input.graceDays > 365)
      ) {
        throw new BadRequestException(
          "El tiempo de gracia debe ser un número entero entre 0 y 365 días.",
        );
      }
      const trialFrom = input.trialFrom
        ? new Date(input.trialFrom)
        : community.activeLicense.trialFrom;
      const trialUntil = input.trialUntil
        ? new Date(input.trialUntil)
        : community.activeLicense.trialUntil;
      if (trialFrom && trialUntil && trialUntil < trialFrom) {
        throw new BadRequestException(
          "El fin de la prueba debe ser posterior al inicio.",
        );
      }
      const graceDays = input.graceDays ?? community.activeLicense.graceDays;
      const graceUntil = new Date(community.activeLicense.periodEnd);
      graceUntil.setDate(graceUntil.getDate() + graceDays);
      const license = await transaction.license.update({
        where: { id: community.activeLicense.id },
        data: {
          ...(input.autoRenewOnReconciliation !== undefined
            ? { autoRenewOnReconciliation: input.autoRenewOnReconciliation }
            : {}),
          ...(input.isTrial !== undefined ? { isTrial: input.isTrial } : {}),
          ...(input.trialFrom !== undefined ? { trialFrom } : {}),
          ...(input.trialUntil !== undefined ? { trialUntil } : {}),
          ...(input.graceDays !== undefined ? { graceDays, graceUntil } : {}),
        },
      });
      await transaction.auditEvent.create({
        data: {
          communityId: community.id,
          actorUserId,
          requestId: randomUUID(),
          action: "LICENSE_SETTINGS_UPDATED",
          entityType: "License",
          entityId: license.id,
          detail: "Configuración de gracia, renovación y prueba actualizada",
          after: {
            graceDays: license.graceDays,
            autoRenewOnReconciliation: license.autoRenewOnReconciliation,
            isTrial: license.isTrial,
            trialFrom: license.trialFrom,
            trialUntil: license.trialUntil,
          },
        },
      });
      return license;
    });
  }

  async createLicensePayment(
    actorUserId: string,
    clientId: string,
    input: CreateLicensePaymentDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const community = await transaction.community.findUnique({
        where: { clientId },
        include: { activeLicense: true },
      });
      if (!community?.activeLicense) {
        throw new NotFoundException(
          "El cliente no tiene una licencia asociada.",
        );
      }
      if (community.activeLicense.status === LicenseStatus.REVOKED) {
        throw new ConflictException(
          "No se puede registrar un pago para una licencia revocada.",
        );
      }
      const payment = await transaction.licensePayment.create({
        data: {
          communityId: community.id,
          clientId,
          licenseId: community.activeLicense.id,
          amount: new Prisma.Decimal(input.amount),
          exchangeRate: new Prisma.Decimal(input.exchangeRate),
          currency: input.currency ?? Currency.USD,
          paymentMethod: input.paymentMethod,
          reference: input.reference.trim(),
          paidAt: new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)
              ? `${input.paidAt}T12:00:00`
              : input.paidAt,
          ),
          notes: input.notes?.trim() || null,
          createdById: actorUserId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          communityId: community.id,
          actorUserId,
          requestId: randomUUID(),
          action: "LICENSE_PAYMENT_REGISTERED",
          entityType: "LicensePayment",
          entityId: payment.id,
          detail: "Pago manual de licencia registrado",
          reason: `Referencia: ${payment.reference}`,
          after: {
            amount: payment.amount,
            exchangeRate: payment.exchangeRate,
            paymentMethod: payment.paymentMethod,
            paidAt: payment.paidAt,
          },
        },
      });
      return payment;
    });
  }

  private normalizeWorkspaces(input: string[]) {
    const workspaceCodes = input
      .map(normalizeCommunityWorkspaceCode)
      .filter(Boolean);
    const invalid = workspaceCodes.filter(
      (code) => !COMMUNITY_WORKSPACE_SET.has(code),
    );
    if (invalid.length) {
      throw new BadRequestException(
        `Espacios de trabajo no reconocidos: ${invalid.join(", ")}.`,
      );
    }
    return workspaceCodes;
  }

  private workspaceCodesForScopes(scopes: string[], input: string[]) {
    if (scopes.includes("*") || scopes.includes("community.full_access")) {
      return [...COMMUNITY_WORKSPACES];
    }
    return this.normalizeWorkspaces(input);
  }

  private normalizeScopes(input: string[]) {
    const scopes = input.map((scope) => scope.trim()).filter(Boolean);
    const invalid = scopes.filter((scope) => !COMMUNITY_SCOPE_SET.has(scope));
    if (invalid.length) {
      throw new BadRequestException(
        `Permisos no reconocidos: ${invalid.join(", ")}.`,
      );
    }
    return scopes;
  }

  private parseStoredScopes(value: Prisma.JsonValue) {
    if (!Array.isArray(value)) return [];
    return value.filter((scope): scope is string => typeof scope === "string");
  }

  private assertDelegatedGrants(
    auth: AuthPrincipal,
    scopes: string[],
    workspaceCodes: string[],
  ) {
    const normalizedScopes = this.normalizeScopes(scopes);
    const normalizedWorkspaces = this.normalizeWorkspaces(workspaceCodes);
    if (auth.platformRole === PlatformRole.ROOT) {
      return;
    }
    const deniedScopes = normalizedScopes.filter(
      (scope) => !this.hasScope(auth.scopes, scope),
    );
    const hasCommunityFullAccess = auth.scopes.some(
      (scope) => scope === "*" || scope === "community.full_access",
    );
    const deniedWorkspaces = normalizedWorkspaces.filter(
      (workspace) =>
        !hasCommunityFullAccess &&
        !auth.workspaces.includes("*") &&
        !auth.workspaces.includes(workspace),
    );
    if (deniedScopes.length || deniedWorkspaces.length) {
      throw new ForbiddenException(
        "No puedes conceder ni modificar capacidades superiores a tu propia autorización.",
      );
    }
  }

  private hasScope(granted: string[], required: string) {
    return granted.some(
      (candidate) =>
        candidate === "*" ||
        candidate === "community.full_access" ||
        candidate === required ||
        (candidate.endsWith(".*") &&
          required.startsWith(candidate.slice(0, -1))),
    );
  }

  private async communityIdFor(clientId: string) {
    const community = await this.prisma.community.findUnique({
      where: { clientId },
      select: { id: true },
    });
    if (!community) {
      throw new NotFoundException("El cliente no tiene comunidad asociada.");
    }
    return community.id;
  }
}
