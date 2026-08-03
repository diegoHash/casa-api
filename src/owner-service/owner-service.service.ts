import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommunicationAudienceType,
  CommunicationDeliveryStatus,
  CommunicationStatus,
  LifecycleStatus,
  Prisma,
  RecordStatus,
  ServiceAuthorizationStatus,
  ServiceIncidentStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  AssignIncidentDto,
  AuthorizationListQueryDto,
  CommunicationDetailQueryDto,
  CommunicationListQueryDto,
  IncidentListQueryDto,
  PaginationQueryDto,
  PublishCommunicationDto,
  RejectAuthorizationDto,
  UpdateIncidentStatusDto,
} from './dto/owner-service.dto';

@Injectable()
export class OwnerServiceService {
  constructor(private readonly prisma: PrismaService) {}

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
          property.location?.name ??
          property.location?.code ??
          'Sin sector',
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
          note:
            input.note?.trim() ||
            `Estado actualizado a ${input.status}.`,
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
    const communication =
      await this.prisma.communityCommunication.findFirst({
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
        orderBy: [{ property: { code: 'asc' } }, { person: { lastName: 'asc' } }],
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
    const authorization =
      await this.prisma.serviceAuthorization.findFirst({
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
    const updated = await this.prisma.serviceAuthorization.update({
      where: { id },
      data: {
        status,
        rejectionReason: rejectionReason ?? null,
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
      },
    });
    await this.audit(
      this.prisma,
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
}
