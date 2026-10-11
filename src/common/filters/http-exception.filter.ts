import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { MonitoringService } from '../../monitoring/monitoring.service';
import { MONITORING_MAX_MESSAGE_BYTES, MONITORING_MAX_STACK_BYTES, sanitizeDiagnostic, truncateUtf8 } from '../../monitoring/monitoring.constants';
import { AuthPrincipal } from '../../auth/auth.types';
import { MulterError } from 'multer';

type MonitoringRequest = Request & { auth?: AuthPrincipal; communityName?: string };

function clientIp(request: Request) {
  return (request.ip || request.socket.remoteAddress || '').replace(/^::ffff:/i, '').slice(0, 64) || null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  constructor(private readonly monitoring?: MonitoringService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<MonitoringRequest>();
    const requestId = request.get('x-request-id')?.slice(0, 80) || randomUUID();
    response.setHeader('x-request-id', requestId);

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : exception instanceof MulterError
        ? exception.code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Ocurrió un error interno en el servidor.';
    let details: unknown = null;
    let internalMessage = 'Ocurrió un error interno en el servidor.';
    if (exception instanceof Error) {
      internalMessage = exception.message;
    }

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      const respObj = exceptionResponse as Record<string, unknown>;
      const rawMessage = respObj.message;
      message = Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : message;
      details = respObj.error || null;
    }

    if (status >= 500) {
      message = 'Ocurrió un error interno en el servidor.';
      details = null;
      this.logger.error(
        `[${request.method}] ${request.url} - Status ${status} - Error: ${internalMessage}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${request.method}] ${request.url} - Status ${status} - ${message}`,
      );
    }

    if (this.monitoring && status >= 400) {
      const rootMessage = status >= 500 ? internalMessage : message;
      const safeMessage = truncateUtf8(sanitizeDiagnostic(rootMessage), MONITORING_MAX_MESSAGE_BYTES);
      const rawStack = exception instanceof Error ? sanitizeDiagnostic(exception.stack ?? '') || null : null;
      const safeStack = rawStack ? truncateUtf8(rawStack, MONITORING_MAX_STACK_BYTES) : { value: null, truncated: false };
      const auth = request.auth;
      void this.monitoring.recordError({
        statusCode: status, method: request.method.slice(0, 10),
        path: request.originalUrl.slice(0, 1000), message: safeMessage.value,
        stack: safeStack.value, stackTruncated: safeStack.truncated || safeMessage.truncated,
        requestId, ipAddress: clientIp(request),
        userId: auth?.userId ?? null, userEmail: auth?.email?.slice(0, 190) ?? null,
        communityId: auth?.communityId ?? null, communityName: auth?.communityName?.slice(0, 160) ?? null,
      });
    }

    response.setHeader('x-monitoring-recorded', '1');
    response.status(status).json({
      statusCode: status,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      ...(details ? { error: details } : {}),
    });
  }
}
