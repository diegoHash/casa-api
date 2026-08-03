import { HealthController } from '../src/health/health.controller';
import { describe, expect, it } from 'vitest';

describe('HealthController', () => {
  it('reports the API as healthy', () => {
    const controller = new HealthController();
    const result = controller.getHealth();

    expect(result.service).toBe('casa-api');
    expect(result.status).toBe('ok');
    expect(Date.parse(result.timestamp)).not.toBeNaN();
  });
});
