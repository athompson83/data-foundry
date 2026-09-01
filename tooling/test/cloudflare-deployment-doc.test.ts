import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNBOOK = readFileSync(
  join(ROOT, 'docs', 'owner-actions', 'cloudflare-deployment.md'),
  'utf8',
);
const TRACKED_MANIFESTS =
  'apps/edge/wrangler.toml apps/web/wrangler.toml apps/usage-consumer/wrangler.toml apps/acquisition-worker/wrangler.toml apps/mcp-worker/wrangler.toml';

describe('the no-commit Cloudflare deployment check', () => {
  it('compares tracked manifests to HEAD so staged environment ids cannot pass', () => {
    expect(RUNBOOK).toContain(`git diff --exit-code HEAD -- ${TRACKED_MANIFESTS}`);
    expect(RUNBOOK).not.toContain(`git diff --exit-code -- ${TRACKED_MANIFESTS}`);
  });

  it('does not treat an ancestor runtime-fix commit as a deployable candidate', () => {
    expect(RUNBOOK).toContain('**Contain first; no Worker release candidate is currently designated.**');
    expect(RUNBOOK).toContain('Do not\n   select the ancestor from a checkout at the later head');
    expect(RUNBOOK).toContain('all six Worker bundles');
    expect(RUNBOOK).toContain('apps/private-canary');
  });
});
