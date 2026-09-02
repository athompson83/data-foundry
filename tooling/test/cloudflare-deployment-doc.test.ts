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
    expect(RUNBOOK).toMatch(
      /Inherited `PUBLIC` database `CONNECT`\/`TEMP`\s+on the current database remains distinct/i,
    );
    expect(RUNBOOK).toMatch(/inherited `PUBLIC` database `CREATE` is forbidden/);
    expect(RUNBOOK).toMatch(/database `CREATE` is forbidden on every database/i);
    expect(RUNBOOK).toMatch(/`CONNECT` to every other live non-template database is forbidden/i);
    expect(RUNBOOK).toMatch(/Catalog-marked templates are an explicit\s+provider\/system boundary/i);
    expect(RUNBOOK).toMatch(/exact whole-object extension membership/i);
    expect(RUNBOOK).toMatch(/`objsubid` and `refobjsubid` are both zero/i);
    expect(RUNBOOK).toMatch(/address-generic\s+`pg_catalog\.pg_shdepend` scan rejects every owner dependency/i);
    expect(RUNBOOK).toMatch(/non-extension text-search dictionaries, foreign\s+servers, and shared database objects/i);
    expect(RUNBOOK).toMatch(/provider extension-member objects/i);
    expect(RUNBOOK).toMatch(
      /trigger and\s+event-trigger functions are outside this direct-call check/i,
    );
    expect(RUNBOOK).toMatch(/not the whole `extensions` namespace/);
    expect(RUNBOOK).toMatch(/unrelated public ACLs stay\s+untouched/);
    expect(RUNBOOK).toMatch(/both `session_user`\s+and `current_user` equal to `df_migration`/i);
    expect(RUNBOOK).toMatch(/`LOGIN`,\s+`NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`/i);
    expect(RUNBOOK).toMatch(/may not be a member of another role/i);
    expect(RUNBOOK).toMatch(/session_replication_role=origin/i);
    expect(RUNBOOK).toMatch(/incoming member of `df_migration` solely to run/i);
    expect(RUNBOOK).toMatch(/exactly one current-database `pg_db_role_setting` row/i);
    expect(RUNBOOK).toMatch(/no role-global setting row/i);
    expect(RUNBOOK).toMatch(
      /effective `SET` or `ALTER SYSTEM`\s+on\s+any ACL-governed parameter represented in `pg_parameter_acl`/i,
    );
    expect(RUNBOOK).toMatch(
      /effective foreign-data-wrapper or foreign-server `USAGE`,\s+including through `PUBLIC`/i,
    );
    expect(RUNBOOK).toMatch(
      /`df_migration` may not own a\s+foreign table even in `data_foundry`/i,
    );
    expect(RUNBOOK).toMatch(/large-object\s+ownership or effective `SELECT` or `UPDATE`\s+access/i);
    expect(RUNBOOK).toMatch(/`lo_compat_privileges=on`/);
    expect(RUNBOOK).toMatch(/defaults for future functions, tables, and sequences/i);
    expect(RUNBOOK).toMatch(/both its global\s+default ACLs/i);
    expect(RUNBOOK).toMatch(/hard-wired `PUBLIC EXECUTE`/i);
    expect(RUNBOOK).toMatch(/schema-specific default ACLs/i);
    expect(RUNBOOK).toMatch(
      /global or\s+schema-specific default privilege for future functions, tables, or\s+sequences granted to `PUBLIC` or another non-owner role/i,
    );
    expect(RUNBOOK).toMatch(
      /rechecks\s+the full migration-role posture, durable settings, external privilege and ownership\s+boundary, live session safety, and effective default ACLs before and after each\s+pending migration/i,
    );
    expect(RUNBOOK).toMatch(
      /exact configured and resolved `search_path`\s+to be\s+`data_foundry, pg_catalog, extensions`/i,
    );
    expect(RUNBOOK).toMatch(/any drift is rolled back before its\s+ledger write/i);
    expect(RUNBOOK).toMatch(
      /reasserts `current_user=df_migration` after `SET LOCAL ROLE`\s+and after\s+each migration/i,
    );
    expect(RUNBOOK).toContain(
      'ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;',
    );
    expect(RUNBOOK).toContain(
      'ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;',
    );
    expect(RUNBOOK).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA data_foundry REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    );
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
