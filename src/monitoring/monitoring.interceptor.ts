import { Injectable } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthPrincipal } from '../auth/auth.types';
import { MonitoringService } from './monitoring.service';
import { MONITORING_MAX_MESSAGE_BYTES, sanitizeDiagnostic, truncateUtf8 } from './monitoring.constants';

type MonitoringRequest = Request & { auth?: AuthPrincipal };

@Injectable()
export class MonitoringInterceptor {
  constructor(private readonly monitoring: MonitoringService) {}

  use(request: MonitoringRequest, response: Response, next: NextFunction) {
    response.once('finish', () => {
      const status = response.statusCode;
      if (status < 400 || status >= 600 || response.getHeader('x-monitoring-recorded') === '1') return;
      const requestId = response.getHeader('x-request-id')?.toString().slice(0, 80) || request.get('x-request-id')?.slice(0, 80) || randomUUID();
      const detail = status >= 500 ? 'Error interno del servidor' : `Respuesta HTTP ${status}`;
      void this.monitoring.recordError({ statusCode: status, method: request.method.slice(0, 10), path: request.originalUrl.slice(0, 1000), message: truncateUtf8(sanitizeDiagnostic(detail), MONITORING_MAX_MESSAGE_BYTES).value, stack: null, stackTruncated: false, requestId, ipAddress: (request.ip || request.socket.remoteAddress || '').replace(/^::ffff:/i, '').slice(0, 64) || null, userId: request.auth?.userId ?? null, userEmail: request.auth?.email?.slice(0, 190) ?? null, communityId: request.auth?.communityId ?? null, communityName: request.auth?.communityName?.slice(0, 160) ?? null });
    });
    next();
  }
}
