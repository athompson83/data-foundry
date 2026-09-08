import { describe, expect, it, vi } from 'vitest';
import { logConsumerError } from '../src/index.js';

describe('production usage consumer telemetry', () => {
  it('omits database exception contents, cause, row details and message targets', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const error = Object.assign(new Error('synthetic-private-query'), { detail: 'synthetic-private-row', cause: 'synthetic-private-connection' });
      logConsumerError(error, { stage: 'persist', messageId: 'synthetic-private-message' });
      expect(log.mock.calls).toEqual([['[usage-consumer] operation failed', { stage: 'persist', code: 'USAGE_CONSUMER_FAILURE' }]]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private');
    } finally { log.mockRestore(); }
  });
});
