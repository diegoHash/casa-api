import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_KEY = 'required-scopes';
export const REQUIRED_ANY_SCOPES_KEY = 'required-any-scopes';

export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);

export const RequireAnyScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_ANY_SCOPES_KEY, scopes);
