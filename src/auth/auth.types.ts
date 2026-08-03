import { PlatformRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  platformRole: PlatformRole | null;
  tokenVersion: number;
  communityId?: string;
  communityRole?: string;
  scopes?: string[];
  workspaces?: string[];
  type: 'access';
  iat: number;
  exp: number;
  jti: string;
}

export interface AuthPrincipal {
  userId: string;
  email: string;
  platformRole: PlatformRole | null;
  tokenVersion: number;
  communityId?: string;
  communityRole?: string;
  scopes: string[];
  workspaces: string[];
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}
