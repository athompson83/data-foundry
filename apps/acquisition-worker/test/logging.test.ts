import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
describe('scheduled acquisition production error boundary', () => {
  it('reports failure without retaining configuration exception text or cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(worker.scheduled({ scheduledTime: 0, cron: '0 * * * *' }, { VERTICAL_SLUG: 'synthetic-private-config' }))
        .rejects.toThrow('ACQUISITION_CYCLE_FAILED');
      expect(log.mock.calls).toEqual([['[acquisition-worker] cycle unavailable', { code: 'ACQUISITION_CYCLE_FAILED' }]]);
    } finally { log.mockRestore(); }
  });
});
