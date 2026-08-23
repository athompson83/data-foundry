/**
 * The CI gate has to be able to say no.
 *
 * Before this check existed, `pnpm verticals:validate` printed "OK: all vertical
 * configurations are valid" for a vertical declaring
 * `op: strip_contorl_characters`, and the first thing to notice was the ingest
 * worker, mid-crawl, after acquisition had already been paid for. Every case
 * below therefore drives the gate to FAIL as well as to pass — a gate that only
 * ever passes is worse than no gate, because it produces the word "OK".
 *
 * The rejection cases build a throwaway vertical rather than editing the real
 * one, so a failing assertion can never leave `verticals/hvac` poisoned.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { IDENTIFIER_OPS } from '../../services/ingest-worker/src/identifiers.js';
import { TRANSFORM_KINDS } from '../../packages/normalization/src/rules.js';
import { validateAllVerticals, VERTICALS_DIR } from '../validators/validate-verticals.js';
import {
  checkDeclaredOps,
  collectIdentifierOps,
  IDENTIFIER_OP_NAMESPACE,
  nearestOps,
  validateDeclaredOps,
  VALUE_OP_NAMESPACE,
} from '../validators/vertical-ops.js';

const temporaryDirectories: string[] = [];

/** Writes a `normalizers/03-domain-normalization.yaml` containing `ops`, and nothing else. */
async function verticalDeclaring(ops: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'data-foundry-ops-'));
  temporaryDirectories.push(dir);
  await mkdir(join(dir, 'normalizers'), { recursive: true });
  await writeFile(
    join(dir, 'normalizers', '03-domain-normalization.yaml'),
    `identifier_rules:\n  - alias_type: model_number\n    ops:\n${ops}\n`,
    'utf8',
  );
  return dir;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the validator imports the vocabularies rather than copying them', () => {
  /**
   * Reference identity, deliberately. A hand-copied list here would drift the
   * first time someone added an op — the same class of bug this gate exists to
   * catch, one layer up. If a future edit replaces either import with a literal,
   * this fails immediately rather than years later.
   */
  it('checks against the very arrays the implementing modules export', () => {
    expect(IDENTIFIER_OP_NAMESPACE.ops).toBe(IDENTIFIER_OPS);
    expect(VALUE_OP_NAMESPACE.ops).toBe(TRANSFORM_KINDS);
  });

  it('keeps the two namespaces distinct', () => {
    // They overlap without being the same, which is precisely why pooling them
    // would be unsafe rather than merely untidy.
    expect(IDENTIFIER_OP_NAMESPACE.ops).toContain('collapse_whitespace');
    expect(VALUE_OP_NAMESPACE.ops).toContain('collapse_whitespace');
    expect(IDENTIFIER_OP_NAMESPACE.ops).toContain('left_pad');
    expect(VALUE_OP_NAMESPACE.ops).not.toContain('left_pad');
    expect(VALUE_OP_NAMESPACE.ops).toContain('round');
    expect(IDENTIFIER_OP_NAMESPACE.ops).not.toContain('round');
  });
});

describe('a valid vertical still passes', () => {
  it('reports no problems for the real HVAC vertical', async () => {
    const { verticals, problems } = await validateAllVerticals();
    expect(verticals).toContain('hvac');
    expect(problems).toEqual([]);
  });

  it('declares only identifier ops the ingest worker implements', async () => {
    expect(await validateDeclaredOps(join(VERTICALS_DIR, 'hvac'), 'hvac')).toEqual([]);
  });

  it('contributes nothing when the file a site names is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'data-foundry-ops-empty-'));
    temporaryDirectories.push(dir);
    expect(await validateDeclaredOps(dir, 'nothing-here')).toEqual([]);
  });
});

describe('an op the platform does not implement is rejected', () => {
  it('names the vertical, the file, the YAML path, the op and the nearest alternative', async () => {
    const dir = await verticalDeclaring(
      '      - op: uppercase\n      - op: strip_contorl_characters\n',
    );
    const problems = await validateDeclaredOps(dir, 'probe-vertical');

    expect(problems).toHaveLength(1);
    const [problem] = problems;
    expect(problem?.file).toBe(join(dir, 'normalizers', '03-domain-normalization.yaml'));
    expect(problem?.message).toContain('probe-vertical');
    expect(problem?.message).toContain('identifier_rules[0].ops[1].op');
    expect(problem?.message).toContain('"strip_contorl_characters"');
    // An operator should be able to fix a typo without reading source.
    expect(problem?.message).toContain('did you mean "strip_characters"?');
    expect(problem?.message).toContain('services/ingest-worker/src/identifiers.ts');
  });

  it('rejects a step that names no op at all', async () => {
    const dir = await verticalDeclaring('      - characters: "-"\n');
    const problems = await validateDeclaredOps(dir, 'probe-vertical');

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('declares a step with no op name');
  });

  it('accepts every op the ingest worker does implement', async () => {
    const dir = await verticalDeclaring(
      IDENTIFIER_OPS.map((op) => `      - op: ${op}`).join('\n'),
    );
    expect(await validateDeclaredOps(dir, 'probe-vertical')).toEqual([]);
  });
});

describe('an op valid in the other namespace is still rejected', () => {
  const context = { vertical: 'probe-vertical', file: 'probe.yaml' };

  it('refuses a value transform kind where an identifier op belongs', () => {
    const problems = checkDeclaredOps(
      [{ path: 'identifier_rules[0].ops[0].op', op: 'decode_html_entities' }],
      IDENTIFIER_OP_NAMESPACE,
      context,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('"decode_html_entities" is a value transform kind');
    expect(problems[0]?.message).toContain('different pipeline stage');
    expect(problems[0]?.message).toContain('packages/normalization/src/pipeline.ts');
  });

  it('refuses an identifier op where a value transform kind belongs', () => {
    const problems = checkDeclaredOps(
      [{ path: 'transforms[0].kind', op: 'left_pad' }],
      VALUE_OP_NAMESPACE,
      context,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('"left_pad" is a identifier op');
    expect(problems[0]?.message).toContain('services/ingest-worker/src/identifiers.ts');
  });

  it('rejects a name that belongs to neither namespace, in either namespace', () => {
    for (const namespace of [IDENTIFIER_OP_NAMESPACE, VALUE_OP_NAMESPACE]) {
      const problems = checkDeclaredOps([{ path: 'x', op: 'smoosh' }], namespace, context);
      expect(problems).toHaveLength(1);
      expect(problems[0]?.message).toContain('"smoosh"');
      expect(problems[0]?.message).toContain('does not implement');
    }
  });

  it('accepts an op that really does belong to the namespace it was declared in', () => {
    expect(
      checkDeclaredOps([{ path: 'x', op: 'left_pad' }], IDENTIFIER_OP_NAMESPACE, context),
    ).toEqual([]);
    expect(checkDeclaredOps([{ path: 'x', op: 'round' }], VALUE_OP_NAMESPACE, context)).toEqual([]);
  });
});

describe('supporting machinery', () => {
  it('locates every declared op with its YAML path', () => {
    expect(
      collectIdentifierOps({
        identifier_rules: [
          { alias_type: 'a', ops: [{ op: 'uppercase' }, { op: 'left_pad', length: 12 }] },
          { alias_type: 'b', ops: [{ op: 'title_case' }] },
          { alias_type: 'c' },
        ],
      }),
    ).toEqual([
      { path: 'identifier_rules[0].ops[0].op', op: 'uppercase' },
      { path: 'identifier_rules[0].ops[1].op', op: 'left_pad' },
      { path: 'identifier_rules[1].ops[0].op', op: 'title_case' },
    ]);
  });

  it('suggests nearest names deterministically, and suggests nothing for a wild one', () => {
    expect(nearestOps('strip_contorl_characters', IDENTIFIER_OPS)).toEqual(['strip_characters']);
    expect(nearestOps('uppercse', IDENTIFIER_OPS)).toEqual(['uppercase']);
    expect(nearestOps('zzzzzzzzzzzzzzzzzzzzzzzz', IDENTIFIER_OPS)).toEqual([]);
  });
});
