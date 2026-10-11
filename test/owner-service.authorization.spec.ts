import { describe, expect, it, vi } from 'vitest';
import { OwnerServiceService } from '../src/owner-service/owner-service.service';

function serviceWith(prisma: object) {
  return new OwnerServiceService(prisma as never, {} as never, {} as never);
}

describe('OwnerServiceService · autorizaciones', () => {
  it('incluye autorizaciones aprobadas al consultar la comunidad sin filtro de estado', async () => {
    const approved = {
      id: 'authorization-approved',
      communityId: 'community-a',
      status: 'APPROVED',
    };
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([approved]);
    const service = serviceWith({
      serviceAuthorization: { count, findMany },
    });

    const result = await service.listAuthorizations('community-a', {
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toEqual([approved]);
    expect(result.total).toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: { communityId: 'community-a' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 'community-a' },
      }),
    );
  });
});
