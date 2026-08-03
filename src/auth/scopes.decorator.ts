import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_KEY = 'required-scopes';

export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
