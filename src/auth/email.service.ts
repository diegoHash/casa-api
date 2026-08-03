import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

type PasswordResetEmail = {
  to: string;
  displayName: string;
  pin: string;
  resetUrl: string;
  expiresInMinutes: number;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordReset(input: PasswordResetEmail) {
    const apiToken = this.config.get<string>('RESEND_API_KEY');
    const fromAddress =
      this.config.get<string>('EMAIL_FROM_ADDRESS') ??
      'noreply@somoscasa.site';
    const replyTo = this.config.get<string>('EMAIL_REPLY_TO')?.trim();
    if (!apiToken) {
      this.logger.warn(
        'Correo de recuperación preparado, pero Resend no está configurado.',
      );
      return { delivered: false, configured: false };
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({
          to: [input.to],
          from: `CASA Seguridad <${fromAddress}>`,
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: 'Restablece tu contraseña de CASA',
          html: this.passwordResetHtml(input),
          text: this.passwordResetText(input),
          tags: [{ name: 'category', value: 'password_reset' }],
        }),
      });
    if (!response.ok) {
      this.logger.error(
        `Resend rechazó una recuperación con estado ${response.status}.`,
      );
      return { delivered: false, configured: true };
    }
    const result = (await response.json()) as { id?: string };
    return {
      delivered: true,
      configured: true,
      provider: 'resend',
      messageId: result.id ?? null,
    };
  }

  private passwordResetText(input: PasswordResetEmail) {
    return [
      `Hola ${input.displayName},`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña de CASA.',
      `PIN de verificación: ${input.pin}`,
      `Enlace de un solo uso: ${input.resetUrl}`,
      `Expira en ${input.expiresInMinutes} minutos.`,
      '',
      'Si no solicitaste este cambio, ignora este mensaje.',
      'CASA · Tu comunidad. Un solo ecosistema.',
    ].join('\n');
  }

  private passwordResetHtml(input: PasswordResetEmail) {
    const webUrl = (
      this.config.get<string>('PUBLIC_WEB_URL') ?? 'https://somoscasa.site'
    ).replace(/\/$/, '');
    const safeName = this.escape(input.displayName);
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Restablecer contraseña CASA</title></head>
<body style="margin:0;background:#f5f3ee;font-family:Inter,Arial,sans-serif;color:#071a33">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ee;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e7e2d8">
        <tr><td style="background:#071a33;padding:28px 32px;text-align:center">
          <img src="${webUrl}/casa-wordmark-dark.png" width="150" alt="CASA" style="display:inline-block;max-width:150px;height:auto">
        </td></tr>
        <tr><td style="padding:36px 32px">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9a742b">Seguridad de la cuenta</div>
          <h1 style="margin:12px 0 14px;font-size:28px;line-height:1.2;color:#071a33">Restablece tu contraseña</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#526174">Hola ${safeName}. Recibimos una solicitud para crear una nueva contraseña de acceso a CASA.</p>
          <div style="background:#f6f0e4;border:1px solid #e2ca94;border-radius:16px;padding:20px;text-align:center">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#85631f">PIN de verificación</div>
            <div style="margin-top:8px;font-size:34px;font-weight:800;letter-spacing:8px;color:#071a33">${input.pin}</div>
          </div>
          <div style="text-align:center;margin:26px 0">
            <a href="${input.resetUrl}" style="display:inline-block;background:#071a33;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 24px;border-radius:999px">Crear nueva contraseña</a>
          </div>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#7b8796">El PIN y el enlace son de un solo uso y vencen en ${input.expiresInMinutes} minutos. Al completar el cambio, CASA cerrará las sesiones anteriores.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #eee9df;padding:22px 32px;text-align:center;font-size:12px;color:#8993a0">CASA · Tu comunidad. Un solo ecosistema.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
