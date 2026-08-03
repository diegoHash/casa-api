import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('stores a one-way hash and validates the original password', async () => {
    const password = 'Casa!Clave-Segura-2026';
    const encoded = await service.hash(password);

    expect(encoded).not.toContain(password);
    expect(encoded.startsWith('scrypt$')).toBe(true);
    await expect(service.verify(password, encoded)).resolves.toBe(true);
    await expect(service.verify('clave-incorrecta', encoded)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed hashes without comparing credentials', async () => {
    await expect(
      service.verify('cualquier-clave', 'hash-invalido'),
    ).resolves.toBe(false);
  });
});
