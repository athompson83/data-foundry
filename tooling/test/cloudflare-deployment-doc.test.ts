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

  it('does not treat a historical runtime-fix or pre-repair head as a deployable candidate', () => {
    expect(RUNBOOK).toMatch(
      /Containment is a provider-side gate; repository remediation continues\s+in\s+parallel\. Repository state alone designates no Worker release candidate\./,
    );
    expect(RUNBOOK).toContain('`effa3ec82c96e8f68d21ddc4d2b32919497dbddb`');
    expect(RUNBOOK).toMatch(/all six\s+route-less private-canary Worker artifacts/);
    expect(RUNBOOK).toContain('Do not add a\n   documentation-only follow-up commit after that verification.');
    expect(RUNBOOK).not.toContain('either make a clean checkout with `HEAD=df4a665...`');
  });

  it('keeps reduced target creation, cleanup, and rollback isolated from ordinary Workers', () => {
    expect(RUNBOOK).toContain('temporary dedicated Worker identities');
    expect(RUNBOOK).toContain('cleanup removes only those temporary identities');
    expect(RUNBOOK).toContain('rollback is deletion or disablement of the temporary canary identities');
    expect(RUNBOOK).toContain('without touching ordinary Worker configuration');
  });

  it('keeps the five dedicated canary queues isolated from ordinary usage metering', () => {
    expect(RUNBOOK).toContain(
      '| `data-foundry-private-canary-usage-events` | Dedicated reduced `edge` and `mcp-worker` targets only; synthetic metering only | `data-foundry-private-canary-usage-consumer` |',
    );
    expect(RUNBOOK).toContain(
      '| `data-foundry-private-canary-usage-events-dlq` | Cloudflare only, after the synthetic-metering consumer exhausts retries | No consumer |',
    );
    expect(RUNBOOK).toContain(
      '| `data-foundry-private-canary-events` | Authenticated synthetic fixture only; no public Worker producer | `data-foundry-private-canary-usage-consumer` |',
    );
    expect(RUNBOOK).toMatch(
      /only the\s+ordinary `data-foundry-usage-consumer` consumes `data-foundry-usage-events`/,
    );
    expect(RUNBOOK).toMatch(/all five\s+dedicated canary queues at 1,209,600 seconds \(14 days\)/);
    expect(RUNBOOK).not.toContain(
      '| `data-foundry-private-canary-events` | Authenticated synthetic fixture only; no public Worker producer | `data-foundry-usage-consumer` |',
    );
  });

  it('permits only exact non-grantable external runtime-role ACLs', () => {
    expect(RUNBOOK).toMatch(/non-grantable `USAGE` on\s+`extensions`/);
    expect(RUNBOOK).toMatch(/non-grantable `CONNECT` on exactly the current database/);
    expect(RUNBOOK).toMatch(/Inherited `PUBLIC` database `CONNECT`\/`TEMP`\s+remains distinct/);
    expect(RUNBOOK).toMatch(/inherited `PUBLIC` database `CREATE` is forbidden/);
    expect(RUNBOOK).toMatch(/catalog-attested extension-member routines/);
    expect(RUNBOOK).toMatch(/provider extension-member objects/i);
    expect(RUNBOOK).toMatch(
      /trigger and\s+event-trigger functions are outside this direct-call check/i,
    );
    expect(RUNBOOK).toMatch(/not the whole `extensions` namespace/);
    expect(RUNBOOK).toMatch(/unrelated public ACLs stay\s+untouched/);
  });

  it('keeps application migrations direct-TLS-only while permitting the exact grant packet after provider authorization', () => {
    expect(RUNBOOK).toMatch(
      /Application migrations remain direct-TLS-only; the\s+only\s+permitted export is the credential-free exact-SHA\s+`postMigrationGrants` payload\./,
    );
    expect(RUNBOOK).toContain(
      'node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha <40-character-release-SHA> > <non-secret-local-packet-path>',
    );
    expect(RUNBOOK).toMatch(
      /Do not submit `bootstrapSql`, `packets\[\]`, or their\s+application-migration `verificationSql` to a provider connector in this\s+workstream\./,
    );
    expect(RUNBOOK).toMatch(
      /NOLOGIN, nonprivileged, non-member roles with only\s+direct, non-grantable `CONNECT` on the current database and `USAGE` on\s+`extensions`/,
    );
    expect(RUNBOOK).toMatch(
      /On a fresh\s+unprovisioned installation, apply `sql` in one direct-TLS transaction before\s+running `verificationSql`/,
    );
    expect(RUNBOOK).toMatch(
      /On the hosted exact-legacy upgrade, migration\s+`0027` itself converts only the attested 200-grant acquisition shape to the\s+exact 199-grant shape; `0028` then adds only the four audited rights-path\s+indexes\. Do not reapply the grant installer/,
    );
    expect(RUNBOOK).toMatch(
      /`transactionContract\.liveUseAuthorized: false` and\s+provider-ledger atomicity `unverified` apply only to its archival connector\s+packets/,
    );
    expect(RUNBOOK).not.toContain(
      'The Supabase\n   connector-export material below is an archival alternative only',
    );
  });

  it('requires the entire non-ignored worktree to be clean for exact-SHA packet export', () => {
    expect(RUNBOOK).toMatch(/entire non-ignored worktree is\s+clean against `HEAD`/);
    expect(RUNBOOK).toMatch(/including\s+non-ignored\s+untracked files/);
    expect(RUNBOOK).not.toContain(
      'Unrelated working-tree files are not part of this source identity.',
    );
  });
});
