/** Compile exact scheduled-acquisition targets for filesystem-free Workers. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  RefreshPolicySchema,
  RIGHTS_ASSET_CLASSES,
  RIGHTS_OUTPUT_CLASSES,
  SchemaVersionSchema,
  VerticalStatusSchema,
} from '@data-foundry/canonical-schema';
import {
  stableStringify,
  type AcquisitionRuntime,
  type AcquisitionRuntimeTarget,
} from '../../packages/acquisition/src/index.js';
import { parseSourceRegistryEntry } from '@data-foundry/source-registry';
import { isMain } from '../lib/cli-entry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'apps', 'acquisition-worker', 'generated');

const CANONICAL_HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::([1-9][0-9]{0,4}))?$/;
const canonicalHttpsOrigin = (value: string): boolean => {
  const match = CANONICAL_HTTPS_ORIGIN.exec(value);
  if (match === null) return false;
  const port = match[1] === undefined ? null : Number(match[1]);
  if (port !== null && (port > 65_535 || port === 443)) return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.pathname === '/' && parsed.search === '' &&
      parsed.hash === '' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
};

const TargetSchema = z.strictObject({
  target_id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  source_key: z.string().min(1),
  target_url: z.url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.href === value && parsed.hash === '' &&
      parsed.username === '' && parsed.password === '' &&
      !value.includes('\\') && !/%(?:2e|2f|5c)/i.test(value);
  }, 'must be a canonical traversal-free HTTPS URL'),
  result_url_policy: z.strictObject({
    allowedOrigins: z.array(
      z.string().refine(canonicalHttpsOrigin, 'must be a lowercase canonical HTTPS origin'),
    ).length(1, 'exactly one origin is required'),
    allowedPathPrefixes: z.array(
      z.string().startsWith('/').refine(
        (value) => !value.includes('?') && !value.includes('#') && !value.includes('\\') &&
          !/%(?:2e|2f|5c)/i.test(value) && !value.split('/').includes('..'),
        'must be a query-free, fragment-free absolute path prefix',
      ),
    ).min(1).max(32).refine(
      (values) => new Set(values).size === values.length,
      'path prefixes must be unique',
    ),
  }),
  asset_class: z.enum(RIGHTS_ASSET_CLASSES),
  output_class: z.enum(RIGHTS_OUTPUT_CLASSES),
});
const AcquisitionConfigSchema = z.strictObject({
  version: z.literal(1),
  targets: z.array(TargetSchema).min(1),
});

export interface CompileAcquisitionRuntimeOptions {
  readonly outputDir?: string;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');

export async function compileAcquisitionRuntime(slug: string): Promise<AcquisitionRuntime> {
  const verticalDir = join(REPO_ROOT, 'verticals', slug);
  const vertical = parseYaml(await readFile(join(verticalDir, 'vertical.yaml'), 'utf8')) as {
    slug?: unknown;
    name?: unknown;
    schema_version?: unknown;
    status?: unknown;
    default_refresh_policy?: unknown;
    config?: { acquisition?: unknown };
  };
  if (vertical.slug !== slug) throw new Error(`vertical.yaml does not declare ${slug}`);
  const name = z.string().min(1).max(200).parse(vertical.name);
  const schemaVersion = SchemaVersionSchema.parse(vertical.schema_version);
  const status = VerticalStatusSchema.parse(vertical.status);
  const configPath = vertical.config?.acquisition;
  if (typeof configPath !== 'string' || configPath.trim() === '') {
    throw new Error(`${slug}/vertical.yaml must declare config.acquisition`);
  }
  const config = AcquisitionConfigSchema.parse(
    parseYaml(await readFile(join(verticalDir, configPath), 'utf8')),
  );
  const policy = RefreshPolicySchema.parse(vertical.default_refresh_policy);

  const sources = new Map<string, ReturnType<typeof parseSourceRegistryEntry>>();
  for (const filename of (await readdir(join(verticalDir, 'sources'))).filter((name) => name.endsWith('.yaml')).sort()) {
    const parsed = parseSourceRegistryEntry(
      parseYaml(await readFile(join(verticalDir, 'sources', filename), 'utf8')),
    );
    sources.set(filename, parsed);
    if (parsed.ok) sources.set(parsed.entry.key, parsed);
  }

  const ids = new Set<string>();
  const targets: AcquisitionRuntimeTarget[] = [];
  for (const target of config.targets) {
    if (ids.has(target.target_id)) throw new Error(`duplicate acquisition target_id ${target.target_id}`);
    ids.add(target.target_id);
    const parsed = sources.get(target.source_key);
    if (parsed === undefined || !parsed.ok) {
      throw new Error(`acquisition target ${target.target_id} names invalid source ${target.source_key}`);
    }
    const source = parsed.entry;
    if (source.vertical_slug !== slug) {
      throw new Error(`acquisition target ${target.target_id} crosses verticals`);
    }
    const url = new URL(target.target_url);
    if (url.hostname !== source.domain) {
      throw new Error(
        `acquisition target ${target.target_id} host ${url.hostname} does not match ${source.domain}`,
      );
    }
    if (target.result_url_policy.allowedOrigins.some((origin) => new URL(origin).hostname !== source.domain)) {
      throw new Error(
        `acquisition target ${target.target_id} allows a result origin outside ${source.domain}`,
      );
    }
    const pathCovered = target.result_url_policy.allowedPathPrefixes.some((prefix) =>
      url.pathname === prefix ||
      (prefix.endsWith('/') && url.pathname.startsWith(prefix)) ||
      (!prefix.endsWith('/') && url.pathname.startsWith(`${prefix}/`)),
    );
    if (!target.result_url_policy.allowedOrigins.includes(url.origin) || !pathCovered) {
      throw new Error(`acquisition target ${target.target_id} result policy does not cover its target URL`);
    }
    targets.push({
      target_id: target.target_id,
      target_url: target.target_url,
      result_url_policy: target.result_url_policy,
      asset_class: target.asset_class,
      output_class: target.output_class,
      source,
    });
  }

  const payload = {
    schema_version: 1 as const,
    vertical_slug: slug,
    vertical_name: name,
    vertical_schema_version: schemaVersion,
    vertical_status: status,
    default_refresh_policy: policy,
    targets,
  };
  return { ...payload, runtime_digest: digest(payload) };
}

export const artifactPath = (slug: string, outputDir: string = OUTPUT_DIR): string =>
  join(outputDir, `${slug}.acquisition-runtime.json`);
export const registryPath = (outputDir: string = OUTPUT_DIR): string =>
  join(outputDir, 'runtime-registry.ts');

export function serialize(runtime: AcquisitionRuntime): string {
  return `${JSON.stringify(runtime, null, 2)}\n`;
}

const bindingName = (slug: string): string =>
  `${slug.replace(/[^A-Za-z0-9_$]/g, '_')}Runtime`;

export function serializeRegistry(slugs: readonly string[]): string {
  const ordered = [...slugs].sort();
  return [
    '/** Generated by tooling/scripts/compile-acquisition-runtime.ts. Do not edit. */',
    "import type { AcquisitionRuntime } from '@data-foundry/acquisition';",
    ...ordered.map(
      (slug) =>
        `import ${bindingName(slug)} from './${slug}.acquisition-runtime.json' with { type: 'json' };`,
    ),
    '',
    `export const BUNDLED_ACQUISITION_VERTICALS = ${JSON.stringify(ordered)} as const;`,
    'export const ACQUISITION_RUNTIMES: Readonly<Record<string, AcquisitionRuntime>> = {',
    ...ordered.map((slug) => `  ${JSON.stringify(slug)}: ${bindingName(slug)} as AcquisitionRuntime,`),
    '};',
    '',
  ].join('\n');
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function run(
  slugs: readonly string[],
  check: boolean,
  options: CompileAcquisitionRuntimeOptions = {},
): Promise<number> {
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const stale: string[] = [];
  for (const slug of slugs) {
    const expected = serialize(await compileAcquisitionRuntime(slug));
    const path = artifactPath(slug, outputDir);
    if (check) {
      if ((await readIfPresent(path)) !== expected) stale.push(`${slug}.acquisition-runtime.json`);
    } else {
      await mkdir(outputDir, { recursive: true });
      await writeFile(path, expected, 'utf8');
    }
  }
  const expectedRegistry = serializeRegistry(slugs);
  const outputRegistry = registryPath(outputDir);
  if (check) {
    if ((await readIfPresent(outputRegistry)) !== expectedRegistry) stale.push('runtime-registry.ts');
  } else {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputRegistry, expectedRegistry, 'utf8');
  }
  if (check && stale.length > 0) {
    process.stderr.write(
      `Stale acquisition runtime artifact(s): ${stale.join(', ')}.\n` +
        'Run `pnpm acquisition:compile` and commit the result.\n',
    );
    return 1;
  }
  process.stdout.write(
    check
      ? `OK: ${slugs.length} acquisition runtime artifact(s) are up to date.\n`
      : `Wrote ${slugs.length} acquisition runtime artifact(s).\n`,
  );
  return 0;
}

export const BUNDLED_ACQUISITION_VERTICALS: readonly string[] = ['hvac'];

if (isMain(import.meta.url)) {
  run(BUNDLED_ACQUISITION_VERTICALS, process.argv.includes('--check')).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
