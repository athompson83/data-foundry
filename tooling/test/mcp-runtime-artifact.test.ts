import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TOOLS, TOOL_NAMES } from '../../apps/mcp/src/index.js';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the MCP Worker runtime compiler', () => {
  it('compiles the six executable generic tools and server metadata from one vertical declaration', async () => {
    const module = await import('../scripts/compile-mcp-runtime.js');
    const runtime = await module.compileMcpRuntime('hvac');

    expect(module.BUNDLED_MCP_VERTICALS).toEqual(['hvac']);
    expect(runtime.vertical_slug).toBe('hvac');
    expect(runtime.server).toEqual({
      name: 'data-foundry-hvac',
      version: '0.1.0',
      transport: 'streamable_http',
      endpoint: '/mcp',
    });
    expect(runtime.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(runtime.tools).toHaveLength(6);

    for (const compiled of runtime.tools) {
      const executable = TOOLS.find((tool) => tool.name === compiled.name);
      expect(executable, compiled.name).toBeDefined();
      expect(compiled.title).toBe(executable?.title);
      expect(compiled.summary).toBe(executable?.summary);
      expect(compiled.description).toBe(executable?.description);
      expect(compiled.input_schema).toEqual(executable?.inputSchema);
      expect(compiled.error_codes).toEqual(executable?.errors);
    }

    const serialized = JSON.stringify(runtime);
    for (const unsupported of [
      'find_replacement_model',
      'identify_equipment_model',
      'compare_equipment_models',
      'list_certified_ratings',
    ]) {
      expect(serialized).not.toContain(unsupported);
    }
  });

  it('writes deterministic per-vertical artifacts and a static Worker registry', async () => {
    const module = await import('../scripts/compile-mcp-runtime.js');
    const outputDir = await mkdtemp(join(tmpdir(), 'data-foundry-mcp-runtime-'));
    temporaryDirectories.push(outputDir);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(await module.run(module.BUNDLED_MCP_VERTICALS, true, { outputDir })).toBe(1);
    expect(await module.run(module.BUNDLED_MCP_VERTICALS, false, { outputDir })).toBe(0);
    expect(await module.run(module.BUNDLED_MCP_VERTICALS, true, { outputDir })).toBe(0);

    const registryPath = join(outputDir, 'runtime-registry.ts');
    const registry = await readFile(registryPath, 'utf8');
    expect(registry).toContain("import hvacRuntime from './hvac.runtime.json' with { type: 'json' };");
    expect(registry).toContain('export const BUNDLED_MCP_VERTICALS = ["hvac"] as const;');
    expect(registry).toContain('"hvac": hvacRuntime as McpWorkerRuntime');

    await writeFile(registryPath, `${registry} `, 'utf8');
    expect(await module.run(module.BUNDLED_MCP_VERTICALS, true, { outputDir })).toBe(1);
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });
});
