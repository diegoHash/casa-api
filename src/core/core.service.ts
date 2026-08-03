import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessStatus,
  AdministrationMode,
  LifecycleStatus,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  ChangeAliquotDto,
  CreateBoardAppointmentDto,
  CreateConcessionDto,
  CreateEmploymentDto,
  CreateOwnershipDto,
  CreatePersonDto,
  CreatePersonContactDto,
  UpdatePersonDto,
  CreatePropertyDto,
  CreatePropertyLocationDto,
  EndRelationshipDto,
  SetupBoardAdministrationDto,
  UpdateCommunityDto,
  UpdateConcessionDto,
  UpdatePropertyCapacityDto,
} from './dto/core.dto';

function normalizePersonName(value: string) {
  return value.trim().toLocaleUpperCase('es-VE');
}

@Injectable()
export class CoreService {
  constructor(private readonly prisma: PrismaService) {}

  async ownerServiceDirectory(communityId: string) {
    const [ownerships, staff] = await Promise.all([
      this.prisma.ownership.findMany({
      where: {
        communityId,
        status: LifecycleStatus.ACTIVE,
        OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }],
        property: { status: RecordStatus.ACTIVE },
      },
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

    return {
      owners: ownerships.map(({ person, property }) => ({
        person,
        property,
        sector: property.location?.name ?? property.location?.code ?? 'Sin sector',
      })),
      staff,
    };
  }

  snapshot(communityId: string) {
    return this.prisma.community.findUniqueOrThrow({
      where: { id: communityId },
      include: {
        locations: { orderBy: { code: 'asc' } },
        properties: {
          orderBy: { code: 'asc' },
          include: {
            location: true,
            aliquotPeriods: { orderBy: { startsOn: 'desc' } },
          },
        },
        people: {
          orderBy: [{ person: { lastName: 'asc' } }],
          include: {
            person: {
              include: {
                contacts: {
                  where: { communityId },
                  orderBy: [{ type: 'asc' }, { label: 'asc' }],
                },
              },
            },
          },
        },
        ownerships: {
          orderBy: { startsOn: 'desc' },
          include: {
            person: true,
            property: {
              include: { location: true },
            },
          },
        },
        employments: {
          orderBy: { startsOn: 'desc' },
          include: { person: true },
        },
        boardAppointments: {
          orderBy: { startsOn: 'desc' },
          include: {
            person: true,
            property: true,
          },
        },
        concessions: { orderBy: { code: 'asc' } },
        auditEvents: {
          where: { communityId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            actor: {
              select: {
                email: true,
                person: {
                  select: { firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });
  }

  updateCommunity(
    communityId: string,
    actorUserId: string,
    input: UpdateCommunityDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const community = await transaction.community.findUniqueOrThrow({
        where: { id: communityId },
      });
      const rif = input.rif?.trim().toUpperCase();
      if (rif && rif !== community.rif) {
        const duplicate = await transaction.community.findUnique({
          where: { rif },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException(
            'El RIF ya está registrado en otra comunidad.',
          );
        }
      }
      const updated = await transaction.community.update({
        where: { id: communityId },
        data: {
          name: input.name?.trim(),
          legalName: input.legalName?.trim(),
          rif,
          phone: input.phone?.trim(),
          email: input.email?.trim().toLowerCase(),
          address: input.address?.trim(),
          state: input.state?.trim(),
          city: input.city?.trim(),
          postalCode: input.postalCode?.trim(),
          administrationMode: input.administrationMode,
          administratorName: input.administratorName?.trim() || null,
          administratorRif:
            input.administratorRif?.trim().toUpperCase() || null,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'COMMUNITY_UPDATED',
        'Community',
        communityId,
        'Información de comunidad actualizada',
        community,
        updated,
      );
      return updated;
    });
  }

  async createPerson(
    communityId: string,
    actorUserId: string,
    input: CreatePersonDto,
  ) {
    const documentNumber = input.documentNumber
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return this.prisma.$transaction(async (transaction) => {
      let person = await transaction.person.findUnique({
        where: {
          documentType_documentNumber: {
            documentType: input.documentType,
            documentNumber,
          },
        },
      });
      if (!person) {
        person = await transaction.person.create({
          data: {
            firstName: normalizePersonName(input.firstName),
            lastName: normalizePersonName(input.lastName),
            documentType: input.documentType,
            documentNumber,
            phone: input.phone?.trim() || null,
            email: input.email?.trim().toLowerCase() || null,
          },
        });
      }

      const existing = await transaction.communityPerson.findUnique({
        where: {
          communityId_personId: { communityId, personId: person.id },
        },
      });
      if (existing) {
        throw new ConflictException(
          'Esta persona ya pertenece al directorio de la comunidad.',
        );
      }
      const relation = await transaction.communityPerson.create({
        data: { communityId, personId: person.id },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PERSON_LINKED',
        'Person',
        person.id,
        `${person.firstName} ${person.lastName} incorporado al directorio`,
        undefined,
        { person, relation },
      );
      return { person, relation };
    });
  }

  async updatePerson(
    communityId: string,
    actorUserId: string,
    personId: string,
    input: UpdatePersonDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireCommunityPerson(transaction, communityId, personId);
      const before = await transaction.person.findUniqueOrThrow({
        where: { id: personId },
        include: { user: true },
      });
      const normalizedEmail =
        input.email === undefined
          ? before.email
          : input.email.trim().toLowerCase() || null;
      if (
        before.user &&
        normalizedEmail &&
        before.user.email !== normalizedEmail
      ) {
        const emailOwner = await transaction.appUser.findUnique({
          where: { email: normalizedEmail },
        });
        if (emailOwner && emailOwner.id !== before.user.id) {
          throw new ConflictException(
            'El correo principal ya pertenece a otra cuenta de acceso en CASA.',
          );
        }
      }
      const updated = await transaction.person.update({
        where: { id: personId },
        data: {
          firstName:
            input.firstName === undefined
              ? undefined
              : normalizePersonName(input.firstName),
          lastName:
            input.lastName === undefined
              ? undefined
              : normalizePersonName(input.lastName),
          phone:
            input.phone === undefined ? undefined : input.phone.trim() || null,
          email: input.email === undefined ? undefined : normalizedEmail,
        },
      });
      if (
        before.user &&
        normalizedEmail &&
        before.user.email !== normalizedEmail
      ) {
        const synchronizedUser = await transaction.appUser.update({
          where: { id: before.user.id },
          data: {
            email: normalizedEmail,
            tokenVersion: { increment: 1 },
          },
        });
        await transaction.authSession.updateMany({
          where: { userId: before.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit(
          transaction,
          communityId,
          actorUserId,
          'APP_USER_EMAIL_SYNCHRONIZED',
          'AppUser',
          before.user.id,
          'Correo de acceso sincronizado con el correo principal de la persona',
          { email: before.user.email },
          { email: synchronizedUser.email },
        );
      }
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PERSON_UPDATED',
        'Person',
        personId,
        `Información de ${updated.firstName} ${updated.lastName} actualizada`,
        {
          firstName: before.firstName,
          lastName: before.lastName,
          phone: before.phone,
          email: before.email,
        },
        updated,
      );
      return updated;
    });
  }

  async createPersonContact(
    communityId: string,
    actorUserId: string,
    personId: string,
    input: CreatePersonContactDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireCommunityPerson(transaction, communityId, personId);
      const value = input.value.trim();
      const duplicate = await transaction.personContact.findUnique({
        where: {
          communityId_personId_type_value: {
            communityId,
            personId,
            type: input.type,
            value,
          },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'Esta forma de contacto ya está registrada para la persona.',
        );
      }
      const contact = await transaction.personContact.create({
        data: {
          communityId,
          personId,
          type: input.type,
          label: input.label.trim(),
          value,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PERSON_CONTACT_CREATED',
        'PersonContact',
        contact.id,
        'Forma de contacto secundaria agregada',
        undefined,
        contact,
      );
      return contact;
    });
  }

  async deletePersonContact(
    communityId: string,
    actorUserId: string,
    personId: string,
    contactId: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireCommunityPerson(transaction, communityId, personId);
      const contact = await transaction.personContact.findFirst({
        where: { id: contactId, communityId, personId },
      });
      if (!contact) {
        throw new NotFoundException(
          'La forma de contacto no pertenece a esta persona o comunidad.',
        );
      }
      await transaction.personContact.delete({ where: { id: contact.id } });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PERSON_CONTACT_DELETED',
        'PersonContact',
        contact.id,
        'Forma de contacto secundaria eliminada',
        contact,
        undefined,
      );
      return { deleted: true };
    });
  }

  async createLocation(
    communityId: string,
    actorUserId: string,
    input: CreatePropertyLocationDto,
  ) {
    const code = input.code.trim().toUpperCase();
    const duplicate = await this.prisma.propertyLocation.findUnique({
      where: { communityId_code: { communityId, code } },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe una ubicación con este código en la comunidad.',
      );
    }
    const location = await this.prisma.propertyLocation.create({
      data: {
        communityId,
        kind: input.kind,
        code,
        name: input.name.trim(),
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'PROPERTY_LOCATION_CREATED',
      'PropertyLocation',
      location.id,
      `Ubicación ${location.code} registrada`,
      undefined,
      location,
    );
    return location;
  }

  async createProperty(
    communityId: string,
    actorUserId: string,
    input: CreatePropertyDto,
  ) {
    const code = input.code.trim().toUpperCase();
    return this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.property.findUnique({
        where: { communityId_code: { communityId, code } },
      });
      if (duplicate) {
        throw new ConflictException(
          'Ya existe un inmueble con este código en la comunidad.',
        );
      }
      if (input.locationId) {
        await this.requireLocation(transaction, communityId, input.locationId);
      }
      const property = await transaction.property.create({
        data: {
          communityId,
          locationId: input.locationId ?? null,
          kind: input.kind,
          code,
          currentAliquot:
            input.aliquot === undefined
              ? null
              : new Prisma.Decimal(input.aliquot),
          maximumOccupancy: input.maximumOccupancy ?? null,
          braceletQuota: input.braceletQuota ?? 0,
        },
      });
      if (input.aliquot !== undefined) {
        await transaction.propertyAliquotPeriod.create({
          data: {
            communityId,
            propertyId: property.id,
            aliquot: new Prisma.Decimal(input.aliquot),
            startsOn: input.aliquotStartsOn
              ? new Date(input.aliquotStartsOn)
              : new Date(),
            reason: 'Valor inicial',
          },
        });
      }
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PROPERTY_CREATED',
        'Property',
        property.id,
        `Inmueble ${property.code} registrado`,
        undefined,
        property,
      );
      return property;
    });
  }

  async updatePropertyCapacity(
    communityId: string,
    actorUserId: string,
    propertyId: string,
    input: UpdatePropertyCapacityDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const property = await this.requireProperty(
        transaction,
        communityId,
        propertyId,
      );
      const updated = await transaction.property.update({
        where: { id: property.id },
        data: {
          maximumOccupancy: input.maximumOccupancy,
          braceletQuota: input.braceletQuota,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PROPERTY_CAPACITY_UPDATED',
        'Property',
        property.id,
        `Capacidad y cupos del inmueble ${property.code} actualizados`,
        property,
        updated,
      );
      return updated;
    });
  }

  async changeAliquot(
    communityId: string,
    actorUserId: string,
    propertyId: string,
    input: ChangeAliquotDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const property = await this.requireProperty(
        transaction,
        communityId,
        propertyId,
      );
      const startsOn = new Date(input.startsOn);
      const active = await transaction.propertyAliquotPeriod.findFirst({
        where: {
          communityId,
          propertyId,
          status: LifecycleStatus.ACTIVE,
        },
        orderBy: { startsOn: 'desc' },
      });
      if (active && startsOn <= active.startsOn) {
        throw new ConflictException(
          'La nueva vigencia debe comenzar después de la alícuota vigente.',
        );
      }
      if (active) {
        await transaction.propertyAliquotPeriod.update({
          where: { id: active.id },
          data: { status: LifecycleStatus.ENDED, endsOn: startsOn },
        });
      }
      const period = await transaction.propertyAliquotPeriod.create({
        data: {
          communityId,
          propertyId,
          aliquot: new Prisma.Decimal(input.aliquot),
          startsOn,
          reason: input.reason.trim(),
        },
      });
      await transaction.property.update({
        where: { id: propertyId },
        data: { currentAliquot: new Prisma.Decimal(input.aliquot) },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'PROPERTY_ALIQUOT_CHANGED',
        'Property',
        propertyId,
        `Alícuota de ${property.code} actualizada`,
        active,
        period,
      );
      return period;
    });
  }

  setupBoardAdministration(
    communityId: string,
    actorUserId: string,
    input: SetupBoardAdministrationDto,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const community = await transaction.community.findUniqueOrThrow({
          where: { id: communityId },
        });
        const activeAppointments = await transaction.boardAppointment.count({
          where: { communityId, status: LifecycleStatus.ACTIVE },
        });
        if (activeAppointments) {
          throw new ConflictException(
            'La junta inicial ya fue conformada. Utiliza la gestión ordinaria para hacer cambios.',
          );
        }

        const documentKeys = new Set<string>();
        const propertyConfigurations = new Map<
          string,
          {
            kind: string;
            maximumOccupancy: number;
            braceletQuota: number;
            aliquot?: number;
          }
        >();
        for (const member of input.members) {
          const normalizedDocument = member.documentNumber
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
          const key = `${member.documentType}:${normalizedDocument}`;
          if (documentKeys.has(key)) {
            throw new ConflictException(
              'Una misma persona no puede ocupar dos cargos vigentes en la junta inicial.',
            );
          }
          documentKeys.add(key);
          const propertyCode = member.propertyCode.trim().toUpperCase();
          const previousConfiguration =
            propertyConfigurations.get(propertyCode);
          if (
            previousConfiguration &&
            (previousConfiguration.kind !== member.propertyKind ||
              previousConfiguration.maximumOccupancy !==
                member.maximumOccupancy ||
              previousConfiguration.braceletQuota !== member.braceletQuota ||
              previousConfiguration.aliquot !== member.aliquot)
          ) {
            throw new ConflictException(
              `Los datos del inmueble ${propertyCode} no coinciden entre sus copropietarios.`,
            );
          }
          propertyConfigurations.set(propertyCode, {
            kind: member.propertyKind,
            maximumOccupancy: member.maximumOccupancy,
            braceletQuota: member.braceletQuota,
            aliquot: member.aliquot,
          });
        }

        const results: Array<{
          personId: string;
          propertyId: string;
          ownershipId: string;
          appointmentId: string;
        }> = [];

        for (const member of input.members) {
          const documentNumber = member.documentNumber
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
          let person = await transaction.person.findUnique({
            where: {
              documentType_documentNumber: {
                documentType: member.documentType,
                documentNumber,
              },
            },
          });
          if (!person) {
            person = await transaction.person.create({
              data: {
                firstName: normalizePersonName(member.firstName),
                lastName: normalizePersonName(member.lastName),
                documentType: member.documentType,
                documentNumber,
                phone: member.phone?.trim() || null,
                email: member.email?.trim().toLowerCase() || null,
              },
            });
          }
          await transaction.communityPerson.upsert({
            where: {
              communityId_personId: { communityId, personId: person.id },
            },
            create: { communityId, personId: person.id },
            update: { status: RecordStatus.ACTIVE },
          });

          const propertyCode = member.propertyCode.trim().toUpperCase();
          let property = await transaction.property.findUnique({
            where: { communityId_code: { communityId, code: propertyCode } },
          });
          if (!property) {
            property = await transaction.property.create({
              data: {
                communityId,
                kind: member.propertyKind,
                code: propertyCode,
                currentAliquot:
                  member.aliquot === undefined
                    ? null
                    : new Prisma.Decimal(member.aliquot),
                maximumOccupancy: member.maximumOccupancy,
                braceletQuota: member.braceletQuota,
              },
            });
            if (member.aliquot !== undefined) {
              await transaction.propertyAliquotPeriod.create({
                data: {
                  communityId,
                  propertyId: property.id,
                  aliquot: new Prisma.Decimal(member.aliquot),
                  startsOn: new Date(member.startsOn),
                  reason: 'Valor inicial durante conformación de junta',
                },
              });
            }
          } else {
            if (property.kind !== member.propertyKind) {
              throw new ConflictException(
                `El inmueble ${propertyCode} ya existe con otra categoría.`,
              );
            }
            const shouldInitializeAliquot =
              property.currentAliquot === null && member.aliquot !== undefined;
            property = await transaction.property.update({
              where: { id: property.id },
              data: {
                maximumOccupancy: member.maximumOccupancy,
                braceletQuota: member.braceletQuota,
                currentAliquot: shouldInitializeAliquot
                  ? new Prisma.Decimal(member.aliquot!)
                  : undefined,
              },
            });
            if (shouldInitializeAliquot) {
              await transaction.propertyAliquotPeriod.create({
                data: {
                  communityId,
                  propertyId: property.id,
                  aliquot: new Prisma.Decimal(member.aliquot!),
                  startsOn: new Date(member.startsOn),
                  reason: 'Valor inicial durante conformación de junta',
                },
              });
            }
          }

          const currentOwnerships = await transaction.ownership.findMany({
            where: {
              communityId,
              propertyId: property.id,
              status: LifecycleStatus.ACTIVE,
            },
          });
          if (currentOwnerships.some((item) => item.personId === person.id)) {
            throw new ConflictException(
              `${person.firstName} ${person.lastName} ya figura como propietario de ${propertyCode}.`,
            );
          }
          const assigned = currentOwnerships.reduce(
            (total, item) => total + item.ownershipPercentage.toNumber(),
            0,
          );
          if (assigned + member.ownershipPercentage > 100.00005) {
            throw new ConflictException(
              `La participación del inmueble ${propertyCode} excede el 100%.`,
            );
          }

          const startsOn = new Date(member.startsOn);
          const endsOn = member.endsOn ? new Date(member.endsOn) : null;
          if (endsOn && endsOn <= startsOn) {
            throw new ConflictException(
              `La fecha final del cargo de ${person.firstName} debe ser posterior a su inicio.`,
            );
          }
          const ownership = await transaction.ownership.create({
            data: {
              communityId,
              propertyId: property.id,
              personId: person.id,
              ownershipPercentage: new Prisma.Decimal(
                member.ownershipPercentage,
              ),
              startsOn,
            },
          });
          const appointment = await transaction.boardAppointment.create({
            data: {
              communityId,
              personId: person.id,
              propertyId: property.id,
              position: member.position.trim(),
              startsOn,
              endsOn,
            },
          });
          results.push({
            personId: person.id,
            propertyId: property.id,
            ownershipId: ownership.id,
            appointmentId: appointment.id,
          });
        }

        await transaction.community.update({
          where: { id: communityId },
          data: {
            administrationMode: AdministrationMode.BOARD,
            administratorName: null,
            administratorRif: null,
          },
        });
        await this.audit(
          transaction,
          communityId,
          actorUserId,
          'INITIAL_BOARD_CONFIGURED',
          'Community',
          communityId,
          `Junta administradora inicial conformada con ${results.length} integrante(s)`,
          { administrationMode: community.administrationMode },
          { administrationMode: AdministrationMode.BOARD, members: results },
        );
        return { members: results };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  createOwnership(
    communityId: string,
    actorUserId: string,
    input: CreateOwnershipDto,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        await this.requireCommunityPerson(
          transaction,
          communityId,
          input.personId,
        );
        await this.requireProperty(transaction, communityId, input.propertyId);
        const active = await transaction.ownership.findMany({
          where: {
            communityId,
            propertyId: input.propertyId,
            status: LifecycleStatus.ACTIVE,
          },
          select: { personId: true, ownershipPercentage: true },
        });
        if (active.some((item) => item.personId === input.personId)) {
          throw new ConflictException(
            'Esta persona ya figura como propietaria vigente del inmueble.',
          );
        }
        const assigned = active.reduce(
          (total, item) => total + item.ownershipPercentage.toNumber(),
          0,
        );
        if (assigned + input.ownershipPercentage > 100.00005) {
          throw new ConflictException(
            `La participación excede el 100%. Disponible: ${Math.max(0, 100 - assigned).toFixed(4)}%.`,
          );
        }
        const ownership = await transaction.ownership.create({
          data: {
            communityId,
            propertyId: input.propertyId,
            personId: input.personId,
            ownershipPercentage: new Prisma.Decimal(input.ownershipPercentage),
            startsOn: new Date(input.startsOn),
          },
        });
        await this.audit(
          transaction,
          communityId,
          actorUserId,
          'OWNERSHIP_CREATED',
          'Ownership',
          ownership.id,
          'Propietario vinculado al inmueble',
          undefined,
          ownership,
        );
        return ownership;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  createEmployment(
    communityId: string,
    actorUserId: string,
    input: CreateEmploymentDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireCommunityPerson(
        transaction,
        communityId,
        input.personId,
      );
      const [board, existingEmployment] = await Promise.all([
        transaction.boardAppointment.findFirst({
          where: {
            communityId,
            personId: input.personId,
            status: LifecycleStatus.ACTIVE,
          },
        }),
        transaction.employment.findFirst({
          where: {
            communityId,
            personId: input.personId,
            status: LifecycleStatus.ACTIVE,
          },
        }),
      ]);
      if (board) {
        throw new ConflictException(
          'Un integrante vigente de la junta no puede registrarse como trabajador.',
        );
      }
      if (existingEmployment) {
        throw new ConflictException(
          'Esta persona ya tiene una relación laboral vigente en la comunidad.',
        );
      }
      const employment = await transaction.employment.create({
        data: {
          communityId,
          personId: input.personId,
          position: input.position.trim(),
          department: input.department.trim(),
          engagementType: input.engagementType,
          startsOn: new Date(input.startsOn),
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'EMPLOYMENT_CREATED',
        'Employment',
        employment.id,
        'Relación de trabajo registrada',
        undefined,
        employment,
      );
      return employment;
    });
  }

  createBoardAppointment(
    communityId: string,
    actorUserId: string,
    input: CreateBoardAppointmentDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireCommunityPerson(
        transaction,
        communityId,
        input.personId,
      );
      if (input.propertyId) {
        await this.requireProperty(transaction, communityId, input.propertyId);
      }
      const [employment, board] = await Promise.all([
        transaction.employment.findFirst({
          where: {
            communityId,
            personId: input.personId,
            status: LifecycleStatus.ACTIVE,
          },
        }),
        transaction.boardAppointment.findFirst({
          where: {
            communityId,
            personId: input.personId,
            status: LifecycleStatus.ACTIVE,
          },
        }),
      ]);
      if (employment) {
        throw new ConflictException(
          'Un trabajador vigente no puede integrar simultáneamente la junta.',
        );
      }
      if (board) {
        throw new ConflictException(
          'Esta persona ya tiene una designación vigente en la junta.',
        );
      }
      const startsOn = new Date(input.startsOn);
      const endsOn = input.endsOn ? new Date(input.endsOn) : null;
      if (endsOn && endsOn <= startsOn) {
        throw new ConflictException(
          'La fecha final debe ser posterior al inicio de la designación.',
        );
      }
      const appointment = await transaction.boardAppointment.create({
        data: {
          communityId,
          personId: input.personId,
          propertyId: input.propertyId ?? null,
          position: input.position.trim(),
          startsOn,
          endsOn,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'BOARD_APPOINTMENT_CREATED',
        'BoardAppointment',
        appointment.id,
        'Integrante designado en la junta',
        undefined,
        appointment,
      );
      return appointment;
    });
  }

  async createConcession(
    communityId: string,
    actorUserId: string,
    input: CreateConcessionDto,
  ) {
    const code = input.code.trim().toUpperCase();
    const startsOn = new Date(input.startsOn);
    const endsOn = input.endsOn ? new Date(input.endsOn) : null;
    if (endsOn && endsOn <= startsOn) {
      throw new ConflictException(
        'La fecha final debe ser posterior al inicio de la concesión.',
      );
    }
    const duplicate = await this.prisma.concession.findUnique({
      where: { communityId_code: { communityId, code } },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe una concesión con este código en la comunidad.',
      );
    }
    const concession = await this.prisma.concession.create({
      data: {
        communityId,
        code,
        name: input.name.trim(),
        holderName: input.holderName.trim(),
        holderDocument: input.holderDocument.trim(),
        locationDescription: input.locationDescription?.trim() || null,
        monthlyAmount: new Prisma.Decimal(input.monthlyAmount),
        currency: input.currency,
        startsOn,
        endsOn,
      },
    });
    await this.audit(
      this.prisma,
      communityId,
      actorUserId,
      'CONCESSION_CREATED',
      'Concession',
      concession.id,
      `Concesión ${concession.code} registrada`,
      undefined,
      concession,
    );
    return concession;
  }

  async updateConcession(
    communityId: string,
    actorUserId: string,
    id: string,
    input: UpdateConcessionDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.concession.findFirst({
        where: { id, communityId },
      });
      if (!current) {
        throw new NotFoundException(
          'La concesión no existe en esta comunidad.',
        );
      }
      if (current.status === LifecycleStatus.ENDED) {
        throw new ConflictException(
          'Una concesión finalizada no puede editarse.',
        );
      }

      const code = input.code?.trim().toUpperCase() ?? current.code;
      if (code !== current.code) {
        const duplicate = await transaction.concession.findUnique({
          where: { communityId_code: { communityId, code } },
        });
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(
            'Ya existe una concesión con este código en la comunidad.',
          );
        }
      }

      const startsOn = input.startsOn
        ? new Date(input.startsOn)
        : current.startsOn;
      const endsOn =
        input.endsOn === undefined
          ? current.endsOn
          : input.endsOn
            ? new Date(input.endsOn)
            : null;
      if (endsOn && endsOn <= startsOn) {
        throw new ConflictException(
          'La fecha final debe ser posterior al inicio de la concesión.',
        );
      }

      const updated = await transaction.concession.update({
        where: { id },
        data: {
          code,
          name: input.name?.trim(),
          holderName: input.holderName?.trim(),
          holderDocument: input.holderDocument?.trim().toUpperCase(),
          locationDescription:
            input.locationDescription === undefined
              ? undefined
              : input.locationDescription.trim() || null,
          monthlyAmount:
            input.monthlyAmount === undefined
              ? undefined
              : new Prisma.Decimal(input.monthlyAmount),
          currency: input.currency,
          startsOn,
          endsOn,
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'CONCESSION_UPDATED',
        'Concession',
        updated.id,
        `Concesión ${updated.code} actualizada`,
        current,
        updated,
      );
      return updated;
    });
  }

  endOwnership(
    communityId: string,
    actorUserId: string,
    id: string,
    input: EndRelationshipDto,
  ) {
    return this.endRelationship(
      'ownership',
      communityId,
      actorUserId,
      id,
      input,
    );
  }

  endEmployment(
    communityId: string,
    actorUserId: string,
    id: string,
    input: EndRelationshipDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.employment.findFirst({
        where: { id, communityId },
        include: {
          person: {
            include: {
              user: {
                include: {
                  communities: { where: { communityId } },
                },
              },
            },
          },
        },
      });
      if (!current) {
        throw new NotFoundException(
          'La relación laboral no existe en esta comunidad.',
        );
      }
      const wasAlreadyEnded = current.status === LifecycleStatus.ENDED;
      const endsOn =
        wasAlreadyEnded && current.endsOn
          ? current.endsOn
          : input.endsOn
            ? new Date(input.endsOn)
            : new Date();
      if (endsOn < current.startsOn) {
        throw new ConflictException(
          'La fecha de cierre no puede ser anterior al inicio.',
        );
      }
      const reason =
        wasAlreadyEnded && current.endReason
          ? current.endReason
          : input.reason.trim();
      const employment = await transaction.employment.update({
        where: { id },
        data: {
          status: LifecycleStatus.ENDED,
          endsOn,
          endReason: reason,
        },
      });
      const access = current.person.user?.communities[0] ?? null;
      let accessSuspended = false;
      if (access && access.status !== AccessStatus.REVOKED) {
        await transaction.communityWorkspaceAssignment.updateMany({
          where: { accessId: access.id, status: LifecycleStatus.ACTIVE },
          data: {
            status: LifecycleStatus.ENDED,
            endsOn,
            endReason: `Relación laboral finalizada: ${reason}`,
          },
        });
        await transaction.communityAccess.update({
          where: { id: access.id },
          // BLOCKED preserves the access record and can be reactivated later
          // without losing its role, scopes or employment history.
          data: { status: AccessStatus.BLOCKED, endsOn },
        });
        await transaction.appUser.update({
          where: { id: access.userId },
          data: { tokenVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { userId: access.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        accessSuspended = true;
      }
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        wasAlreadyEnded
          ? 'EMPLOYMENT_ACCESS_RECONCILED'
          : 'EMPLOYMENT_ENDED',
        'Employment',
        employment.id,
        accessSuspended
          ? wasAlreadyEnded
            ? 'Acceso comunitario reconciliado con una relación laboral finalizada'
            : 'Relación laboral finalizada y acceso comunitario suspendido'
          : 'Relación laboral finalizada; la persona no tenía acceso comunitario',
        current,
        { employment, accessSuspended },
      );
      return { employment, accessSuspended };
    });
  }

  endBoardAppointment(
    communityId: string,
    actorUserId: string,
    id: string,
    input: EndRelationshipDto,
  ) {
    return this.endRelationship(
      'boardAppointment',
      communityId,
      actorUserId,
      id,
      input,
    );
  }

  endConcession(
    communityId: string,
    actorUserId: string,
    id: string,
    input: EndRelationshipDto,
  ) {
    return this.endRelationship(
      'concession',
      communityId,
      actorUserId,
      id,
      input,
    );
  }

  private async endRelationship(
    model: 'ownership' | 'employment' | 'boardAppointment' | 'concession',
    communityId: string,
    actorUserId: string,
    id: string,
    input: EndRelationshipDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const delegate = transaction[model] as {
        findFirst(args: object): Promise<{
          id: string;
          startsOn: Date;
          status: LifecycleStatus;
        } | null>;
        update(args: object): Promise<unknown>;
      };
      const current = await delegate.findFirst({
        where: { id, communityId, status: LifecycleStatus.ACTIVE },
      });
      if (!current) {
        throw new NotFoundException(
          'La relación vigente no existe en esta comunidad.',
        );
      }
      const endsOn = input.endsOn ? new Date(input.endsOn) : new Date();
      if (endsOn < current.startsOn) {
        throw new ConflictException(
          'La fecha de cierre no puede ser anterior al inicio.',
        );
      }
      const after = await delegate.update({
        where: { id },
        data: {
          status: LifecycleStatus.ENDED,
          endsOn,
          endReason: input.reason.trim(),
        },
      });
      await this.audit(
        transaction,
        communityId,
        actorUserId,
        'RELATIONSHIP_ENDED',
        model,
        id,
        'Relación histórica finalizada',
        current,
        after,
      );
      return after;
    });
  }

  private async requireCommunityPerson(
    transaction: Prisma.TransactionClient,
    communityId: string,
    personId: string,
  ) {
    const relation = await transaction.communityPerson.findFirst({
      where: {
        communityId,
        personId,
        status: RecordStatus.ACTIVE,
      },
    });
    if (!relation) {
      throw new NotFoundException(
        'La persona no pertenece al directorio de esta comunidad.',
      );
    }
    return relation;
  }

  private async requireLocation(
    transaction: Prisma.TransactionClient,
    communityId: string,
    locationId: string,
  ) {
    const location = await transaction.propertyLocation.findFirst({
      where: { id: locationId, communityId },
    });
    if (!location) {
      throw new NotFoundException(
        'La ubicación no pertenece a esta comunidad.',
      );
    }
    return location;
  }

  private async requireProperty(
    transaction: Prisma.TransactionClient,
    communityId: string,
    propertyId: string,
  ) {
    const property = await transaction.property.findFirst({
      where: { id: propertyId, communityId },
    });
    if (!property) {
      throw new NotFoundException('El inmueble no pertenece a esta comunidad.');
    }
    return property;
  }

  private audit(
    transaction: Prisma.TransactionClient | PrismaService,
    communityId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail: string,
    before?: unknown,
    after?: unknown,
  ) {
    return transaction.auditEvent.create({
      data: {
        communityId,
        actorUserId,
        requestId: randomUUID(),
        action,
        entityType,
        entityId,
        detail,
        before: before as Prisma.InputJsonValue | undefined,
        after: after as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
