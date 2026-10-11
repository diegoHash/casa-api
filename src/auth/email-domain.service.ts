import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { resolveMx } from 'node:dns/promises';
import { domainToASCII } from 'node:url';

@Injectable()
export class EmailDomainService {
  async assertReceivesEmail(email: string): Promise<void> {
    const rawDomain = email.trim().split('@').pop()?.toLowerCase() ?? '';
    const domain = domainToASCII(rawDomain);
    if (!domain) {
      throw new BadRequestException('El dominio del correo no es válido.');
    }

    try {
      const records = await this.resolveMxWithTimeout(domain);
      if (!records.some((record) => record.exchange && record.exchange !== '.')) {
        throw new BadRequestException(
          `El dominio ${rawDomain} no está configurado para recibir correos.`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENODATA' || code === 'ENOTFOUND') {
        throw new BadRequestException(
          `El dominio ${rawDomain} no existe o no puede recibir correos. Revisa si está escrito correctamente.`,
        );
      }
      throw new ServiceUnavailableException(
        'No fue posible comprobar el dominio del correo. Intenta nuevamente.',
      );
    }
  }

  private async resolveMxWithTimeout(domain: string) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        resolveMx(domain),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })),
            5000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
