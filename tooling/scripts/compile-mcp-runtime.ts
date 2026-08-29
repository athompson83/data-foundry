/**
 * Compile one vertical's query configuration and MCP declaration into the
 * static artifact a Cloudflare Worker can bundle. `verticals/<slug>/mcp.yaml`
 * may select and describe the supported generic tools, but the executable
 * declarations in `apps/mcp` remain authoritative for schema, descriptions,
 * and errors. A mismatch is a build failure, never two advertised contracts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { TOOLS, TOOL_NAMES } from '../../apps/mcp/src/index.js';
import { isMain } from '../lib/cli-entry.js';
import { compileVerticalRuntime } from './compile-vertical-runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'apps', 'mcp-worker', 'generated');

export const BUNDLED_MCP_VERTICALS: readonly string[] = ['hvac'];

export interface CompiledMcpTool {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly error_codes: readonly string[];
}

export interface McpWorkerRuntime {
  readonly vertical_slug: string;
  /** Public-web path prefix used as the base for canonical entity URLs. */
  readonly canonical_url_prefix: string;
  readonly fields: readonly unknown[];
  readonly fact_selection: Readonly<Record<string, unknown>>;
  readonly server: {
    readonly name: string;
    readonly version: string;
    readonly transport: 'streamable_http';
    readonly endpoint: '/mcp';
    readonly server_card: string;
    readonly agent_card: string;
  };
  readonly tools: readonly CompiledMcpTool[];
}

type YamlObject = Record<string, unknown>;

function object(value: unknown, label: string): YamlObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as YamlObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function compileServer(raw: unknown): McpWorkerRuntime['server'] {
  const server = object(raw, 'mcp.yaml server');
  const transport = string(server['transport'], 'mcp.yaml server.transport');
  const endpoint = string(server['endpoint'], 'mcp.yaml server.endpoint');
  if (transport !== 'streamable_http') {
    throw new Error('mcp.yaml server.transport must be exactly streamable_http');
  }
  if (endpoint !== '/mcp') throw new Error('mcp.yaml server.endpoint must be exactly /mcp');
  return {
    name: string(server['name'], 'mcp.yaml server.name'),
    version: string(server['version'], 'mcp.yaml server.version'),
    transport,
    endpoint,
    server_card: string(server['server_card'], 'mcp.yaml server.server_card'),
    agent_card: string(server['agent_card'], 'mcp.yaml server.agent_card'),
  };
}

function validateDeclaredTools(raw: unknown, slug: string): void {
  if (!Array.isArray(raw)) throw new Error(`verticals/${slug}/mcp.yaml tools must be an array`);
  const declared = raw.map((entry, index) => {
    const tool = object(entry, `mcp.yaml tools[${index}]`);
    return {
      name: string(tool['name'], `mcp.yaml tools[${index}].name`),
      title: string(tool['title'], `mcp.yaml tools[${index}].title`),
      summary: string(tool['summary'], `mcp.yaml tools[${index}].summary`),
    };
  });
  const names = declared.map((tool) => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(TOOL_NAMES)) {
    throw new Error(
      `verticals/${slug}/mcp.yaml tool names must exactly match the executable generic tools ` +
        `in order: ${TOOL_NAMES.join(', ')}`,
    );
  }
  for (const declaredTool of declared) {
    const executable = TOOLS.find((tool) => tool.name === declaredTool.name);
    if (executable === undefined) throw new Error(`unknown MCP tool ${declaredTool.name}`);
    if (declaredTool.title !== executable.title || declaredTool.summary !== executable.summary) {
      throw new Error(
        `verticals/${slug}/mcp.yaml metadata for ${declaredTool.name} does not match apps/mcp`,
      );
    }
  }
}

export async function compileMcpRuntime(slug: string): Promise<McpWorkerRuntime> {
  const queryRuntime = await compileVerticalRuntime(slug);
  const path = join(REPO_ROOT, 'verticals', slug, 'mcp.yaml');
  const document = object(parseYaml(await readFile(path, 'utf8')), `verticals/${slug}/mcp.yaml`);
  const seoPath = join(REPO_ROOT, 'verticals', slug, 'seo.yaml');
  const seo = object(parseYaml(await readFile(seoPath, 'utf8')), `verticals/${slug}/seo.yaml`);
  const canonicalUrlPrefix = string(seo['url_prefix'], `verticals/${slug}/seo.yaml url_prefix`);
  if (!canonicalUrlPrefix.startsWith('/') || canonicalUrlPrefix.endsWith('/')) {
    throw new Error(
      `verticals/${slug}/seo.yaml url_prefix must start with one slash and have no trailing slash`,
    );
  }
  validateDeclaredTools(document['tools'], slug);
  return {
    ...queryRuntime,
    canonical_url_prefix: canonicalUrlPrefix,
    server: compileServer(document['server']),
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      summary: tool.summary,
      description: tool.description,
      input_schema: tool.inputSchema,
      error_codes: [...tool.errors],
    })),
  };
}

export function serialize(runtime: McpWorkerRuntime): string {
  return `${JSON.stringify(runtime, null, 2)}\n`;
}

export function artifactPath(slug: string, outputDir: string = OUTPUT_DIR): string {
  return join(outputDir, `${slug}.runtime.json`);
}

export function registryPath(outputDir: string = OUTPUT_DIR): string {
  return join(outputDir, 'runtime-registry.ts');
}

function bindingName(slug: string): string {
  const safe = slug.replace(/[^A-Za-z0-9_$]/g, '_');
  return `${/^[A-Za-z_$]/.test(safe) ? safe : `vertical_${safe}`}Runtime`;
}

export function serializeRegistry(slugs: readonly string[]): string {
  const ordered = [...slugs].sort();
  return [
    '/** Generated by tooling/scripts/compile-mcp-runtime.ts. Do not edit. */',
    "import type { McpWorkerRuntime } from '../src/composition.js';",
    ...ordered.map(
      (slug) =>
        `import ${bindingName(slug)} from './${slug}.runtime.json' with { type: 'json' };`,
    ),
    '',
    `export const BUNDLED_MCP_VERTICALS = ${JSON.stringify(ordered)} as const;`,
    'export const MCP_RUNTIMES: Readonly<Record<string, McpWorkerRuntime>> = {',
    ...ordered.map(
      (slug) => `  ${JSON.stringify(slug)}: ${bindingName(slug)} as McpWorkerRuntime,`,
    ),
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
  options: { readonly outputDir?: string } = {},
): Promise<number> {
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const stale: string[] = [];
  for (const slug of slugs) {
    const expected = serialize(await compileMcpRuntime(slug));
    const path = artifactPath(slug, outputDir);
    if (check) {
      if ((await readIfPresent(path)) !== expected) stale.push(`${slug}.runtime.json`);
    } else {
      await mkdir(outputDir, { recursive: true });
      await writeFile(path, expected, 'utf8');
    }
  }

  const expectedRegistry = serializeRegistry(slugs);
  const generatedRegistryPath = registryPath(outputDir);
  if (check) {
    if ((await readIfPresent(generatedRegistryPath)) !== expectedRegistry) {
      stale.push('runtime-registry.ts');
    }
  } else {
    await mkdir(outputDir, { recursive: true });
    await writeFile(generatedRegistryPath, expectedRegistry, 'utf8');
  }

  if (check && stale.length > 0) {
    process.stderr.write(
      `Stale MCP runtime artifact(s): ${stale.join(', ')}.\n` +
        'Run `pnpm mcp:compile` and commit the result.\n',
    );
    return 1;
  }
  process.stdout.write(
    check
      ? `OK: ${slugs.length} MCP runtime artifact(s) are up to date.\n`
      : `Wrote ${slugs.length} MCP runtime artifact(s) and runtime-registry.ts.\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check');
  run(BUNDLED_MCP_VERTICALS, check).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
