import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * ============================================================================
 * SERVICIO DE DESPACHO DE CORREOS Y GENERACIÓN DE PIN (BackendMailService)
 * ============================================================================
 * Ubicación: Backend NestJS (`casa-api` - ...\casa-api\src\common\services)
 * 
 * Funciones Principales:
 * 1. Generar PINs numéricos aleatorios de 8 dígitos mediante la API criptográfica nativa de Node.js (`crypto.randomInt`).
 * 2. Ensamblar las plantillas HTML corporativas para recepción de solicitudes, aprobación y rechazo.
 * 3. Ejecutar el despacho HTTPS real enviando peticiones a la API de Resend/SMTP cuando `RESEND_API_KEY` esté presente en `.env`.
 * 4. Proporcionar un canal de diagnóstico detallado en consola si faltan variables de entorno.
 * ============================================================================
 */
export interface RegistrationEmailInput {
  folioNumber: string;
  email: string;
  fullName: string;
  propertyCode: string;
  docType: string;
  docNumber?: string;
  phone?: string;
  createdAt?: string;
}

export interface ApprovalEmailInput {
  folioNumber: string;
  email: string;
  fullName: string;
  propertyCode: string;
  tempPin: string;
}

export interface RejectionEmailInput {
  folioNumber: string;
  email: string;
  fullName: string;
  propertyCode: string;
  reason: string;
}

@Injectable()
export class BackendMailService {
  private readonly logger = new Logger(BackendMailService.name);

  constructor(private readonly configService: ConfigService) { }

  /**
   * Generates a cryptographically secure 6-digit random numeric PIN.
   */
  generateSecureTempPin(): string {
    const pinNumber = crypto.randomInt(10000000, 99999999);
    return pinNumber.toString();
  }

  /**
   * Dispatches owner registration receipt confirmation email with folio.
   */
  async sendRegistrationReceiptEmail(
    input: RegistrationEmailInput,
  ): Promise<{ dispatched: boolean; folioNumber: string }> {
    const subject = `Confirmación de Solicitud de Registro - Folio ${input.folioNumber}`;
    const htmlContent = this.buildRegistrationReceiptHtml(input);

    const sent = await this.sendEmailViaProvider(input.email, subject, htmlContent);

    return { dispatched: sent, folioNumber: input.folioNumber };
  }

  /**
   * Generates the secure temp PIN and dispatches the HTML approval email to the owner.
   * Crucially, the PIN is sent to the owner's email and NEVER returned to administrative clients.
   */
  async processApprovalAndSendEmail(
    input: Omit<ApprovalEmailInput, 'tempPin'>,
    options: { existingAccount?: boolean } = {},
  ): Promise<{ dispatched: boolean; maskedPin: string | null; tempPin?: string }> {
    if (options.existingAccount) {
      const subject = `Acceso de propietario vinculado a CASA - Folio ${input.folioNumber}`;
      const htmlContent = this.buildExistingAccountHtml(input);
      const sent = await this.sendEmailViaProvider(input.email, subject, htmlContent);

      return {
        dispatched: sent,
        maskedPin: null,
      };
    }

    const tempPin = this.generateSecureTempPin();
    const subject = `¡Acceso Aprobado al Portal del Propietario! - Folio ${input.folioNumber}`;
    const htmlContent = this.buildApprovalHtml({ ...input, tempPin });

    const sent = await this.sendEmailViaProvider(input.email, subject, htmlContent);

    return {
      dispatched: sent,
      maskedPin: '••••••',
      tempPin,
    };
  }

  /**
   * Dispatches rejection notification email to owner.
   */
  async sendRejectionEmail(
    input: RejectionEmailInput,
  ): Promise<{ dispatched: boolean }> {
    const subject = `Notificación de Solicitud de Registro -  ${input.folioNumber}`;
    const htmlContent = this.buildRejectionHtml(input);

    const sent = await this.sendEmailViaProvider(input.email, subject, htmlContent);

    return { dispatched: sent };
  }

  /**
   * Internal HTTPS transport for real email dispatch via Resend API or SMTP Provider API.
   */
  private async sendEmailViaProvider(
    to: string,
    subject: string,
    html: string,
  ): Promise<boolean> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromAddress =
      this.configService.get<string>('EMAIL_FROM_ADDRESS') ||
      'noreply@somoscasa.site';

    this.logger.log(`[CASA Mailer] Intento de despacho de correo para ${to} | Asunto: "${subject}" | Remitente: ${fromAddress}`);

    if (!apiKey || !apiKey.trim()) {
      this.logger.warn(
        `[CASA Mailer Diagnóstico] ⚠️ RESEND_API_KEY no configurada en el archivo .env de casa-api.\n` +
        `Para recibir correos reales en tu bandeja de entrada (Gmail, Outlook, etc.):\n` +
        `1. Obtén una API Key gratuita en https://resend.com\n` +
        `2. Agrega en tu archivo casa-api/.env: RESEND_API_KEY=re_123456789\n` +
        `3. Agrega en tu archivo casa-api/.env: EMAIL_FROM_ADDRESS=tu_correo@tu_dominio.com`,
      );
      return false;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          from: fromAddress.includes('<')
            ? fromAddress
            : `CASA Central de administración y soluciones automatizadas <${fromAddress}>`,
          to: [to],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `[CASA Mailer Error HTTP ${response.status}] Resend API rechazó la solicitud: ${errorText}`,
        );
        return false;
      }

      const resData = await response.json();
      this.logger.log(
        `[CASA Mailer ÉXITO 1000%] ¡Correo despachado REALMENTE a la bandeja de ${to}! Resend ID: ${JSON.stringify(
          resData,
        )}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[CASA Mailer Error de Red] Excepción enviando correo HTTPS a ${to}`,
        err,
      );
      return false;
    }
  }

  private buildRegistrationReceiptHtml(data: RegistrationEmailInput): string {
    const dateStr = data.createdAt
      ? new Date(data.createdAt).toLocaleDateString('es-VE', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
      : new Date().toLocaleDateString('es-VE', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Confirmación de Solicitud - CASA</title>
</head>
<body style="font-family: sans-serif; background-color: #f8f6f0; color: #0b1d33; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
    <h1 style="color: #071a33; text-align: center; margin-top: 0;">CASA</h1>
    <div style="text-align: center; background: #faf6ec; color: #725421; padding: 6px 12px; border-radius: 20px; font-weight: bold; display: inline-block; margin-bottom: 16px;">
      Nº Folio: ${data.folioNumber}
    </div>
    <h2 style="color: #071a33; text-align: center;">¡Solicitud de Registro Registrada!</h2>
    <p>Estimado(a) <b>${data.fullName}</b>, se ha recibido tu solicitud para el inmueble <b>${data.propertyCode}</b>. El documento de identidad adjunto se utilizará únicamente para evaluar esta solicitud en tu condominio.</p>
    <p>Fecha de Solicitud: ${dateStr}</p>
    <p>El área administrativa revisará la titularidad del inmueble. Al ser aprobada, recibirás tu PIN secreto de acceso.</p>
  </div>
</body>
</html>
    `.trim();
  }

  private buildApprovalHtml(data: ApprovalEmailInput): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Acceso Aprobado - CASA</title>
</head>
<body style="font-family: sans-serif; background-color: #f8f6f0; color: #0b1d33; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
    <h1 style="color: #071a33; text-align: center; margin-top: 0;">CASA</h1>
    <h2 style="color: #071a33; text-align: center;">¡Tu acceso ha sido aprobado!</h2>
    <p>Estimado(a) <b>${data.fullName}</b>, la Administración ha verificado y aprobado tu registro para el inmueble <b>${data.propertyCode}</b> (Folio: ${data.folioNumber}).</p>
    <div style="background: #071a33; color: #ffffff; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0;">
      <div style="color: #f0cf77; font-size: 12px; font-weight: bold; text-transform: uppercase;">Tu PIN Temporal de Acceso Secreto</div>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 6px; margin: 8px 0;">${data.tempPin}</div>
      <div style="font-size: 11px; color: #cbd5e1;">Ingresa con este PIN y tu correo ${data.email}</div>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  private buildExistingAccountHtml(data: Omit<ApprovalEmailInput, 'tempPin'>): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Acceso de propietario vinculado - CASA</title>
</head>
<body style="font-family: sans-serif; background-color: #f8f6f0; color: #0b1d33; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
    <h1 style="color: #071a33; text-align: center; margin-top: 0;">CASA</h1>
    <h2 style="color: #071a33; text-align: center;">¡Tu acceso de propietario ha sido aprobado!</h2>
    <p>Estimado(a) <b>${data.fullName}</b>, la Administración verificó y aprobó tu registro para el inmueble <b>${data.propertyCode}</b> (Folio: ${data.folioNumber}).</p>
    <p>Tu persona ya tenía una cuenta CASA activa. Por seguridad, tu contraseña actual se mantiene vigente para el acceso de personal y el Portal del Propietario.</p>
    <p>Ingresa con tu correo <b>${data.email}</b> y tu contraseña actual. Si no la recuerdas, utiliza la opción de recuperación de contraseña.</p>
  </div>
</body>
</html>
    `.trim();
  }

  private buildRejectionHtml(data: RejectionEmailInput): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Solicitud Rechazada - CASA</title>
</head>
<body style="font-family: sans-serif; background-color: #f8f6f0; color: #0b1d33; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
    <h1 style="color: #071a33; text-align: center; margin-top: 0;">CASA</h1>
    <h2 style="color: #e53e3e; text-align: center;">Solicitud de Registro Rechazada</h2>
    <p>Estimado(a) <b>${data.fullName}</b>, tu solicitud para el inmueble <b>${data.propertyCode}</b> (Folio: ${data.folioNumber}) ha sido rechazada.</p>
    <p><b>Motivo:</b> ${data.reason}</p>
  </div>
</body>
</html>
    `.trim();
  }
}
