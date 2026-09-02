import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8');

const README = read('README.md');
const CHECKLIST = read('PROJECT_CHECKLIST.md');
const PROGRESS = read('PROGRESS.md');
const RUNBOOK = read('docs', 'owner-actions', 'cloudflare-deployment.md');
const RECONCILIATION = read('docs', 'evidence', 'private-canary-readiness-reconciliation-20260901.md');
const REVENUE = read('docs', 'owner-actions', 'revenue-readiness.md');
const INDUSTRY = read('docs', 'adding-a-new-industry.md');
const SECURITY = read('SECURITY.md');

describe('private-canary provenance documentation', () => {
  it('keeps every current record from designating a Worker candidate from repository state', () => {
    for (const [name, text] of Object.entries({ README, CHECKLIST, PROGRESS, RUNBOOK, RECONCILIATION })) {
      expect(text, name).toContain('Repository state alone designates no Worker release candidate.');
    }
  });

  it('describes the artifact gate as six route-less artifacts with five targets and one harness', () => {
    for (const [name, text] of Object.entries({ README, CHECKLIST, PROGRESS, RUNBOOK, RECONCILIATION })) {
      expect(text, name).toMatch(/six\s+route-less\s+private-canary\s+Worker\s+artifacts/);
    }
    expect(README).toContain('five reduced target Workers');
    expect(RUNBOOK).toContain('private-canary harness (without Hyperdrive)');
    expect(RECONCILIATION).toContain('historical five-Worker artifact check');
  });

  it('distinguishes the ordinary five-Worker topology from the six temporary canary templates', () => {
    expect(README).toContain(
      'five ordinary Worker templates and the six route-less private-canary templates',
    );
  });

  it('records all five dedicated 14-day canary queues without repurposing the ordinary pair', () => {
    const dedicatedQueues = [
      'data-foundry-private-canary-usage-events',
      'data-foundry-private-canary-usage-events-dlq',
      'data-foundry-private-canary-events',
      'data-foundry-private-canary-dlq',
      'data-foundry-private-canary-quarantine',
    ];

    for (const [name, text] of Object.entries({ README, CHECKLIST, PROGRESS, RUNBOOK, RECONCILIATION })) {
      for (const queue of dedicatedQueues) {
        expect(text, `${name} should name ${queue}`).toContain(queue);
      }
      expect(text, `${name} should record the 14-day retention`).toMatch(/14[-\s]days?/i);
    }

    expect(RUNBOOK).toMatch(
      /only the\s+ordinary `data-foundry-usage-consumer` consumes `data-foundry-usage-events`/,
    );
    expect(RUNBOOK).toContain('must have no private-canary consumer');
  });

  it('uses ignored ordinary deployment manifests only as private-canary collision controls', () => {
    expect(RUNBOOK).toContain('five ignored ordinary deployment manifests as collision controls');
    expect(RUNBOOK).toContain('They are not deployment inputs for this canary phase');
    expect(RUNBOOK).toContain('all five ignored ordinary `wrangler.production.toml` manifests');
    expect(RUNBOOK).toContain('six ignored canary/harness manifests');
    for (const command of [
      'pnpm cloudflare:private-canary:deployment:check',
      'pnpm cloudflare:private-canary:targets:deployment:check',
      'pnpm cloudflare:private-canary:full-deployment:check',
    ]) {
      expect(RUNBOOK).toContain(command);
    }
    for (const app of ['edge', 'web', 'usage-consumer', 'acquisition-worker', 'mcp-worker']) {
      expect(RUNBOOK).toContain(
        `Copy-Item apps/${app}/wrangler.toml apps/${app}/wrangler.production.toml`,
      );
    }
  });

  it('records that the final candidate cannot be followed by a documentation-only commit', () => {
    const prohibition = /Do\s+not add a\s+documentation-only follow-up commit after that verification\./;
    expect(RUNBOOK).toMatch(prohibition);
    expect(RECONCILIATION).toMatch(prohibition);
  });

  it('keeps hosted history separate from the pending 0027 and 0028 repairs', () => {
    for (const [name, text] of Object.entries({ README, CHECKLIST, PROGRESS, RUNBOOK })) {
      expect(text, name).toMatch(/0027/);
      expect(text, name).toMatch(/0028/);
      expect(text, name).toMatch(/pending hosted|pending.*hosted/i);
      expect(text, name).toMatch(/57 .*warnings|57 .*search path/i);
    }
    expect(RUNBOOK).toMatch(/apply only the pending migrations \(`0027` and `0028`\)/);
    expect(RUNBOOK).toMatch(/Do not replay the 26 already-ledgered\s+migrations\./);
    expect(RUNBOOK).toMatch(/other 31 INFO notices are non-blocking/);
  });

  it('requires route-less proof before separately authorized public exposure', () => {
    expect(CHECKLIST).toMatch(/route-less, service-bound private canary/);
    expect(CHECKLIST).not.toContain('prove the replacement on `canary.aroqon.com` first');
    expect(REVENUE).toContain('Prove the route-less private canary.');
    expect(INDUSTRY).toMatch(/route-less,\s+service-bound private-canary prerequisite/);
  });

  it('records the authoritative zero-R2 refresh without reviving the stale bucket claim', () => {
    for (const [name, text] of Object.entries({ README, CHECKLIST, PROGRESS, SECURITY })) {
      expect(text, name).toMatch(/14-day|14 days/);
      expect(text, name).toMatch(/(?:zero|no)[\s\S]{0,120}R2/i);
      expect(text, name).toMatch(/standard usage model/);
    }
    expect(CHECKLIST).not.toContain('Approve Cloudflare Workers Paid at $5/month plus usage');
  });

  it('tracks provider-side sensitive-state containment as an explicit owner gate', () => {
    expect(CHECKLIST).toMatch(/\| UA-006 \|[^\n]*provider[^\n]*containment/i);
    expect(CHECKLIST).toContain('unable_to_target_from_sanitized_evidence');
    expect(PROGRESS).toMatch(/provider-side containment[^\n]*`UA-006`/i);
    expect(PROGRESS).toContain('`UA-001` through `UA-006`');
  });
});
