import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { AccessTokenPayload } from './auth.types';

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };

function encodePart(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.accessTtlSeconds = config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    this.refreshTtlDays = config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
  }

  issueAccessToken(
    claims: Omit<AccessTokenPayload, 'type' | 'iat' | 'exp' | 'jti'>,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      ...claims,
      type: 'access',
      iat: now,
      exp: now + this.accessTtlSeconds,
      jti: randomUUID(),
    };
    const unsigned = `${encodePart(JWT_HEADER)}.${encodePart(payload)}`;
    const signature = createHmac('sha256', this.secret)
      .update(unsigned)
      .digest('base64url');

    return {
      accessToken: `${unsigned}.${signature}`,
      expiresIn: this.accessTtlSeconds,
    };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Token de acceso inválido.');
    }
    const [header, payload, signature] = parts;
    const expected = createHmac('sha256', this.secret)
      .update(`${header}.${payload}`)
      .digest();
    const canonicalSignature = expected.toString('base64url');
    const signatureBytes = Buffer.from(signature);
    const canonicalBytes = Buffer.from(canonicalSignature);
    const received = Buffer.from(signature, 'base64url');
    if (
      signatureBytes.length !== canonicalBytes.length ||
      !timingSafeEqual(signatureBytes, canonicalBytes) ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Firma de acceso inválida.');
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as AccessTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (
        parsed.type !== 'access' ||
        !parsed.sub ||
        !parsed.email ||
        !Number.isInteger(parsed.exp) ||
        parsed.exp <= now
      ) {
        throw new Error('Expired or malformed token');
      }
      return parsed;
    } catch {
      throw new UnauthorizedException('Token de acceso vencido o mal formado.');
    }
  }

  issueRefreshToken() {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTtlDays);
    return {
      refreshToken,
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt,
    };
  }

  hashRefreshToken(refreshToken: string) {
    return createHash('sha256').update(refreshToken).digest('hex');
  }
}
