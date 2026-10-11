import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessStatus,
  CommunicationAudienceType,
  CommunicationDeliveryStatus,
  CommunicationStatus,
  DocumentType,
  LifecycleStatus,
  Prisma,
  RecordStatus,
  ServiceAuthorizationStatus,
  ServiceIncidentStatus,
  JournalEntrySource,
  JournalEntryStatus,
  LedgerAccountType,
  AccountingPeriodStatus,
  Currency,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  AssignIncidentDto,
  AuthorizationListQueryDto,
  CommunicationDetailQueryDto,
  CommunicationListQueryDto,
  CreateOwnerAccessRequestDto,
  CreateOwnerAuthorizationDto,
  IncidentListQueryDto,
  PaginationQueryDto,
  PublishCommunicationDto,
  RejectAuthorizationDto,
  RegisterAccessEventDto,
  ScanAuthorizationQrDto,
  UpdateIncidentStatusDto,
  ReportPaymentDto,
} from './dto/owner-service.dto';
import { BackendMailService } from '../common/services/backend-mail.service';
import { PasswordService } from '../auth/password.service';
import { S3StorageService } from '../storage/s3-storage.service';

@Injectable()
export class OwnerServiceService {
  private readonly logger = new Logger(OwnerServiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: BackendMailService,
    private readonly passwords: PasswordService,
    private readonly s3: S3StorageService,
  ) {}

  async listOwners(communityId: string, query: PaginationQueryDto) {
    const where: Prisma.OwnershipWhereInput = {
      communityId,
      status: LifecycleStatus.ACTIVE,
      OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
      property: { status: RecordStatus.ACTIVE },
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { person: { firstName: { contains: query.search } } },
                  { person: { lastName: { contains: query.search } } },
                  { person: { documentNumber: { contains: query.search } } },
                  { property: { code: { contains: query.search } } },
                  {
                    property: {
                      location: { name: { contains: query.search } },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    };
    const [total, ownerships] = await Promise.all([
      this.prisma.ownership.count({ where }),
      this.prisma.ownership.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [
          { property: { location: { code: 'asc' } } },
          { property: { code: 'asc' } },
          { person: { lastName: 'asc' } },
        ],
        select: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              documentType: true,
              documentNumber: true,
              phone: true,
              email: true,
              contacts: {
                where: { communityId },
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  type: true,
                  label: true,
                  value: true,
                },
              },
            },
          },
          property: {
            select: {
              id: true,
              code: true,
              kind: true,
              location: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  kind: true,
                },
              },
            },
          },
        },
      }),
    ]);
    return this.page(
      ownerships.map(({ person, property }) => ({
        person,
        property,
        sector:
          property.location?.name ?? property.location?.code ?? 'Sin sector',
      })),
      total,
      query,
    );
  }

  async options(communityId: string) {
    const [locations, ownerships, staff] = await Promise.all([
      this.prisma.propertyLocation.findMany({
        where: { communityId, status: RecordStatus.ACTIVE },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, kind: true },
      }),
      this.prisma.ownership.findMany({
        where: {
          communityId,
          status: LifecycleStatus.ACTIVE,
          OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
          property: { status: RecordStatus.ACTIVE },
        },
        orderBy: [{ property: { code: 'asc' } }],
        select: {
          property: { select: { id: true, code: true, locationId: true } },
          person: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.employment.findMany({
        where: {
          communityId,
          status: LifecycleStatus.ACTIVE,
          OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        },
        orderBy: [{ person: { lastName: 'asc' } }],
        select: {
          id: true,
          position: true,
          department: true,
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
      }),
    ]);
    return { sectors: locations, owners: ownerships, staff };
  }

  async listIncidents(communityId: string, query: IncidentListQueryDto) {
    const where: Prisma.ServiceIncidentWhereInput = {
      communityId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search } },
              { description: { contains: query.search } },
              { property: { code: { contains: query.search } } },
              { reporter: { firstName: { contains: query.search } } },
              { reporter: { lastName: { contains: query.search } } },
              { assignedName: { contains: query.search } },
            ],
          }
        : {}),
    };
    const include = {
      property: { select: { id: true, code: true } },
      reporter: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          documentType: true,
          documentNumber: true,
        },
      },
      assignedEmployment: {
        select: {
          id: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
      history: {
        orderBy: { occurredAt: 'asc' as const },
        include: {
          actor: {
            select: {
              email: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    };
    const [total, items] = await Promise.all([
      this.prisma.serviceIncident.count({ where }),
      this.prisma.serviceIncident.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { reportedAt: 'desc' },
        include,
      }),
    ]);
    return this.page(items, total, query);
  }

  async assignIncident(
    communityId: string,
    actorUserId: string,
    incidentId: string,
    input: AssignIncidentDto,
  ) {
    const incident = await this.incident(communityId, incidentId);
    let employmentId: string | null = null;
    let assignedName = input.assignedName.trim();
    if (input.employmentId) {
      const employment = await this.prisma.employment.findFirst({
        where: {
          id: input.employmentId,
          communityId,
          status: LifecycleStatus.ACTIVE,
          OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        },
        include: { person: true },
      });
      if (!employment) {
        throw new NotFoundException(
          'El trabajador no tiene una relación laboral activa en esta comunidad.',
        );
      }
      employmentId = employment.id;
      assignedName = `${employment.person.firstName} ${employment.person.lastName}`;
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceIncident.update({
        where: { id: incident.id },
        data: {
          assignedEmploymentId: employmentId,
          assignedName,
          assignedAt: now,
          status: ServiceIncidentStatus.WORKER_ASSIGNED,
        },
      });
      await tx.serviceIncidentHistory.create({
        data: {
          communityId,
          incidentId,
          actorUserId,
          status: ServiceIncidentStatus.WORKER_ASSIGNED,
          assignedName,
          note: `Incidencia asignada a ${assignedName}.`,
          occurredAt: now,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'SERVICE_INCIDENT_ASSIGNED',
        'ServiceIncident',
        incidentId,
        `Incidencia asignada a ${assignedName}`,
        updated,
      );
      return updated;
    });
    return result;
  }

  async updateIncidentStatus(
    communityId: string,
    actorUserId: string,
    incidentId: string,
    input: UpdateIncidentStatusDto,
  ) {
    const allowed: ServiceIncidentStatus[] = [
      ServiceIncidentStatus.IN_REVIEW,
      ServiceIncidentStatus.IN_EXECUTION,
      ServiceIncidentStatus.RESOLVED,
    ];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException(
        'Recibida y Trabajador asignado son estados automáticos.',
      );
    }
    await this.incident(communityId, incidentId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceIncident.update({
        where: { id: incidentId },
        data: { status: input.status },
      });
      await tx.serviceIncidentHistory.create({
        data: {
          communityId,
          incidentId,
          actorUserId,
          status: input.status,
          assignedName: updated.assignedName,
          note: input.note?.trim() || `Estado actualizado a ${input.status}.`,
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'SERVICE_INCIDENT_STATUS_UPDATED',
        'ServiceIncident',
        incidentId,
        'Estado de incidencia actualizado',
        updated,
      );
      return updated;
    });
  }

  async createOwnerAuthorization(
    communityId: string,
    userId: string,
    input: CreateOwnerAuthorizationDto,
  ) {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { personId: true },
    });
    if (!user?.personId) throw new NotFoundException('El usuario no tiene un propietario asociado.');

    const ownership = await this.prisma.ownership.findFirst({
      where: {
        communityId,
        personId: user.personId,
        status: LifecycleStatus.ACTIVE,
        startsOn: { lte: new Date() },
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        ...(input.propertyId ? { propertyId: input.propertyId } : {}),
        property: { status: RecordStatus.ACTIVE },
      },
      select: { propertyId: true },
    });
    if (!ownership) throw new ForbiddenException('Solo un propietario activo puede emitir autorizaciones.');

    const validFrom = new Date(input.validFrom);
    const validUntil = new Date(input.validUntil);
    if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime()) || validUntil <= validFrom) {
      throw new BadRequestException('La vigencia de la autorización no es válida.');
    }
    const secret = randomBytes(32).toString('base64url');
    const qrTokenHash = this.hashQrSecret(secret);
    const requestedVehicles = (input.vehicles ?? [])
      .map((vehicle) => ({
        brand: vehicle.brand?.trim() || null,
        model: vehicle.model?.trim() || null,
        color: vehicle.color?.trim() || null,
        plate: vehicle.plate?.trim().toUpperCase() || null,
      }))
      .filter((vehicle) => vehicle.brand || vehicle.model || vehicle.color || vehicle.plate);
    const vehicles = requestedVehicles.length
      ? requestedVehicles
      : [{
          brand: input.vehicleBrand?.trim() || null,
          model: input.vehicleModel?.trim() || null,
          color: input.vehicleColor?.trim() || null,
          plate: input.vehiclePlate?.trim().toUpperCase() || null,
        }].filter((vehicle) => vehicle.brand || vehicle.model || vehicle.color || vehicle.plate);
    const primaryVehicle = vehicles[0];
    const authorization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceAuthorization.create({
        data: {
          communityId,
          propertyId: ownership.propertyId,
          ownerPersonId: user.personId!,
          type: input.type,
          subject: input.subject.trim(),
          validFrom,
          validUntil,
          qrTokenHash,
          qrIssuedAt: new Date(),
          vehicleBrand: primaryVehicle?.brand ?? null,
          vehicleModel: primaryVehicle?.model ?? null,
          vehicleColor: primaryVehicle?.color ?? null,
          vehiclePlate: primaryVehicle?.plate ?? null,
          workDescription: input.workDescription?.trim() || null,
          authorizedPeople: {
            create: input.authorizedPeople.map((person) => ({
              firstName: person.firstName.trim(),
              lastName: person.lastName.trim(),
              documentNumber: person.documentNumber.trim().toUpperCase(),
            })),
          },
          vehicles: { create: vehicles },
        },
        include: { authorizedPeople: true, vehicles: true },
      });
      const { qrTokenHash: _qrTokenHash, ...auditAuthorization } = created;
      await this.audit(tx, communityId, userId, 'SERVICE_AUTHORIZATION_CREATED', 'ServiceAuthorization', created.id, 'Autorización emitida por propietario', auditAuthorization);
      return created;
    });

    // The secret is returned once. Only its hash is persisted, so database
    // readers cannot reconstruct a usable QR.
    const { qrTokenHash: _qrTokenHash, ...publicAuthorization } = authorization;
    return { ...publicAuthorization, qrPayload: `CASA1.${authorization.id}.${secret}` };
  }

  async listOwnerAuthorizations(communityId: string, userId: string) {
    const owner = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { personId: true },
    });
    if (!owner?.personId) {
      throw new NotFoundException('El usuario no tiene un propietario asociado.');
    }

    // Resolve the owner's active properties first. Both predicates are
    // intentional: communityId prevents cross-community leakage and
    // ownerPersonId prevents one owner from reading another owner's records.
    const ownerships = await this.prisma.ownership.findMany({
      where: {
        communityId,
        personId: owner.personId,
        status: LifecycleStatus.ACTIVE,
        startsOn: { lte: new Date() },
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        property: { status: RecordStatus.ACTIVE },
      },
      select: { propertyId: true },
    });
    const propertyIds = ownerships.map(({ propertyId }) => propertyId);
    if (!propertyIds.length) {
      throw new ForbiddenException('Solo un propietario activo puede consultar sus autorizaciones.');
    }

    return this.prisma.serviceAuthorization.findMany({
      where: {
        communityId,
        ownerPersonId: owner.personId,
        propertyId: { in: propertyIds },
      },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        type: true,
        subject: true,
        validFrom: true,
        validUntil: true,
        issuedAt: true,
        status: true,
        vehicleBrand: true,
        vehicleModel: true,
        vehicleColor: true,
        vehiclePlate: true,
        workDescription: true,
        exitPurpose: true,
        exitItems: true,
        rejectionReason: true,
        decidedAt: true,
        property: { select: { id: true, code: true } },
        authorizedPeople: true,
        vehicles: true,
      },
    });
  }

  async regenerateOwnerAuthorizationQr(
    communityId: string,
    userId: string,
    authorizationId: string,
  ) {
    const owner = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { personId: true },
    });
    if (!owner?.personId) {
      throw new NotFoundException('El usuario no tiene un propietario asociado.');
    }

    const ownerships = await this.prisma.ownership.findMany({
      where: {
        communityId,
        personId: owner.personId,
        status: LifecycleStatus.ACTIVE,
        startsOn: { lte: new Date() },
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        property: { status: RecordStatus.ACTIVE },
      },
      select: { propertyId: true },
    });
    if (!ownerships.length) {
      throw new ForbiddenException('Solo un propietario activo puede emitir códigos QR.');
    }

    const authorization = await this.prisma.serviceAuthorization.findFirst({
      where: {
        id: authorizationId,
        communityId,
        ownerPersonId: owner.personId,
        propertyId: { in: ownerships.map(({ propertyId }) => propertyId) },
      },
      include: { authorizedPeople: true },
    });
    if (!authorization) {
      throw new NotFoundException('La autorización no pertenece al propietario o comunidad seleccionados.');
    }

    const secret = randomBytes(32).toString('base64url');
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.serviceAuthorization.update({
        where: { id: authorization.id },
        data: { qrTokenHash: this.hashQrSecret(secret), qrIssuedAt: new Date() },
        include: { authorizedPeople: true, vehicles: true },
      });
      const { qrTokenHash: _qrTokenHash, ...auditAuthorization } = next;
      await this.audit(
        tx,
        communityId,
        userId,
        'SERVICE_AUTHORIZATION_QR_REGENERATED',
        'ServiceAuthorization',
        authorization.id,
        'Código QR regenerado por el propietario; el código anterior quedó invalidado.',
        auditAuthorization,
      );
      return next;
    });

    const { qrTokenHash: _qrTokenHash, ...publicAuthorization } = updated;
    return { ...publicAuthorization, qrPayload: `CASA1.${updated.id}.${secret}` };
  }

  private async findValidAuthorization(communityId: string, qrPayload: string) {
    const parts = qrPayload.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'CASA1' || !parts[1] || !parts[2]) {
      throw new BadRequestException('El QR no tiene un formato CASA válido.');
    }
    const authorization = await this.prisma.serviceAuthorization.findFirst({
      where: { id: parts[1], communityId },
      include: {
        property: { select: { id: true, code: true } },
        owner: { select: { id: true, firstName: true, lastName: true, documentType: true, documentNumber: true } },
        authorizedPeople: true,
        vehicles: true,
        decidedBy: { select: { email: true, person: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!authorization?.qrTokenHash || !this.safeHashMatch(parts[2], authorization.qrTokenHash)) {
      throw new ForbiddenException('El QR no es válido para esta comunidad o ya fue invalidado.');
    }
    const now = new Date();
    if (authorization.status !== ServiceAuthorizationStatus.APPROVED) {
      throw new ForbiddenException(
        authorization.status === ServiceAuthorizationStatus.RECEIVED
          ? 'La autorización todavía está pendiente de aprobación.'
          : 'La autorización fue rechazada y no puede utilizarse.',
      );
    }
    if (now < authorization.validFrom) {
      throw new ForbiddenException('La autorización todavía no está vigente.');
    }
    if (now > authorization.validUntil) {
      throw new ForbiddenException('La autorización se encuentra fuera de vigencia.');
    }
    return authorization;
  }

  async scanAuthorizationQr(communityId: string, input: ScanAuthorizationQrDto) {
    const authorization = await this.findValidAuthorization(communityId, input.qrPayload);
    const { qrTokenHash: _qrTokenHash, ...publicAuthorization } = authorization;
    return { valid: true, authorization: publicAuthorization };
  }

  async confirmAuthorizationArrival(
    communityId: string,
    actorUserId: string,
    input: ScanAuthorizationQrDto,
  ) {
    const authorization = await this.findValidAuthorization(communityId, input.qrPayload);
    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.accessEvent.create({
        data: {
          communityId,
          authorizationId: authorization.id,
          propertyId: authorization.propertyId,
          direction: input.direction,
          subject: authorization.subject,
          source: 'QR',
          qrValidated: true,
          registeredById: actorUserId,
        },
      });
      await this.audit(tx, communityId, actorUserId, 'ACCESS_EVENT_QR_VALIDATED', 'AccessEvent', created.id, `QR validado (${input.direction})`, created);
      return created;
    });
    const { qrTokenHash: _qrTokenHash, ...publicAuthorization } = authorization;
    return { valid: true, event, authorization: publicAuthorization };
  }

  async registerAccessEvent(communityId: string, actorUserId: string, input: RegisterAccessEventDto) {
    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.accessEvent.create({
        data: {
          communityId,
          direction: input.direction,
          subject: input.subject.trim(),
          documentNumber: input.documentNumber?.trim().toUpperCase() || null,
          source: 'MANUAL',
          qrValidated: false,
          registeredById: actorUserId,
          notes: input.notes?.trim() || null,
        },
      });
      await this.audit(tx, communityId, actorUserId, 'ACCESS_EVENT_REGISTERED', 'AccessEvent', created.id, `Acceso manual registrado (${input.direction})`, created);
      return created;
    });
    return event;
  }

  async listAccessEvents(communityId: string) {
    return this.prisma.accessEvent.findMany({
      where: { communityId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      include: {
        property: { select: { id: true, code: true } },
        authorization: { select: { id: true, subject: true, validUntil: true } },
        registeredBy: { select: { email: true } },
      },
    });
  }

  private hashQrSecret(secret: string) {
    return createHash('sha256').update(secret).digest('hex');
  }

  private safeHashMatch(secret: string, expectedHash: string) {
    const actual = Buffer.from(this.hashQrSecret(secret), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async listAuthorizations(
    communityId: string,
    query: AuthorizationListQueryDto,
  ) {
    const where: Prisma.ServiceAuthorizationWhereInput = {
      communityId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search } },
              { property: { code: { contains: query.search } } },
              { owner: { firstName: { contains: query.search } } },
              { owner: { lastName: { contains: query.search } } },
              { owner: { documentNumber: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.serviceAuthorization.count({ where }),
      this.prisma.serviceAuthorization.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { issuedAt: 'desc' },
        include: {
          property: { select: { id: true, code: true } },
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              documentType: true,
              documentNumber: true,
            },
          },
          authorizedPeople: true,
          decidedBy: {
            select: {
              email: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);
    return this.page(items, total, query);
  }

  async approveAuthorization(
    communityId: string,
    actorUserId: string,
    authorizationId: string,
  ) {
    return this.decideAuthorization(
      communityId,
      actorUserId,
      authorizationId,
      ServiceAuthorizationStatus.APPROVED,
    );
  }

  async rejectAuthorization(
    communityId: string,
    actorUserId: string,
    authorizationId: string,
    input: RejectAuthorizationDto,
  ) {
    return this.decideAuthorization(
      communityId,
      actorUserId,
      authorizationId,
      ServiceAuthorizationStatus.REJECTED,
      input.reason.trim(),
    );
  }

  async listCommunications(
    communityId: string,
    query: CommunicationListQueryDto,
  ) {
    const where: Prisma.CommunityCommunicationWhereInput = {
      communityId,
      status: CommunicationStatus.PUBLISHED,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search } },
              { body: { contains: query.search } },
              { audienceLabel: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [total, communications] = await Promise.all([
      this.prisma.communityCommunication.count({ where }),
      this.prisma.communityCommunication.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { publishedAt: 'desc' },
        include: {
          publishedBy: {
            select: {
              email: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
          _count: { select: { recipients: true } },
        },
      }),
    ]);
    const ids = communications.map((item) => item.id);
    const counts = ids.length
      ? await this.prisma.communicationRecipient.groupBy({
          by: ['communicationId', 'status'],
          where: { communityId, communicationId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    return this.page(
      communications.map((item) => ({
        ...item,
        recipientCount: item._count.recipients,
        readCount: counts
          .filter(
            (count) =>
              count.communicationId === item.id &&
              count.status === CommunicationDeliveryStatus.READ,
          )
          .reduce((sum, count) => sum + count._count._all, 0),
      })),
      total,
      query,
    );
  }

  async communicationDetail(
    communityId: string,
    communicationId: string,
    query: CommunicationDetailQueryDto,
  ) {
    const communication = await this.prisma.communityCommunication.findFirst({
      where: {
        id: communicationId,
        communityId,
        status: CommunicationStatus.PUBLISHED,
      },
      include: {
        publishedBy: {
          select: {
            email: true,
            person: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!communication) {
      throw new NotFoundException(
        'El comunicado no pertenece a la comunidad seleccionada.',
      );
    }
    const recipientWhere: Prisma.CommunicationRecipientWhereInput = {
      communityId,
      communicationId,
      ...(query.search
        ? {
            OR: [
              { property: { code: { contains: query.search } } },
              { person: { firstName: { contains: query.search } } },
              { person: { lastName: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [total, recipients] = await Promise.all([
      this.prisma.communicationRecipient.count({ where: recipientWhere }),
      this.prisma.communicationRecipient.findMany({
        where: recipientWhere,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [
          { property: { code: 'asc' } },
          { person: { lastName: 'asc' } },
        ],
        include: {
          property: { select: { id: true, code: true } },
          person: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);
    return {
      ...communication,
      recipients: this.page(recipients, total, query),
    };
  }

  async publishCommunication(
    communityId: string,
    actorUserId: string,
    input: PublishCommunicationDto,
  ) {
    const propertyIds = [...new Set(input.propertyIds ?? [])];
    const propertyWhere: Prisma.PropertyWhereInput = {
      communityId,
      status: RecordStatus.ACTIVE,
    };
    let audienceLabel = 'Todos los propietarios';
    if (input.audienceType === CommunicationAudienceType.SECTOR) {
      if (!input.sectorId) {
        throw new BadRequestException('Selecciona un sector.');
      }
      const sector = await this.prisma.propertyLocation.findFirst({
        where: {
          id: input.sectorId,
          communityId,
          status: RecordStatus.ACTIVE,
        },
      });
      if (!sector) {
        throw new NotFoundException(
          'El sector no pertenece a la comunidad seleccionada.',
        );
      }
      propertyWhere.locationId = sector.id;
      audienceLabel = sector.name;
    } else if (
      input.audienceType === CommunicationAudienceType.OWNER ||
      input.audienceType === CommunicationAudienceType.GROUP
    ) {
      if (!propertyIds.length) {
        throw new BadRequestException(
          'Selecciona al menos un inmueble destinatario.',
        );
      }
      propertyWhere.id = { in: propertyIds };
      audienceLabel =
        input.audienceType === CommunicationAudienceType.OWNER
          ? 'Propietario seleccionado'
          : `${propertyIds.length} inmueble(s) seleccionado(s)`;
    }
    const ownerships = await this.prisma.ownership.findMany({
      where: {
        communityId,
        status: LifecycleStatus.ACTIVE,
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        property: propertyWhere,
      },
      select: {
        propertyId: true,
        personId: true,
        property: { select: { code: true } },
        person: { select: { firstName: true, lastName: true } },
      },
    });
    if (!ownerships.length) {
      throw new ConflictException(
        'La audiencia seleccionada no tiene propietarios activos.',
      );
    }
    if (
      input.audienceType === CommunicationAudienceType.OWNER &&
      ownerships.length
    ) {
      audienceLabel = `${ownerships[0].person.firstName} ${ownerships[0].person.lastName} · ${ownerships[0].property.code}`;
    }
    const recipients = [
      ...new Map(
        ownerships.map((item) => [
          `${item.propertyId}:${item.personId}`,
          { propertyId: item.propertyId, personId: item.personId },
        ]),
      ).values(),
    ];
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const communication = await tx.communityCommunication.create({
        data: {
          communityId,
          title: input.title.trim(),
          body: input.body.trim(),
          audienceType: input.audienceType,
          audienceLabel,
          status: CommunicationStatus.PUBLISHED,
          publishedByUserId: actorUserId,
          publishedAt: now,
          recipients: {
            create: recipients.map((recipient) => ({
              communityId,
              propertyId: recipient.propertyId,
              personId: recipient.personId,
              status: CommunicationDeliveryStatus.RECEIVED,
              receivedAt: now,
            })),
          },
        },
        include: { _count: { select: { recipients: true } } },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'COMMUNICATION_PUBLISHED',
        'CommunityCommunication',
        communication.id,
        `Comunicado publicado a ${communication._count.recipients} destinatario(s)`,
        communication,
      );
      return {
        ...communication,
        recipientCount: communication._count.recipients,
        readCount: 0,
      };
    });
  }

  async markRecipientRead(
    communityId: string,
    communicationId: string,
    recipientId: string,
  ) {
    const recipient = await this.prisma.communicationRecipient.findFirst({
      where: { id: recipientId, communicationId, communityId },
    });
    if (!recipient) {
      throw new NotFoundException(
        'El destinatario no pertenece a este comunicado.',
      );
    }
    if (recipient.status === CommunicationDeliveryStatus.READ) return recipient;
    return this.prisma.communicationRecipient.update({
      where: { id: recipient.id },
      data: {
        status: CommunicationDeliveryStatus.READ,
        readAt: new Date(),
      },
    });
  }

  private async incident(communityId: string, id: string) {
    const incident = await this.prisma.serviceIncident.findFirst({
      where: { id, communityId },
    });
    if (!incident) {
      throw new NotFoundException(
        'La incidencia no pertenece a la comunidad seleccionada.',
      );
    }
    return incident;
  }

  private async decideAuthorization(
    communityId: string,
    actorUserId: string,
    id: string,
    status: ServiceAuthorizationStatus,
    rejectionReason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const authorization = await tx.serviceAuthorization.findFirst({
        where: { id, communityId },
      });
      if (!authorization) {
        throw new NotFoundException(
          'La autorización no pertenece a la comunidad seleccionada.',
        );
      }
      if (authorization.status !== ServiceAuthorizationStatus.RECEIVED) {
        throw new ConflictException(
          'Esta autorización ya fue decidida y no puede procesarse nuevamente.',
        );
      }
      const updated = await tx.serviceAuthorization.update({
        where: { id },
        data: {
          status,
          rejectionReason: rejectionReason ?? null,
          decidedByUserId: actorUserId,
          decidedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        communityId,
        actorUserId,
        status === ServiceAuthorizationStatus.APPROVED
          ? 'SERVICE_AUTHORIZATION_APPROVED'
          : 'SERVICE_AUTHORIZATION_REJECTED',
        'ServiceAuthorization',
        id,
        status === ServiceAuthorizationStatus.APPROVED
          ? 'Autorización aprobada'
          : `Autorización rechazada: ${rejectionReason}`,
        updated,
      );
      return updated;
    });
  }

  private page<T>(
    items: T[],
    total: number,
    query: { page: number; pageSize: number },
  ) {
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private audit(
    client: PrismaService | Prisma.TransactionClient,
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
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      },
    });
  }

  async officialExchangeRate() {
    try {
      const response = await fetch(
        'https://ve.dolarapi.com/v1/dolares/oficial',
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error(`DolarAPI respondió ${response.status}`);

      const data = (await response.json()) as {
        moneda?: string;
        fuente?: string;
        nombre?: string;
        promedio?: number;
        fechaActualizacion?: string;
      };
      if (
        data.moneda !== 'USD' ||
        !Number.isFinite(data.promedio) ||
        Number(data.promedio) <= 0 ||
        !data.fechaActualizacion
      ) {
        throw new Error('DolarAPI devolvió una tasa incompleta.');
      }

      const updatedAt = new Date(data.fechaActualizacion);
      if (Number.isNaN(updatedAt.getTime())) throw new Error('Fecha de tasa inválida.');
      const date = new Intl.DateTimeFormat('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(updatedAt).replace(/\//g, '-');

      return {
        moneda: data.moneda,
        fuente: data.fuente ?? 'oficial',
        nombre: data.nombre ?? 'Dólar',
        promedio: Number(Number(data.promedio).toFixed(2)),
        fechaActualizacion: date,
        consultadaEn: new Date().toISOString(),
      };
    } catch (error) {
      throw new BadGatewayException(
        'No fue posible consultar la tasa oficial. Intenta nuevamente.',
        { cause: error },
      );
    }
  }

  private caracasDateKey(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  async officialExchangeRateForDate(dateKey?: string) {
    const todayDateKey = this.caracasDateKey(new Date());
    if (!dateKey || dateKey === todayDateKey) {
      return { ...(await this.officialExchangeRate()), historical: false, dateKey };
    }
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
      ? new Date(`${dateKey}T00:00:00.000Z`)
      : new Date(Number.NaN);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateKey) {
      throw new BadRequestException('La fecha solicitada debe tener formato AAAA-MM-DD.');
    }
    if (dateKey > todayDateKey) {
      throw new BadRequestException('No se puede consultar una tasa oficial para una fecha futura.');
    }

    try {
      const [year, month, day] = dateKey.split('-');
      const response = await fetch(
        `https://ve.dolarapi.com/v1/historicos/dolares/oficial/${year}/${month}/${day}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error(`DolarAPI respondió ${response.status}`);

      const data = (await response.json()) as {
        fuente?: string;
        promedio?: number;
        fecha?: string;
      };
      if (
        data.fuente !== 'oficial' ||
        !Number.isFinite(data.promedio) ||
        Number(data.promedio) <= 0 ||
        data.fecha !== dateKey
      ) {
        throw new Error('DolarAPI no devolvió una tasa oficial válida para la fecha solicitada.');
      }

      return {
        moneda: 'USD',
        fuente: data.fuente,
        nombre: 'Dólar',
        promedio: Number(Number(data.promedio).toFixed(2)),
        fechaActualizacion: dateKey,
        consultadaEn: new Date().toISOString(),
        historical: true,
        dateKey,
      };
    } catch (error) {
      throw new BadGatewayException(
        'No fue posible consultar la tasa oficial histórica para la fecha del pago.',
        { cause: error },
      );
    }
  }

  /**
   * Public or auth endpoint for submitting owner access request.
   * Generates unique folio, sanitizes text inputs, and dispatches server-side receipt email.
   */
  async createRegistrationRequest(input: CreateOwnerAccessRequestDto) {
    const folioNumber = `FOL-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const id = `req-${randomUUID()}`;
    const createdAt = new Date().toISOString();

    const requestData = {
      id,
      folioNumber,
      docType: input.docType,
      docNumber: input.docNumber,
      fullName: input.fullName,
      propertyCode: input.propertyCode,
      email: input.email,
      phone: input.phone,
      status: 'PENDING' as const,
      createdAt,
    };

    // Dispatch server-side confirmation email with folio
    await this.mailService.sendRegistrationReceiptEmail(requestData);

    return {
      message: 'Solicitud de registro creada exitosamente en el servidor y correo despachado con el número de folio.',
      request: requestData,
    };
  }

  async listRegistrationRequests(communityId: string) {
    return this.prisma.ownerRegistrationRequest.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, communityId: true, folioNumber: true, docType: true, docNumber: true,
        fullName: true, propertyCode: true, email: true, phone: true, status: true,
        personId: true, rejectionReason: true, approvedAt: true, rejectedAt: true,
        createdAt: true, updatedAt: true,
        identityDocumentExpiresAt: true,
        identityDocumentSizeBytes: true,
      },
    });
  }

  async registrationIdentityDocument(communityId: string, requestId: string) {
    const request = await this.prisma.ownerRegistrationRequest.findFirst({
      where: { id: requestId, communityId, status: { not: 'REJECTED' } },
      select: { identityDocumentKey: true, identityDocumentVersionId: true, identityDocumentExpiresAt: true },
    });
    if (!request?.identityDocumentKey || !request.identityDocumentVersionId ||
      !request.identityDocumentExpiresAt || request.identityDocumentExpiresAt <= new Date()) {
      throw new NotFoundException('El documento no está disponible.');
    }
    return this.s3.readPrivateObject(request.identityDocumentKey, request.identityDocumentVersionId);
  }

  private async removeRegistrationIdentityDocument(requestId: string) {
    const request = await this.prisma.ownerRegistrationRequest.findUnique({
      where: { id: requestId },
      select: { identityDocumentKey: true, identityDocumentVersionId: true },
    });
    if (!request?.identityDocumentKey || !request.identityDocumentVersionId) return;
    await this.s3.deletePrivateObject(request.identityDocumentKey, request.identityDocumentVersionId);
    await this.prisma.ownerRegistrationRequest.updateMany({
      where: { id: requestId, identityDocumentKey: request.identityDocumentKey, identityDocumentVersionId: request.identityDocumentVersionId },
      data: { identityDocumentKey: null, identityDocumentVersionId: null, identityDocumentExpiresAt: null, identityDocumentSizeBytes: null },
    });
  }

  private async registrationRequestForCommunity(communityId: string, requestId: string) {
    const request = await this.prisma.ownerRegistrationRequest.findFirst({
      where: { id: requestId, communityId },
    });
    if (!request) throw new NotFoundException('La solicitud no existe en esta comunidad.');
    return request;
  }

  /**
   * Approves an owner access request in the backend.
   * Creates AppUser with hashed PIN as password, links Person, creates CommunityAccess,
   * and sends approval email with the temp PIN.
   */
  async approveRegistrationRequest(
    communityId: string,
    actorUserId: string,
    requestId: string,
    requestData: {
      email: string;
      fullName: string;
      propertyCode: string;
      folioNumber: string;
      docType?: string;
      docNumber?: string;
      personId?: string;
      propertyId?: string;
      emailResolution?: 'KEEP_EXISTING' | 'USE_REQUEST_EMAIL';
    },
  ) {
    const registration = await this.registrationRequestForCommunity(communityId, requestId);
    if (registration.status !== 'PENDING') throw new ConflictException('La solicitud ya fue procesada.');
    requestData = {
      ...requestData,
      ...registration,
      personId: requestData.personId,
      propertyId: requestData.propertyId,
      emailResolution: requestData.emailResolution,
    };
    const email = requestData.email.trim().toLowerCase();

    // 1. Find the property by code in this community
    const property = await this.prisma.property.findFirst({
      where: requestData.propertyId
        ? { id: requestData.propertyId, communityId, status: RecordStatus.ACTIVE }
        : { code: requestData.propertyCode, communityId, status: RecordStatus.ACTIVE },
    });
    if (!property) {
      throw new NotFoundException(
        `No se encontró el inmueble con código "${requestData.propertyCode}" en esta comunidad.`,
      );
    }

    // 2. Resolve the Person profile
    let person = null;

    if (requestData.personId) {
      const communityPerson = await this.prisma.communityPerson.findFirst({
        where: {
          communityId,
          personId: requestData.personId,
          status: RecordStatus.ACTIVE,
        },
        include: { person: true },
      });
      if (!communityPerson) {
        throw new NotFoundException('La persona seleccionada no pertenece al directorio activo de esta comunidad.');
      }
      person = communityPerson.person;
    } else if (requestData.docType && requestData.docNumber) {
      const sanitizedDoc = requestData.docNumber.replace(/[^a-zA-Z0-9]/g, '');
      const candidates = await this.prisma.communityPerson.findMany({
        where: {
          communityId,
          status: RecordStatus.ACTIVE,
          person: { documentType: requestData.docType as DocumentType },
        },
        include: { person: true },
      });
      person = candidates.find((candidate) =>
        candidate.person.documentNumber.replace(/[^a-zA-Z0-9]/g, '') === sanitizedDoc,
      )?.person ?? null;
    }

    if (!person) {
      throw new BadRequestException(
        'No se pudo encontrar ninguna persona en el directorio de la comunidad que coincida con el documento ingresado. Por favor, realiza una vinculación manual.',
      );
    }

    // 3. Verify active ownership relationship
    let ownership = await this.prisma.ownership.findFirst({
      where: {
        communityId,
        propertyId: property.id,
        personId: person.id,
        status: LifecycleStatus.ACTIVE,
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
      },
    });

    if (!ownership) {
      ownership = await this.prisma.$transaction(async (tx) => {
        const activeOwnerships = await tx.ownership.findMany({
          where: {
            communityId,
            propertyId: property.id,
            status: LifecycleStatus.ACTIVE,
            OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
          },
          select: { ownershipPercentage: true },
        });
        const assigned = activeOwnerships.reduce(
          (total, item) => total + item.ownershipPercentage.toNumber(),
          0,
        );
        const available = 100 - assigned;
        if (available <= 0.00005) {
          throw new ConflictException(
            `El inmueble "${requestData.propertyCode}" ya tiene el 100% de su titularidad asignada.`,
          );
        }
        return tx.ownership.create({
          data: {
            communityId,
            propertyId: property.id,
            personId: person.id,
            ownershipPercentage: new Prisma.Decimal(available),
            startsOn: new Date(),
            status: LifecycleStatus.ACTIVE,
          },
        });
      });
      this.logger.log(
        `[Approve] Titularidad creada automáticamente para ${person.id} en inmueble ${property.id}.`,
      );
    }

    // A pre-existing account has a canonical login email bound to the Person
    // record.  Deliver the PIN there; the email supplied in a later request
    // must not silently replace that identity.
    const existingAccountForPerson = await this.prisma.appUser.findUnique({
      where: { personId: person.id },
      select: { email: true },
    });
    const hasEmailConflict =
      existingAccountForPerson && existingAccountForPerson.email !== email;
    if (hasEmailConflict && !requestData.emailResolution) {
      throw new ConflictException({
        code: 'OWNER_EMAIL_CONFLICT',
        message: 'La persona ya tiene un correo registrado. Elige cuál conservar.',
        existingEmail: existingAccountForPerson.email,
        requestedEmail: email,
      });
    }
    const accessEmail =
      hasEmailConflict && requestData.emailResolution === 'KEEP_EXISTING'
        ? existingAccountForPerson!.email
        : email;

    // 4. Generate secure temp PIN and dispatch approval email
    const mailResult = await this.mailService.processApprovalAndSendEmail({
      folioNumber: requestData.folioNumber,
      email: accessEmail,
      fullName: `${person.firstName} ${person.lastName}`.trim(),
      propertyCode: property.code,
    }, { existingAccount: Boolean(existingAccountForPerson) });

    // 5. Hash the PIN to use as the initial password
    const passwordHash = mailResult.tempPin
      ? await this.passwords.hash(mailResult.tempPin)
      : null;

    // 6. Create or update AppUser within a transaction
    await this.prisma.$transaction(async (tx) => {
      // An owner can already have an account under a previous email.  AppUser has
      // a unique personId, so resolving only by the requested email attempts to
      // create a second account and violates AppUser_personId_key.
      const [userByEmail, userByPerson] = await Promise.all([
        tx.appUser.findUnique({ where: { email } }),
        tx.appUser.findUnique({ where: { personId: person.id } }),
      ]);
      if (
        userByEmail &&
        userByEmail.personId !== null &&
        userByEmail.personId !== person.id
      ) {
        throw new ConflictException(
          'El correo solicitado ya pertenece a otra cuenta. Actualiza el correo antes de aprobar la solicitud.',
        );
      }
      const existingUser = userByPerson ?? userByEmail;

      // Ensure Person has a CommunityPerson relation
      const cp = await tx.communityPerson.findFirst({
        where: { communityId, personId: person.id },
      });
      if (!cp) {
        await tx.communityPerson.create({
          data: {
            communityId,
            personId: person.id,
            status: RecordStatus.ACTIVE,
          },
        });
      }

      if (existingUser) {
        // When this is the account already tied to the selected person, do not
        // rewrite personId/email.  AppUser -> Person uses the composite foreign
        // key (personId, email); changing only the account email breaks that FK
        // whenever the request email differs from the directory email.
        if (hasEmailConflict && requestData.emailResolution === 'USE_REQUEST_EMAIL') {
          await tx.person.update({ where: { id: person.id }, data: { email } });
        }
        if (existingUser.personId === null) {
          const personEmail = person.email?.trim().toLowerCase();
          if (personEmail !== email) {
            throw new ConflictException(
              'El correo de la solicitud no coincide con el correo principal de la persona seleccionada. Actualiza primero el directorio de la comunidad.',
            );
          }
        }
        await tx.appUser.update({
          where: { id: existingUser.id },
          data: {
            ...(passwordHash
              ? { passwordHash, passwordSetAt: new Date() }
              : {}),
            status: AccessStatus.ACTIVE,
            ...(existingUser.personId === null ? { personId: person.id } : {}),
          },
        });

        // Ensure CommunityAccess exists
        const existingAccess = await tx.communityAccess.findFirst({
          where: { userId: existingUser.id, communityId },
        });
        if (!existingAccess) {
          await tx.communityAccess.create({
            data: {
              userId: existingUser.id,
              communityId,
              roleCode: 'OWNER',
              scopes: [],
              status: AccessStatus.ACTIVE,
              startsOn: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago to prevent clock drift
              endsOn: null,
            },
          });
        } else {
          await tx.communityAccess.update({
            where: { id: existingAccess.id },
            data: {
              status: AccessStatus.ACTIVE,
              startsOn: new Date(Date.now() - 1000 * 60 * 10), // Reset start date
              endsOn: null, // Clear endsOn
            },
          });
        }

        this.logger.log(
          `[Approve] AppUser ${existingUser.id} actualizado con nuevo PIN para ${email} y vinculado a persona ${person.id}`,
        );
      } else {
        // Create new AppUser linked to person
        if (!passwordHash) {
          throw new ConflictException(
            'No se pudo generar la credencial temporal para la nueva cuenta de propietario.',
          );
        }
        const personEmail = person.email?.trim().toLowerCase();
        if (personEmail && personEmail !== email) {
          throw new ConflictException(
            'El correo de la solicitud no coincide con el correo principal de la persona seleccionada. Actualiza primero el directorio de la comunidad.',
          );
        }
        if (!personEmail) {
          await tx.person.update({
            where: { id: person.id },
            data: { email },
          });
        }
        const newUser = await tx.appUser.create({
          data: {
            email,
            passwordHash,
            status: AccessStatus.ACTIVE,
            personId: person.id,
          },
        });

        // Create CommunityAccess for the owner
        await tx.communityAccess.create({
          data: {
            userId: newUser.id,
            communityId,
            roleCode: 'OWNER',
            scopes: [],
            status: AccessStatus.ACTIVE,
            startsOn: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago to prevent clock drift
            endsOn: null,
          },
        });

        this.logger.log(
          `[Approve] Nuevo AppUser ${newUser.id} creado para ${email} en comunidad ${communityId} y vinculado a persona ${person.id}`,
        );
      }

      // Audit event
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'OWNER_ACCESS_REQUEST_APPROVED',
        'OwnerAccessRequest',
        requestId,
        `Solicitud de registro ${requestData.folioNumber} aprobada. AppUser creado/actualizado, vinculado a persona ${person.id} y PIN temporal enviado al propietario.`,
        { requestId, status: 'APPROVED', approvedAt: new Date().toISOString() },
      );
      await tx.ownerRegistrationRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          personId: person.id,
          fullName: `${person.firstName} ${person.lastName}`.trim(),
          docType: person.documentType,
          docNumber: person.documentNumber,
          propertyCode: property.code,
          approvedAt: new Date(),
        },
      });
    });

    return {
      id: requestId,
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
      maskedPin: mailResult.maskedPin,
      message: mailResult.tempPin
        ? 'Solicitud aprobada exitosamente. El PIN de acceso fue generado por el servidor y enviado confidencialmente al propietario.'
        : 'Solicitud aprobada exitosamente. La cuenta CASA existente conserva su contraseña y ahora también puede acceder al Portal del Propietario.',
    };
  }

  /**
   * Rejects an owner access request in the backend.
   */
  async rejectRegistrationRequest(
    communityId: string,
    actorUserId: string,
    requestId: string,
    reason: string,
    requestData: { email: string; fullName: string; propertyCode: string; folioNumber: string },
  ) {
    const registration = await this.registrationRequestForCommunity(communityId, requestId);
    if (registration.status !== 'PENDING') throw new ConflictException('La solicitud ya fue procesada.');
    requestData = { ...requestData, ...registration };
    const cleanReason = reason.trim() || 'Documentación no coincide con el expediente catastral.';

    await this.mailService.sendRejectionEmail({
      folioNumber: requestData.folioNumber,
      email: requestData.email,
      fullName: requestData.fullName,
      propertyCode: requestData.propertyCode,
      reason: cleanReason,
    });

    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'OWNER_ACCESS_REQUEST_REJECTED',
      'OwnerAccessRequest',
      requestId,
      `Solicitud de registro ${requestData.folioNumber} rechazada. Motivo: ${cleanReason}`,
      { requestId, status: 'REJECTED', rejectedAt: new Date().toISOString(), reason: cleanReason },
    );
    await this.prisma.ownerRegistrationRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', rejectionReason: cleanReason, rejectedAt: new Date() },
    });
    // A rejected request cannot retrieve the object; the retention worker retries
    // hard deletion if S3 is temporarily unavailable.
    await this.removeRegistrationIdentityDocument(requestId).catch(() => undefined);

    return {
      id: requestId,
      status: 'REJECTED',
      rejectedAt: new Date().toISOString(),
      reason: cleanReason,
      message: 'Solicitud rechazada exitosamente en el servidor.',
    };
  }

  /**
   * Resends a new secure temporary PIN to the owner's email address from backend.
   * Also updates the AppUser's passwordHash with the new PIN.
   */
  async resendPinRegistrationRequest(
    communityId: string,
    actorUserId: string,
    requestId: string,
    requestData: { email: string; fullName: string; propertyCode: string; folioNumber: string },
  ) {
    const registration = await this.registrationRequestForCommunity(communityId, requestId);
    if (registration.status !== 'APPROVED') throw new ConflictException('Sólo se puede reenviar el PIN de una solicitud aprobada.');
    requestData = { ...requestData, ...registration };
    const email = requestData.email.trim().toLowerCase();

    const existingUser = await this.prisma.appUser.findFirst({
      where: {
        OR: [
          { email },
          ...(registration.personId ? [{ personId: registration.personId }] : []),
        ],
      },
      select: { id: true, email: true, personId: true },
    });
    const activeEmployment = existingUser?.personId
      ? await this.prisma.employment.findFirst({
          where: {
            communityId,
            personId: existingUser.personId,
            status: LifecycleStatus.ACTIVE,
            OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
          },
          select: { id: true },
        })
      : null;
    const preserveExistingPassword = Boolean(activeEmployment);
    const deliveryEmail = existingUser?.email ?? email;
    const mailResult = await this.mailService.processApprovalAndSendEmail({
      folioNumber: requestData.folioNumber,
      email: deliveryEmail,
      fullName: requestData.fullName,
      propertyCode: requestData.propertyCode,
    }, { existingAccount: preserveExistingPassword });

    // Update AppUser's password with the new PIN hash
    if (existingUser && mailResult.tempPin) {
      const passwordHash = await this.passwords.hash(mailResult.tempPin);
      await this.prisma.appUser.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          passwordSetAt: new Date(),
        },
      });
      this.logger.log(
        `[Resend PIN] AppUser ${existingUser.id} actualizado con nuevo PIN para ${email}`,
      );
    } else {
      this.logger.warn(
        `[Resend PIN] No se encontró AppUser para ${email}. El propietario no podrá iniciar sesión.`,
      );
    }

    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'OWNER_ACCESS_REQUEST_PIN_RESENT',
      'OwnerAccessRequest',
      requestId,
      `Nuevo PIN temporal reenviado al correo ${email} para solicitud ${requestData.folioNumber}.`,
      { requestId, resentAt: new Date().toISOString() },
    );

    return {
      id: requestId,
      resentAt: new Date().toISOString(),
      maskedPin: mailResult.maskedPin,
      message: mailResult.tempPin
        ? 'Nuevo PIN temporal generado por el servidor y reenviado confidencialmente al correo del propietario.'
        : 'La cuenta CASA existente conserva su contraseña actual; el acceso al Portal del Propietario sigue habilitado.',
    };
  }

  /**
   * Revokes the owner's credentials/access ONLY for the current community.
   * Disables CommunityAccess, invalidates active sessions and tokens.
   */
  async revokeRegistrationRequest(
    communityId: string,
    actorUserId: string,
    requestId: string,
    emailInput: string,
  ) {
    await this.registrationRequestForCommunity(communityId, requestId);
    const email = emailInput.trim().toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({
        where: { email },
        include: {
          communities: {
            where: { communityId },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('No se encontró ningún usuario con ese correo.');
      }

      const access = user.communities[0];
      if (access) {
        // Set CommunityAccess status to REVOKED
        await tx.communityAccess.update({
          where: { id: access.id },
          data: {
            status: AccessStatus.REVOKED,
            endsOn: new Date(),
          },
        });

        // Terminate any active workspace assignments
        await tx.communityWorkspaceAssignment.updateMany({
          where: { accessId: access.id, status: LifecycleStatus.ACTIVE },
          data: {
            status: LifecycleStatus.ENDED,
            endsOn: new Date(),
            endReason: 'Acceso revocado por el administrador de la comunidad.',
          },
        });

        this.logger.log(`[Revoke] Acceso de comunidad revocado para usuario ${user.id} en la comunidad ${communityId}`);
      }

      // Invalidate current sessions & JWT tokens
      await tx.appUser.update({
        where: { id: user.id },
        data: { tokenVersion: { increment: 1 } },
      });

      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.audit(
        tx,
        communityId,
        actorUserId,
        'OWNER_ACCESS_REVOKED',
        'OwnerAccessRequest',
        requestId,
        `Acceso de comunidad revocado para el correo ${email}.`,
        { email, revokedAt: new Date().toISOString() },
      );
      await tx.ownerRegistrationRequest.update({
        where: { id: requestId },
        data: { status: 'PENDING', approvedAt: null },
      });

      return {
        id: requestId,
        status: 'REVOKED',
        revokedAt: new Date().toISOString(),
        message: 'Acceso revocado exitosamente para esta comunidad. Sesiones activas finalizadas.',
      };
    });
  }

  /**
   * Generates a new temporary invitation code for a community, expiring after ttlHours.
   * Automatically revokes any previous invitation codes for this community.
   */
  async generateInvitationCode(
    communityId: string,
    actorUserId: string,
    ttlHours: number,
  ) {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const codeLength = 6;
    let code = '';
    for (let i = 0; i < codeLength; i++) {
      const idx = randomInt(0, chars.length);
      code += chars[idx];
    }

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // Revoke existing active invitation codes
      await tx.communityInvitation.updateMany({
        where: {
          communityId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          revokedAt: new Date(),
        },
      });

      // Create new active invitation code
      const invitation = await tx.communityInvitation.create({
        data: {
          communityId,
          code,
          expiresAt,
          createdById: actorUserId,
        },
      });

      // Audit log
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'COMMUNITY_INVITATION_GENERATED',
        'CommunityInvitation',
        invitation.id,
        `Código de invitación temporal generado: ${code} (TTL: ${ttlHours}h, Expiración: ${expiresAt.toISOString()}).`,
        { code, expiresAt: expiresAt.toISOString(), ttlHours },
      );

      return invitation;
    });
  }

  /**
   * Gets the active invitation code for a community.
   */
  async getActiveInvitationCode(communityId: string) {
    return this.prisma.communityInvitation.findFirst({
      where: {
        communityId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Revokes the active invitation code for a community.
   */
  async revokeInvitationCode(communityId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.communityInvitation.findFirst({
        where: {
          communityId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!active) {
        return { message: 'No hay ningún código de invitación activo para revocar.' };
      }

      await tx.communityInvitation.update({
        where: { id: active.id },
        data: { revokedAt: new Date() },
      });

      // Audit log
      await this.audit(
        tx,
        communityId,
        actorUserId,
        'COMMUNITY_INVITATION_REVOKED',
        'CommunityInvitation',
        active.id,
        `Código de invitación temporal ${active.code} revocado de forma manual.`,
        { code: active.code, revokedAt: new Date().toISOString() },
      );

      return { message: 'Código de invitación revocado exitosamente.' };
    });
  }

  /**
   * Fetches real owner profile, active property, and latest issued charge notice/billing details.
   */
  async getOwnerPortalOverview(communityId: string, userId: string) {
    // 1. Get user and person info
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { person: true },
    });

    if (!user || !user.personId) {
      throw new NotFoundException('No se encontró el perfil personal del usuario.');
    }

    // 2. Find active ownership in the community
    const ownership = await this.prisma.ownership.findFirst({
      where: {
        personId: user.personId,
        communityId,
        status: 'ACTIVE',
        startsOn: { lte: new Date() },
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        property: { status: 'ACTIVE' },
      },
      include: {
        property: {
          include: {
            location: true,
          },
        },
      },
    });

    if (!ownership) {
      throw new NotFoundException(
        'Este usuario no está registrado como propietario activo de ningún inmueble en esta comunidad.',
      );
    }

    const property = ownership.property;

    // 3. Find all ISSUED charge notices in the community (newest to oldest)
    const allIssuedNotices = await this.prisma.chargeNotice.findMany({
      where: {
        communityId,
        status: 'ISSUED',
        allocations: { some: { propertyId: property.id } },
      },
      orderBy: {
        issuedAt: 'desc',
      },
      include: {
        billingPeriod: true,
        components: true,
        _count: { select: { allocations: true } },
      },
    });

    const noticesData = await Promise.all(
      allIssuedNotices.map(async (notice) => {
        const noticeAllocation = await this.prisma.chargeNoticeAllocation.findUnique({
          where: {
            chargeNoticeId_propertyId: {
              chargeNoticeId: notice.id,
              propertyId: property.id,
            },
          },
        });

        let noticeExpenses: any[] = [];
        if (notice) {
          noticeExpenses = await this.prisma.periodExpense.findMany({
            where: {
              billingPeriodId: notice.billingPeriodId,
              status: 'ACTIVE',
            },
            include: {
              concept: {
                include: {
                  category: true,
                },
              },
            },
          });
        }

        let outstandingVes = 0;
        let outstandingUsd = 0;
        if (noticeAllocation) {
          const alreadyApplied = await this.prisma.paymentApplication.aggregate({
            where: { chargeNoticeAllocationId: noticeAllocation.id },
            _sum: { functionalAmount: true },
          });
          const paidUsd = alreadyApplied._sum.functionalAmount ?? new Prisma.Decimal(0);
          const remUsd = Prisma.Decimal.max(new Prisma.Decimal(0), noticeAllocation.totalUsd.minus(paidUsd));
          outstandingUsd = Number(remUsd.toFixed(2));
          const rate = Number(notice.billingPeriod.bcvRate) || 1;
          outstandingVes = Number(remUsd.mul(rate).toFixed(2));
        }

        const propertyShares = (items: Array<{ amountVes: Prisma.Decimal; allocationMethod: string }>, total: Prisma.Decimal) => {
          const shares = items.map(item => (item.allocationMethod === 'FIXED'
            ? item.amountVes.div(notice._count.allocations)
            : item.amountVes.mul(noticeAllocation!.aliquotSnapshot).div(100)).toDecimalPlaces(2));
          if (shares.length) {
            const sum = shares.reduce((acc, share) => acc.add(share), new Prisma.Decimal(0));
            shares[shares.length - 1] = shares[shares.length - 1].add(total.sub(sum));
          }
          return shares;
        };
        const componentShares = noticeAllocation ? propertyShares(notice.components, noticeAllocation.componentShareVes) : [];
        const expenseShares = noticeAllocation ? propertyShares(noticeExpenses.map(e => ({
          amountVes: e.currency === 'USD' ? e.amount.mul(notice.billingPeriod.bcvRate) : e.amount,
          allocationMethod: e.allocationMethod,
        })), noticeAllocation.expenseShareVes) : [];

        const usdShares = [...expenseShares, ...componentShares].map(amount => amount.div(notice.billingPeriod.bcvRate).toDecimalPlaces(2));
        if (noticeAllocation && usdShares.length) {
          const roundedUsd = usdShares.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
          usdShares[usdShares.length - 1] = usdShares[usdShares.length - 1].add(noticeAllocation.totalUsd.sub(roundedUsd));
        }

        return {
          id: notice.id,
          billingPeriod: notice.billingPeriod.label,
          issuedAt: notice.issuedAt,
          bcvRate: Number(notice.billingPeriod.bcvRate),
          totalExpensesVes: Number(notice.totalExpensesVes),
          totalComponentsVes: Number(notice.totalComponentsVes),
          totalCommunityVes: Number(notice.totalCommunityVes),
          totalCommunityUsd: Number(notice.totalCommunityUsd),
          components: notice.components.map((c, index) => ({
            id: c.id,
            label: c.label,
            type: c.type,
            amountVes: Number(c.amountVes),
            allocationMethod: c.allocationMethod,
            propertyAmountVes: Number(componentShares[index] ?? 0),
            propertyAmountUsd: Number(usdShares[expenseShares.length + index] ?? 0),
          })),
          expenses: noticeExpenses.map((e, index) => ({
            id: e.id,
            description: e.description,
            amount: Number(e.amount),
            currency: e.currency,
            allocationMethod: e.allocationMethod,
            propertyAmountVes: Number(expenseShares[index] ?? 0),
            propertyAmountUsd: Number(usdShares[index] ?? 0),
            concept: {
              id: e.concept.id,
              name: e.concept.name,
              category: {
                id: e.concept.category.id,
                name: e.concept.category.name,
              },
            },
          })),
          allocation: noticeAllocation
            ? {
                id: noticeAllocation.id,
                aliquotSnapshot: Number(noticeAllocation.aliquotSnapshot),
                expenseShareVes: Number(noticeAllocation.expenseShareVes),
                componentShareVes: Number(noticeAllocation.componentShareVes),
                totalVes: Number(noticeAllocation.totalVes),
                totalUsd: Number(noticeAllocation.totalUsd),
                outstandingVes,
                outstandingUsd,
              }
            : null,
        };
      })
    );

    // 4. Load community info
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
    });

    // 5. Load bank accounts and payment methods
    const bankAccounts = await this.prisma.bankAccount.findMany({
      where: { communityId, status: 'ACTIVE' },
    });

    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { communityId, status: 'ACTIVE' },
      include: {
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            holder: true,
            holderRif: true,
            accountNumber: true,
            accountType: true,
            currency: true,
          },
        },
      },
    });

    const ownerPayments = await this.prisma.ownerPayment.findMany({
      where: { communityId, propertyId: property.id },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        paymentMethod: { select: { id: true, label: true, type: true, currency: true } },
        applications: {
          include: {
            chargeNoticeAllocation: {
              include: { chargeNotice: { select: { id: true, billingPeriod: { select: { label: true } } } } },
            },
          },
          orderBy: { appliedAt: 'asc' },
        },
      },
    });

    return {
      community: {
        id: community?.id,
        name: community?.name,
        legalName: community?.legalName,
        rif: community?.rif,
        bankAccounts: bankAccounts.map((b) => ({
          id: b.id,
          bankName: b.bankName,
          holder: b.holder,
          holderRif: b.holderRif,
          accountNumber: b.accountNumber,
          accountType: b.accountType,
          currency: b.currency,
        })),
        paymentMethods: paymentMethods.map((p) => ({
          id: p.id,
          type: p.type,
          label: p.label,
          currency: p.currency,
          bankAccountId: p.bankAccountId,
          bankAccount: p.bankAccount,
          mobilePhone: p.mobilePhone,
          mobileDocument: p.mobileDocument,
          instructions: p.instructions,
        })),
        phone: community?.phone,
        address: community?.address,
        city: community?.city,
        state: community?.state,
      },
      owner: {
        fullName: user.person ? `${user.person.firstName} ${user.person.lastName}` : user.email,
        email: user.email,
        docType: user.person?.documentType || 'V',
        docNumber: user.person?.documentNumber || '',
        phone: user.person?.phone || '',
      },
      property: {
        id: property.id,
        code: property.code,
        aliquot: property.currentAliquot ? Number(property.currentAliquot) : 0,
        tower: property.location?.name || 'Principal',
        parkingSpace: property.parkingSpace,
        parkingCapacity: property.parkingCapacity,
      },
      payments: ownerPayments.map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        status: payment.status,
        reportedAt: payment.reportedAt?.toISOString() ?? payment.createdAt.toISOString(),
        paidAt: payment.paidAt.toISOString(),
        appliedAt: payment.reconciledAt?.toISOString() ?? null,
        originalAmount: payment.originalAmount ? Number(payment.originalAmount) : null,
        originalCurrency: payment.originalCurrency,
        exchangeRate: Number(payment.exchangeRate),
        functionalAmount: payment.functionalAmount ? Number(payment.functionalAmount) : null,
        functionalCurrency: payment.functionalCurrency ?? 'USD',
        method: payment.paymentMethod?.label ?? 'Método no especificado',
        applications: payment.applications.map((application) => ({
          noticeId: application.chargeNoticeAllocation.chargeNotice.id,
          notice: application.chargeNoticeAllocation.chargeNotice.billingPeriod.label,
          applied: Number(application.functionalAmount),
          appliedAt: application.appliedAt.toISOString(),
        })),
      })),
      latestNotice: noticesData[0] || null,
      notices: noticesData,
    };
  }

  /**
   * Registers one owner-reported payment. Reconciliation, accounting and debt
   * application are deliberately separate future operations.
   */
  async reportPayment(
    communityId: string,
    userId: string,
    input: ReportPaymentDto,
  ) {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { person: true },
    });
    if (!user?.personId) {
      throw new NotFoundException('Usuario no válido o sin perfil personal.');
    }

    const [ownership, paymentMethod] = await Promise.all([
      this.prisma.ownership.findFirst({
        where: { personId: user.personId, communityId, status: 'ACTIVE' },
        include: { property: true },
      }),
      this.prisma.paymentMethod.findFirst({
        where: { id: input.paymentMethodId, communityId, status: 'ACTIVE' },
        include: { bankAccount: true },
      }),
    ]);
    if (!ownership) {
      throw new NotFoundException('El usuario no tiene un inmueble activo en esta comunidad.');
    }
    if (!paymentMethod) {
      throw new BadRequestException('El método de pago no pertenece a la comunidad.');
    }
    if (input.bankAccountId && input.bankAccountId !== paymentMethod.bankAccountId) {
      throw new BadRequestException('La cuenta bancaria no corresponde al método de pago seleccionado.');
    }
    if (input.currency !== paymentMethod.currency) {
      throw new BadRequestException('La moneda no corresponde al método de pago seleccionado.');
    }

    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt);
    const paidAt = isDateOnly
      ? new Date(`${input.paidAt}T04:00:00.000Z`)
      : new Date(input.paidAt);
    if (!Number.isFinite(paidAt.getTime())) {
      throw new BadRequestException('La fecha del pago no es válida.');
    }
    const paymentDateKey = isDateOnly
      ? input.paidAt
      : this.caracasDateKey(paidAt);
    const todayDateKey = this.caracasDateKey(new Date());
    if (isDateOnly && this.caracasDateKey(paidAt) !== input.paidAt) {
      throw new BadRequestException('La fecha del pago no es válida.');
    }
    if (paymentDateKey > todayDateKey) {
      throw new BadRequestException('La fecha efectiva del pago no puede ser futura.');
    }

    const originalAmount = new Prisma.Decimal(input.amount);
    const officialRate = input.currency === 'VES'
      ? await this.officialExchangeRateForDate(paymentDateKey)
      : null;
    const exchangeRateValue =
      input.currency === 'USD'
        ? 1
        : officialRate?.promedio ?? input.exchangeRate ?? 0;
    const exchangeRate = new Prisma.Decimal(exchangeRateValue);
    if (exchangeRate.lessThanOrEqualTo(0)) {
      throw new BadRequestException('No hay una tasa de cambio válida para la moneda seleccionada.');
    }
    const functionalAmount = originalAmount
      .div(exchangeRate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const exchangeRateDate = officialRate?.dateKey ?? paymentDateKey;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.ownerPayment.create({
        data: {
          communityId,
          propertyId: ownership.property.id,
          payerPersonId: user.personId,
          paymentMethodId: paymentMethod?.id ?? null,
          bankAccountId: paymentMethod.bankAccountId ?? null,
          exchangeRate,
          originalAmount,
          originalCurrency: input.currency,
          functionalAmount,
          functionalCurrency: 'USD',
          exchangeRateSource: officialRate
            ? officialRate.historical ? 'DOLARAPI_HISTORICAL' : 'DOLARAPI_OFICIAL'
            : 'OWNER_REPORTED',
          exchangeRateEffectiveAt: officialRate
            ? new Date(`${exchangeRateDate}T04:00:00.000Z`)
            : paidAt,
          exchangeRateReference: officialRate
            ? `DolarAPI oficial ${officialRate.historical ? 'histórica' : 'vigente'} · ${exchangeRateDate}`
            : exchangeRateDate,
          reference: input.reference.trim(),
          paidAt,
          notes: input.notes?.trim() || null,
          status: 'REPORTED',
          createdById: userId,
          reportedAt: new Date(),
          reportedById: userId,
        },
      });
      await this.audit(
        tx,
        communityId,
        userId,
        'OWNER_PAYMENT_REPORTED',
        'OwnerPayment',
        payment.id,
        `Pago reportado por el propietario para ${ownership.property.code}; pendiente de conciliación`,
        payment,
      );
      return payment;
    });
  }

  /* Retired stage-8 implementation. The payment report/application model no
   * longer keeps the legacy per-payment posting and allocation fields.
  private async reportPaymentLegacy(
    communityId: string,
    userId: string,
    input: ReportPaymentDto,
  ) {
    // 1. Resolve and validate the user and their active property ownership
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { person: true },
    });
    if (!user || !user.personId) {
      throw new NotFoundException('Usuario no válido o sin perfil personal.');
    }

    const ownership = await this.prisma.ownership.findFirst({
      where: {
        personId: user.personId,
        communityId,
        status: 'ACTIVE',
      },
      include: {
        property: true,
      },
    });
    if (!ownership) {
      throw new NotFoundException(
        'Este usuario no está registrado como propietario activo de ningún inmueble en esta comunidad.',
      );
    }

    const property = ownership.property;

    // 2. Validate target bank account and retrieve its ledger account
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, communityId, status: 'ACTIVE' },
    });
    if (!bankAccount) {
      throw new NotFoundException('La cuenta bancaria seleccionada no está activa en esta comunidad.');
    }

    const ledgerAccount = await this.prisma.ledgerAccount.findFirst({
      where: { bankAccountId: bankAccount.id, communityId, status: 'ACTIVE' },
    });
    if (!ledgerAccount) {
      throw new BadRequestException('La cuenta bancaria no tiene una cuenta contable asociada.');
    }
    const receiptAccountId = ledgerAccount.id;

    // 3. Resolve the accounts receivable ledger account from the latest notice
    const latestNotice = await this.prisma.chargeNotice.findFirst({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestNotice || !latestNotice.receivableAccountId) {
      throw new BadRequestException('No hay cuentas por cobrar configuradas en la comunidad.');
    }
    const receivableAccountId = latestNotice.receivableAccountId;

    // 4. Resolve the advance (pasivo de anticipo) account for overpayments
    const liabilityAccounts = await this.prisma.ledgerAccount.findMany({
      where: {
        communityId,
        type: 'LIABILITY',
        acceptsEntries: true,
        status: 'ACTIVE',
      },
    });
    const advanceAccount = liabilityAccounts.find(a => a.name.toLowerCase().includes('anticipo')) || liabilityAccounts[0];
    if (!advanceAccount) {
      throw new BadRequestException('No hay cuentas de pasivo de anticipos configuradas en la comunidad.');
    }

    // 5. Fetch current exchange rate (DolarAPI with fallback)
    let exchangeRate = 1.0;
    try {
      const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data.promedio === 'number' && data.promedio > 0) {
          exchangeRate = data.promedio;
        }
      }
    } catch {
      const latestNoticeWithRate = await this.prisma.chargeNotice.findFirst({
        where: { communityId },
        include: { billingPeriod: true },
        orderBy: { createdAt: 'desc' },
      });
      exchangeRate = latestNoticeWithRate?.billingPeriod?.bcvRate ? Number(latestNoticeWithRate.billingPeriod.bcvRate) : 40.0;
    }

    const decExchangeRate = new Prisma.Decimal(exchangeRate);
    const amount = new Prisma.Decimal(input.amount);
    
    // Convert payment currency to VES if it is USD
    const paymentCurrency = bankAccount.currency === 'USD' ? Currency.USD : Currency.VES;
    const amountVes = (paymentCurrency === Currency.USD 
      ? amount.mul(decExchangeRate) 
      : amount).toDecimalPlaces(2);

    // 6. Find all outstanding issued allocations for the property sorted chronologically (FIFO)
    const issuedAllocations = await this.prisma.chargeNoticeAllocation.findMany({
      where: {
        propertyId: property.id,
        chargeNotice: {
          communityId,
          status: 'ISSUED',
        },
      },
      include: {
        chargeNotice: true,
      },
      orderBy: {
        chargeNotice: {
          issuedAt: 'asc', // oldest first
        },
      },
    });

    const allocationsWithBalance = [];
    for (const alloc of issuedAllocations) {
      const alreadyApplied = await this.prisma.ownerPayment.aggregate({
        where: {
          communityId,
          chargeNoticeAllocationId: alloc.id,
          status: 'POSTED',
        },
        _sum: { appliedToNoticeVes: true },
      });
      const paid = alreadyApplied._sum.appliedToNoticeVes ?? new Prisma.Decimal(0);
      const outstanding = alloc.totalVes.minus(paid);
      if (outstanding.greaterThan(0)) {
        allocationsWithBalance.push({
          allocation: alloc,
          outstanding,
        });
      }
    }

    // 7. Perform FIFO distribution across outstanding allocations
    let remainingVes = amountVes;
    const paymentsToCreate: Array<{ allocation: any; appliedVes: Prisma.Decimal }> = [];

    for (const item of allocationsWithBalance) {
      if (remainingVes.lessThanOrEqualTo(0)) break;
      const applyVes = Prisma.Decimal.min(remainingVes, item.outstanding);
      paymentsToCreate.push({
        allocation: item.allocation,
        appliedVes: applyVes,
      });
      remainingVes = remainingVes.minus(applyVes);
    }

    // Any remaining amount becomes an advance (overpayment)
    const advanceVes = remainingVes;

    const paidAt = new Date(input.paidAt);

    // 8. Execute the payment creation in a database transaction
    return this.prisma.$transaction(async (tx) => {
      const periodKey = `${paidAt.getUTCFullYear()}-${String(
        paidAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      const startsOn = new Date(
        Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), 1),
      );
      const endsOn = new Date(
        Date.UTC(
          paidAt.getUTCFullYear(),
          paidAt.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ),
      );

      // Ensure the accounting period exists and is open
      const accountingPeriod = await tx.accountingPeriod.upsert({
        where: { communityId_periodKey: { communityId, periodKey } },
        create: {
          communityId,
          periodKey,
          label: `Período ${periodKey}`,
          startsOn,
          endsOn,
        },
        update: {},
      });
      if (accountingPeriod.status !== AccountingPeriodStatus.OPEN) {
        throw new ConflictException(
          'El período contable correspondiente al pago no está abierto.',
        );
      }

      await tx.communityAccountingSettings.upsert({
        where: { communityId },
        create: { communityId },
        update: {},
      });

      const results = [];

      // Case A: Payment distributed to one or more allocations
      if (paymentsToCreate.length > 0) {
        for (let i = 0; i < paymentsToCreate.length; i++) {
          const item = paymentsToCreate[i];
          const sequence = await tx.communityAccountingSettings.update({
            where: { communityId },
            data: {
              nextJournalNumber: { increment: 1 },
              nextReceiptNumber: { increment: 1 },
            },
          });

          // Calculate payment allocation share in functional/transaction currencies
          const paymentId = randomUUID();
          const allocShareVes = item.appliedVes;
          
          // For the last allocation in the list, we also add the advance amount if any
          const allocAdvanceVes = i === paymentsToCreate.length - 1 ? advanceVes : new Prisma.Decimal(0);
          const totalPartVes = allocShareVes.plus(allocAdvanceVes);
          
          const partAmount = paymentCurrency === Currency.USD ? totalPartVes.div(decExchangeRate) : totalPartVes;

          const journalEntry = await tx.journalEntry.create({
            data: {
              communityId,
              accountingPeriodId: accountingPeriod.id,
              entryNumber: sequence.nextJournalNumber - 1,
              entryDate: paidAt,
              description: `Pago recibido (FIFO) · Inmueble ${property.code}`,
              source: JournalEntrySource.PAYMENT,
              sourceId: paymentId,
              status: JournalEntryStatus.POSTED,
              postedAt: new Date(),
              postedById: userId,
              createdById: userId,
              lines: {
                create: [
                  {
                    communityId,
                    accountId: receiptAccountId,
                    lineNumber: 1,
                    description: `Ingreso ref: ${input.reference.trim()}`,
                    debit: totalPartVes,
                    credit: new Prisma.Decimal(0),
                    transactionAmount: partAmount,
                    transactionCurrency: paymentCurrency,
                    exchangeRate: decExchangeRate,
                    referenceType: 'OWNER_PAYMENT',
                    referenceId: paymentId,
                  },
                  ...(allocShareVes.greaterThan(0)
                    ? [
                        {
                          communityId,
                          accountId: receivableAccountId,
                          lineNumber: 2,
                          description: `Aplicación a cuenta por cobrar · ${property.code}`,
                          debit: new Prisma.Decimal(0),
                          credit: allocShareVes,
                          transactionAmount: null,
                          transactionCurrency: null,
                          exchangeRate: null,
                          referenceType: 'CHARGE_NOTICE_ALLOCATION',
                          referenceId: item.allocation.id,
                        },
                      ]
                    : []),
                  ...(allocAdvanceVes.greaterThan(0)
                    ? [
                        {
                          communityId,
                          accountId: advanceAccount.id,
                          lineNumber: 3,
                          description: `Anticipo del inmueble ${property.code}`,
                          debit: new Prisma.Decimal(0),
                          credit: allocAdvanceVes,
                          transactionAmount: null,
                          transactionCurrency: null,
                          exchangeRate: null,
                          referenceType: 'OWNER_ADVANCE',
                          referenceId: property.id,
                        },
                      ]
                    : []),
                ],
              },
            },
          });

          const payment = await tx.ownerPayment.create({
            data: {
              id: paymentId,
              communityId,
              propertyId: property.id,
              payerPersonId: user.personId,
              chargeNoticeAllocationId: item.allocation.id,
              paymentMethodId: input.paymentMethodId ?? null,
              bankAccountId: bankAccount.id,
              receiptAccountId,
              receivableAccountId,
              advanceAccountId: allocAdvanceVes.greaterThan(0) ? advanceAccount.id : null,
              journalEntryId: journalEntry.id,
              receiptNumber: sequence.nextReceiptNumber - 1,
              amount: partAmount,
              currency: paymentCurrency,
              exchangeRate: decExchangeRate,
              amountVes: totalPartVes,
              appliedToNoticeVes: allocShareVes,
              advanceVes: allocAdvanceVes,
              reference: input.reference.trim(),
              paidAt,
              notes: input.notes?.trim() || null,
              createdById: userId,
            },
          });

          await this.audit(
            tx,
            communityId,
            userId,
            'OWNER_PAYMENT_POSTED',
            'OwnerPayment',
            payment.id,
            `Pago reportado y distribuido a cuota ${item.allocation.id}`,
            payment,
          );

          results.push(payment);
        }
      } else {
        // Case B: No outstanding allocations, save total payment as an advance
        const sequence = await tx.communityAccountingSettings.update({
          where: { communityId },
          data: {
            nextJournalNumber: { increment: 1 },
            nextReceiptNumber: { increment: 1 },
          },
        });

        const paymentId = randomUUID();

        const journalEntry = await tx.journalEntry.create({
          data: {
            communityId,
            accountingPeriodId: accountingPeriod.id,
            entryNumber: sequence.nextJournalNumber - 1,
            entryDate: paidAt,
            description: `Pago recibido (Anticipo) · Inmueble ${property.code}`,
            source: JournalEntrySource.PAYMENT,
            sourceId: paymentId,
            status: JournalEntryStatus.POSTED,
            postedAt: new Date(),
            postedById: userId,
            createdById: userId,
            lines: {
              create: [
                {
                  communityId,
                  accountId: receiptAccountId,
                  lineNumber: 1,
                  description: `Ingreso ref: ${input.reference.trim()}`,
                  debit: amountVes,
                  credit: new Prisma.Decimal(0),
                  transactionAmount: amount,
                  transactionCurrency: paymentCurrency,
                  exchangeRate: decExchangeRate,
                  referenceType: 'OWNER_PAYMENT',
                  referenceId: paymentId,
                },
                {
                  communityId,
                  accountId: advanceAccount.id,
                  lineNumber: 2,
                  description: `Anticipo del inmueble ${property.code}`,
                  debit: new Prisma.Decimal(0),
                  credit: amountVes,
                  transactionAmount: null,
                  transactionCurrency: null,
                  exchangeRate: null,
                  referenceType: 'OWNER_ADVANCE',
                  referenceId: property.id,
                },
              ],
            },
          },
        });

        const payment = await tx.ownerPayment.create({
          data: {
            id: paymentId,
            communityId,
            propertyId: property.id,
            payerPersonId: user.personId,
            chargeNoticeAllocationId: null,
            paymentMethodId: input.paymentMethodId ?? null,
            bankAccountId: bankAccount.id,
            receiptAccountId,
            receivableAccountId,
            advanceAccountId: advanceAccount.id,
            journalEntryId: journalEntry.id,
            receiptNumber: sequence.nextReceiptNumber - 1,
            amount,
            currency: paymentCurrency,
            exchangeRate: decExchangeRate,
            amountVes,
            appliedToNoticeVes: new Prisma.Decimal(0),
            advanceVes: amountVes,
            reference: input.reference.trim(),
            paidAt,
            notes: input.notes?.trim() || null,
            createdById: userId,
          },
        });

        await this.audit(
          tx,
          communityId,
          userId,
          'OWNER_PAYMENT_POSTED',
          'OwnerPayment',
          payment.id,
          `Pago reportado como anticipo por falta de cuotas emitidas`,
          payment,
        );

        results.push(payment);
      }

      return results;
    });
  }
  */
}
