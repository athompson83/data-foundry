import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
describe('ingestion production error boundaries', () => {
  it('lets the Queue retry a failed invocation with an opaque exception', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const message = { body: { version: 1, deliveryId: '11111111-1111-4111-8111-111111111111' }, ack: vi.fn(), retry: vi.fn() };
    try {
      await expect(worker.queue({ messages: [message] }, { VERTICAL_SLUG: 'synthetic-private-config' })).rejects.toThrow('INGESTION_QUEUE_FAILED');
      expect(message.ack).not.toHaveBeenCalled();
      expect(log.mock.calls).toEqual([['[ingestion-worker] queue unavailable', { code: 'INGESTION_QUEUE_FAILED' }]]);
    } finally { log.mockRestore(); }
  });
  it('makes scheduled dispatch failure visible without leaking its configuration', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(worker.scheduled({}, { VERTICAL_SLUG: 'synthetic-private-config' })).rejects.toThrow('INGESTION_OUTBOX_FAILED');
      expect(log.mock.calls).toEqual([['[ingestion-worker] outbox unavailable', { code: 'INGESTION_OUTBOX_FAILED' }]]);
    } finally { log.mockRestore(); }
  });
});
