import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Lockfile {
  readonly packages?: Readonly<Record<string, unknown>>;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('production dependency security policy', () => {
  it('resolves node-tar only to versions containing the August 2026 security fixes', () => {
    const lockfile = parseYaml(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')) as Lockfile;
    const tarVersions = Object.keys(lockfile.packages ?? {})
      .map((key) => /^tar@(\d+\.\d+\.\d+)$/.exec(key)?.[1])
      .filter((version): version is string => version !== undefined);

    expect(
      tarVersions.filter((version) => compareVersions(version, '7.5.21') < 0),
      'node-tar before 7.5.21 is covered by the active critical/high Dependabot advisories',
    ).toEqual([]);
  });
});
