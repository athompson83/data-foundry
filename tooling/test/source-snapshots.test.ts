/**
 * Source snapshots archived to R2 (AGENTS.md rule 10). The plan lists only sources with a rights record and only
 * open https endpoints; the workflow is manual, main-only, environment-protected, pins its actions, reads the
 * Cloudflare credential only after the snapshot is on disk, and verifies the stored bytes by read-back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Plan = { bucket: string; prefix: string; sources: Record<string, { rights_record: string; files: { name: string; url: string }[] }> };
const plan = JSON.parse(readFileSync(join(ROOT, 'tooling', 'snapshots', 'plans.json'), 'utf8')) as Plan;
type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
const workflowSource = readFileSync(join(ROOT, '.github', 'workflows', 'archive-source-snapshot.yml'), 'utf8');
const workflow = parseYaml(workflowSource) as { on: Record<string, unknown>; jobs: Record<string, { environment?: string; steps: Step[] }> };

describe('source snapshots', () => {
  it('archives only into the raw-artifacts bucket under the snapshots prefix', () => {
    expect(plan.bucket).toBe('data-foundry-raw-artifacts');
    expect(plan.prefix).toBe('research/pipeline/snapshots');
  });

  it.each(Object.entries(plan.sources))('%s has a rights record and only open https endpoints', (key, source) => {
    expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(source.rights_record).toMatch(/^docs\/sources\/[a-z0-9-]+-rights-record-\d{8}\.md$/);
    expect(existsSync(join(ROOT, source.rights_record)), `${source.rights_record} exists`).toBe(true);
    expect(source.files.length).toBeGreaterThan(0);
    const names = source.files.map((file) => file.name);
    expect(new Set(names).size).toBe(names.length);
    for (const file of source.files) {
      expect(file.name).toMatch(/^[A-Za-z0-9._-]+$/);
      const url = new URL(file.url);
      expect(url.protocol).toBe('https:');
      expect(url.username + url.password, 'no credentials in a URL').toBe('');
      expect(file.url).not.toMatch(/token|apikey|api_key|secret/i);
    }
  });

  it('is manual, main-only, environment-protected and pins its actions', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const job = workflow.jobs['archive']!;
    expect(job.environment).toBe('production');
    const guard = job.steps[0]!;
    expect(guard.run).toContain('refs/heads/main');
    for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('downloads without credentials and verifies the upload by read-back', () => {
    const steps = workflow.jobs['archive']!.steps;
    const download = steps.find((step) => step.run?.includes('snapshot-source.sh'))!;
    expect(download.env?.['CLOUDFLARE_API_TOKEN']).toBeUndefined();
    const upload = steps.find((step) => step.run?.includes('wrangler r2 object put'))!;
    expect(upload.run).toContain('wrangler r2 object get');
    expect(upload.run).toMatch(/read-back SHA-256/);
    expect(workflowSource).not.toMatch(/echo[^\n]*\$\{?CLOUDFLARE_API_TOKEN/);
  });
});
