import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { TokenService } from '../src/auth/token.service';

function createService(accessTtlSeconds = 900) {
  return new TokenService(
    new ConfigService({
      JWT_ACCESS_SECRET: 'test-secret-with-at-least-thirty-two-characters',
      JWT_ACCESS_TTL_SECONDS: accessTtlSeconds,
      REFRESH_TOKEN_TTL_DAYS: 30,
    }),
  );
}

describe('TokenService', () => {
  it('issues and verifies a signed access token', () => {
    const service = createService();
    const issued = service.issueAccessToken({
      sub: 'root-id',
      email: 'root@somoscasa.site',
      platformRole: PlatformRole.ROOT,
      tokenVersion: 0,
    });
    const payload = service.verifyAccessToken(issued.accessToken);

    expect(payload.sub).toBe('root-id');
    expect(payload.platformRole).toBe(PlatformRole.ROOT);
    expect(payload.type).toBe('access');
    expect(issued.expiresIn).toBe(900);
  });

  it('rejects a token whose signature was modified', () => {
    const service = createService();
    const issued = service.issueAccessToken({
      sub: 'root-id',
      email: 'root@somoscasa.site',
      platformRole: PlatformRole.ROOT,
      tokenVersion: 0,
    });
    const tampered = `${issued.accessToken.slice(0, -1)}x`;

    expect(() => service.verifyAccessToken(tampered)).toThrow(
      UnauthorizedException,
    );
  });

  it('creates opaque refresh tokens and stores only their hash', () => {
    const service = createService();
    const issued = service.issueRefreshToken();

    expect(issued.refreshToken).not.toBe(issued.tokenHash);
    expect(issued.tokenHash).toHaveLength(64);
    expect(service.hashRefreshToken(issued.refreshToken)).toBe(
      issued.tokenHash,
    );
  });
});
