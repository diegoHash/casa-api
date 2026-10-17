import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MONITORING_RETENTION_DAYS } from './monitoring.constants';
import { MonitoringErrorNotice, MonitoringEvents } from './monitoring.events';
import { filter } from 'rxjs';

export interface MonitoringErrorFilters { from?: Date; to?: Date; statusCode?: number; kind?: 'client' | 'server'; communityId?: string; userId?: string; take: number; }

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly events: MonitoringEvents) {}

  onModuleInit() {
    void this.purgeExpired().catch((error: unknown) => this.logger.error('No se pudo limpiar el historial de monitoreo.', error));
    this.cleanupTimer = setInterval(() => {
      void this.purgeExpired().catch((error: unknown) => this.logger.error('No se pudo limpiar el historial de monitoreo.', error));
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  async recordError(input: Omit<MonitoringErrorNotice, 'id' | 'occurredAt'>) {
    if (input.statusCode === 401) return null;
    try {
      const record = await this.prisma.monitoringError.create({ data: input });
      const notice = { ...input, id: record.id, occurredAt: record.occurredAt.toISOString() };
      this.events.publish(notice);
      return notice;
    } catch (error) {
      this.logger.error('No se pudo persistir el error en el historial de monitoreo.', error instanceof Error ? error.stack : String(error));
      return null;
    }
  }

  async dashboard() {
    const now = new Date();
    const [database, active, users, retained, last24Hours] = await Promise.all([
      this.databaseStatus(),
      this.prisma.authSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(DISTINCT userId) AS total FROM AuthSession WHERE revokedAt IS NULL AND expiresAt > ${now}`,
      this.prisma.monitoringError.count({ where: { occurredAt: { gte: this.retentionStart() }, statusCode: { not: 401 } } }),
      this.prisma.monitoringError.count({ where: { occurredAt: { gte: new Date(now.getTime() - 86_400_000) }, statusCode: { not: 401 } } }),
    ]);
    return { services: { api: { status: 'ok', checkedAt: now.toISOString() }, database }, sessions: { active, uniqueUsers: Number(users[0]?.total ?? 0) }, errors: { retained, last24Hours }, retentionDays: MONITORING_RETENTION_DAYS, generatedAt: now.toISOString() };
  }

  async databaseStatus() {
    try { await this.prisma.$queryRaw`SELECT 1`; return { status: 'ok', checkedAt: new Date().toISOString() }; }
    catch { return { status: 'error', checkedAt: new Date().toISOString() }; }
  }

  async listErrors(filters: MonitoringErrorFilters) {
    const retentionStart = this.retentionStart();
    const where: Prisma.MonitoringErrorWhereInput = {
      occurredAt: { gte: filters.from && filters.from > retentionStart ? filters.from : retentionStart, ...(filters.to ? { lte: filters.to } : {}) },
      AND: [
        { statusCode: { not: 401 } },
        ...(filters.statusCode ? [{ statusCode: filters.statusCode }] : []),
        ...(filters.kind === 'client' ? [{ statusCode: { gte: 400, lt: 500 } }] : []),
        ...(filters.kind === 'server' ? [{ statusCode: { gte: 500, lt: 600 } }] : []),
      ],
      ...(filters.communityId ? { communityId: filters.communityId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
    };
    return this.prisma.monitoringError.findMany({ where, orderBy: { occurredAt: 'desc' }, take: filters.take });
  }
  subscribeToErrors(filters: { kind?: string; communityId?: string; userId?: string; from?: Date; to?: Date }) {
    return this.events.errors$.pipe(filter((error: MonitoringErrorNotice) =>
      error.statusCode !== 401 &&
      (!filters.kind || (filters.kind === 'client' ? error.statusCode < 500 : error.statusCode >= 500)) &&
      (!filters.communityId || error.communityId === filters.communityId) &&
      (!filters.userId || error.userId === filters.userId) &&
      (!filters.from || new Date(error.occurredAt) >= filters.from) &&
      (!filters.to || new Date(error.occurredAt) <= filters.to),
    ));
  }
  listCommunities() { return this.prisma.community.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }); }
  listUsers() { return this.prisma.appUser.findMany({ select: { id: true, email: true }, orderBy: { email: 'asc' } }); }
  private retentionStart() { return new Date(Date.now() - MONITORING_RETENTION_DAYS * 86_400_000); }
  private purgeExpired() { return this.prisma.monitoringError.deleteMany({ where: { occurredAt: { lt: this.retentionStart() } } }); }
}
