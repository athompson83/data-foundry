import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const CHECKLIST = readFileSync(join(ROOT, 'PROJECT_CHECKLIST.md'), 'utf8');
const PROGRESS = readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8');
const RUNBOOK = readFileSync(
  join(ROOT, 'docs', 'owner-actions', 'cloudflare-deployment.md'),
  'utf8',
);
const PRODUCTION_LAUNCH_ORDER = RUNBOOK.split('## 9. Production launch order')[1] ?? '';
const CURRENT_WORKSTREAM = RUNBOOK.split('## 1. Cloudflare account')[0] ?? '';
const HYPERDRIVE_SECTION =
  RUNBOOK.split('## 2. Hyperdrive binding to Postgres')[1]?.split('## 3. Vercel review')[0] ?? '';
const TRACKED_MANIFESTS =
  'apps/edge/wrangler.toml apps/web/wrangler.toml apps/usage-consumer/wrangler.toml apps/acquisition-worker/wrangler.toml apps/ingestion-worker/wrangler.toml apps/mcp-worker/wrangler.toml';
const PR_26_HEAD = '8a43b7f7600fef10c1b26f0281a4c087f8610373';
const PR_26_MERGE = '02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493';

describe('the no-commit Cloudflare deployment check', () => {
  it('compares tracked manifests to HEAD so staged environment ids cannot pass', () => {
    expect(RUNBOOK).toContain(`git diff --exit-code HEAD -- ${TRACKED_MANIFESTS}`);
    expect(RUNBOOK).not.toContain(`git diff --exit-code -- ${TRACKED_MANIFESTS}`);
  });

  it('records the protected PR merge without treating any repository SHA as deployed', () => {
    expect(RUNBOOK).toMatch(
      /Containment is a provider-side gate; repository remediation continues\s+in\s+parallel\. Repository state alone designates no Worker release candidate\./,
    );
    expect(RUNBOOK).toContain('`effa3ec82c96e8f68d21ddc4d2b32919497dbddb`');
    expect(RUNBOOK).toMatch(
      /PR #26 merged normally into protected `main` as\s+`02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` from reviewed head\s+`8a43b7f7600fef10c1b26f0281a4c087f8610373`/,
    );
    for (const document of [RUNBOOK, PROGRESS, CHECKLIST]) {
      expect(document).toContain(`\`${PR_26_HEAD}\``);
      expect(document).toContain(`\`${PR_26_MERGE}\``);
      expect(document).not.toMatch(/`8a43b7f`|`02e90d7`/);
    }
    expect(RUNBOOK).toMatch(/all seven\s+route-less private-canary Worker artifacts/);
    const laterCommitGate =
      /Any later\s+commit, including documentation-only, creates a\s+new release SHA and requires\s+fresh exact-SHA checks/;
    expect(RUNBOOK).toMatch(laterCommitGate);
    expect(README).toMatch(laterCommitGate);
    expect(PROGRESS).toMatch(
      /Every later commit, including\s+documentation-only, creates a new repository SHA and requires fresh exact-SHA\s+local, hosted-CI, review, and ruleset evidence/,
    );
    expect(PROGRESS).not.toContain('candidate-affecting change');
    expect(RUNBOOK).not.toContain('Any PR #26 head may merge normally');
    expect(RUNBOOK).not.toContain(
      'Do not add a\n   documentation-only follow-up commit after that verification.',
    );
    expect(README).not.toMatch(/do not add a documentation-only follow-up commit/i);
    expect(RUNBOOK).not.toContain('either make a clean checkout with `HEAD=df4a665...`');
  });

  it('does not mistake available Wrangler authentication for provider authorization', () => {
    expect(RUNBOOK).toMatch(
      /Wrangler authentication is available in the current verification environment,\s+but provider-side containment `UA-006` explicitly blocks using it for mutation\s+or deployment\./,
    );
    expect(RUNBOOK).toContain('Authentication is not authorization');
    expect(RUNBOOK).not.toContain('Wrangler is unauthenticated in the verification environment');
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
      /On the hosted exact-legacy upgrade, migration\s+`0027` itself converts only the attested 200-grant acquisition shape to the\s+exact 199-grant shape; `0028` then adds only the four audited rights-path\s+indexes\./,
    );
    expect(RUNBOOK).toMatch(
      /`transactionContract\.liveUseAuthorized: false` and\s+provider-ledger atomicity `unverified` apply only to its archival connector\s+packets/,
    );
    expect(RUNBOOK).not.toContain(
      'The Supabase\n   connector-export material below is an archival alternative only',
    );
    expect(RUNBOOK).toMatch(
      /SELECT count\(\*\)::bigint AS duplicate_decision_groups\s+FROM \(\s+SELECT decision_id\s+FROM data_foundry\.rights_decision_activation_events\s+GROUP BY decision_id\s+HAVING count\(\*\) > 1\s+\) AS duplicate_decisions;/,
    );
    expect(RUNBOOK).toMatch(/duplicates are immutable rights history and must go to owner\/legal\s+review rather than automated cleanup/);
  });

  it('requires the entire non-ignored worktree to be clean for exact-SHA packet export', () => {
    expect(RUNBOOK).toMatch(/entire non-ignored worktree is\s+clean against `HEAD`/);
    expect(RUNBOOK).toMatch(/including\s+non-ignored\s+untracked files/);
    expect(RUNBOOK).not.toContain(
      'Unrelated working-tree files are not part of this source identity.',
    );
  });

  it('requires the full candidate migration chain and explicit legacy-grant upgrade before runtime credentials', () => {
    expect(CURRENT_WORKSTREAM).toContain('currently `0033`');
    expect(HYPERDRIVE_SECTION).toContain('postMigrationGrants.upgradeFrom0028Sql');
    expect(HYPERDRIVE_SECTION).toContain('frozen 199-grant');
    expect(HYPERDRIVE_SECTION).toContain('Unknown ACL drift');
    expect(HYPERDRIVE_SECTION).toMatch(/Do not assign any runtime password or\s+enable runtime `LOGIN` until/);
    expect(PRODUCTION_LAUNCH_ORDER).toContain('That repository baseline authorizes no Alpha Lab mutation.');
    expect(PRODUCTION_LAUNCH_ORDER).toContain('only after `UA-006`');
    expect(PRODUCTION_LAUNCH_ORDER).toContain('`0001`–`0026` ledger');
    expect(PRODUCTION_LAUNCH_ORDER).toMatch(/never\s+in `public`/);
    expect(PRODUCTION_LAUNCH_ORDER).toContain('rerun the migration as a no-op');
    expect(PRODUCTION_LAUNCH_ORDER).toContain('`postMigrationGrants.verificationSql`');
    expect(PRODUCTION_LAUNCH_ORDER).toContain('`postMigrationGrants.postCredentialVerificationSql`');
    expect(PRODUCTION_LAUNCH_ORDER).toMatch(/through all six direct\s+credential paths and require all six role checks to pass/);
    expect(PRODUCTION_LAUNCH_ORDER).toContain('six matching cache-disabled Hyperdrives');
    expect(PRODUCTION_LAUNCH_ORDER).toContain('seven route-less private-canary Worker artifacts');
  });

  it('keeps the owner-facing credential and deployment sequence explicit', () => {
    const ua002 = CHECKLIST.split(/\r?\n/).find((line) => line.startsWith('| UA-002 |')) ?? '';
    for (const document of [CURRENT_WORKSTREAM]) {
      expect(document).toContain('postMigrationGrants.verificationSql');
      expect(document).toContain('postMigrationGrants.postCredentialVerificationSql');
      expect(document).toContain('pnpm runtime-roles:postgres:check');
    }
    expect(ua002).toContain('upgradeFrom0028Sql/verificationSql before runtime LOGIN');
    expect(ua002).toContain('postCredentialVerificationSql and all six direct runtime probes before Hyperdrives');
    expect(CURRENT_WORKSTREAM).toMatch(/all six runtime roles remain staged `NOLOGIN` and\s+passwordless/);
    expect(CURRENT_WORKSTREAM).toMatch(/Both must pass before any Hyperdrive is created/);
    expect(CURRENT_WORKSTREAM).toContain('six roles');
    expect(CURRENT_WORKSTREAM).toContain('exact generated function and grant inventories');
    expect(PROGRESS).toContain('postMigrationGrants.verificationSql');
    expect(PROGRESS).toContain('postMigrationGrants.postCredentialVerificationSql');
    expect(PROGRESS).toContain('pnpm runtime-roles:postgres:check');
  });
});


it('keeps the extra synthetic phase separate, fixed, isolated and reversible', () => {
  for (const assurance of ['fourteenth configuration', 'same', 'suspend the harness', 'ordinary ingestion Worker remains undeployed',
    'data-foundry-private-ingestion-artifacts', 'exactly one successful `FETCHED` artifact', 'Restore the exact reduced',
    'verify the synthetic R2 and Queue consumer bindings are gone', 'OPS_ALERTS_ENABLED = "false"', 'allowed_sender_addresses = [OPS_ALERT_FROM]']) {
    expect(RUNBOOK).toContain(assurance);
  }
});
