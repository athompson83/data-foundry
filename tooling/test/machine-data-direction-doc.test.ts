import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8');

const AGENTS = read('AGENTS.md');
const ADR = read('docs', 'decisions', 'ADR-0012-machine-data-portfolio-and-capability-hostnames.md');
const REVENUE_PLAN = read('docs', 'superpowers', 'plans', '2026-09-08-recurring-revenue-platform.md');

describe('standing multi-dataset machine-data direction', () => {
  it('makes the portfolio business direction visible to every agent session', () => {
    expect(AGENTS).toContain('multi-dataset, multi-industry machine-data platform');
    expect(AGENTS).toContain('HVAC is the reference vertical and first factory proof');
    expect(AGENTS).toContain('The primary expansion unit is a useful dataset/data product');
    expect(AGENTS).toContain('Machine consumption is the commercial center');
    expect(AGENTS).toContain('Measure commercial usefulness, not database size');
  });

  it('keeps canonical public hostnames capability-based rather than industry-based', () => {
    for (const text of [AGENTS, ADR, REVENUE_PLAN]) {
      expect(text).toContain('data.aroqon.com');
      expect(text).toContain('api.data.aroqon.com');
      expect(text).toContain('mcp.data.aroqon.com');
    }

    expect(ADR).toContain('Do not make a new public API or MCP hostname the default cost of adding a dataset.');
    expect(REVENUE_PLAN).toContain('superseded as canonical long-term architecture before public deployment');
  });

  it('does not turn canonical hostname normalization into an unsafe Worker refactor', () => {
    expect(AGENTS).toContain("Preserve ADR-0011's currently implemented per-vertical edge isolation");
    expect(ADR).toContain('Do **not** refactor the current per-vertical edge Worker merely to satisfy this ADR before first revenue.');
    expect(ADR).toContain('A future consolidation to one multi-vertical API Worker requires its own evidence and review');
  });

  it('keeps rights and deployment gates independent of the commercial direction', () => {
    for (const text of [AGENTS, ADR, REVENUE_PLAN]) {
      expect(text).toMatch(/rights/i);
      expect(text).toMatch(/private-canary|private canary/i);
    }
    expect(AGENTS).toContain('One truth does not mean one permission');
    expect(ADR).toContain('This ADR does not itself authorize public DNS or route changes.');
    expect(REVENUE_PLAN).toContain('does **not** authorize public DNS cutover');
  });
});
