import { describe, expect, it } from 'vitest';

describe('integration database safety', () => {
  it('runs only against an explicitly designated test database', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DATABASE_URL).toMatch(/_test(?:\?|$)/);
  });
});
