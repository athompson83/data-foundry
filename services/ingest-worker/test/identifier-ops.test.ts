/**
 * The exported identifier vocabulary has to be the one that actually runs.
 *
 * `IDENTIFIER_OPS` exists so that `pnpm verticals:validate` can reject an op the
 * ingest worker cannot execute, *before* a crawl pays for the discovery. That
 * only works if the list and the dispatch are the same thing. A list that
 * merely claims to match the dispatch is the original defect moved one layer
 * up: it would let the validator wave through an op that throws at run time, or
 * reject one that works.
 *
 * So these cases never assert the list against a second copy of itself. They
 * drive every exported op through the real `AliasNormalizer` and check what the
 * code does with it.
 */
import { describe, expect, it } from 'vitest';
import {
  AliasNormalizer,
  IDENTIFIER_OPS,
  isIdentifierOp,
  type IdentifierOp,
} from '../src/identifiers.js';
import { PipelineConfigurationError } from '../src/errors.js';
import type { VerticalConfig } from '../src/config.js';

/**
 * The smallest config `AliasNormalizer` reads: one alias type whose op chain is
 * whatever a case wants to try. Everything else on `VerticalConfig` is untouched
 * by this code path.
 */
const configDeclaring = (ops: readonly unknown[]): VerticalConfig =>
  ({
    domainNormalization: {
      identifier_rules: [{ alias_type: 'probe', ops }],
    },
  }) as unknown as VerticalConfig;

const runOp = (op: unknown, value = 'Probe Value 007'): string =>
  new AliasNormalizer(configDeclaring([op])).normalize('probe', value);

/** Arguments the ops that need one require; the rest ignore the extra keys. */
const OP_ARGUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  strip_characters: { characters: '-_ ' },
  strip_prefix: { prefixes: ['Probe'] },
  left_pad: { length: 20, character: '0' },
};

/**
 * One input/output vector per identifier op.
 *
 * Deriving the vocabulary from the dispatch table proves every advertised name
 * is *runnable*. It does not prove any name still means what it says. Review
 * found the gap and it is real: rewriting
 *
 *     lowercase: (value) => applyCase(value, 'upper')
 *
 * keeps membership, keeps reachability, still returns a string — and passed
 * all 1113 tests. Only an expected output catches a handler that was rewired
 * to the wrong helper.
 *
 * Typed as a total `Record<IdentifierOp, …>`, so adding an op to the dispatch
 * without a vector is a compile error rather than a silently unanchored name.
 */
const SEMANTICS: Record<
  IdentifierOp,
  { readonly declared: Record<string, unknown>; readonly input: string; readonly expected: string }
> = {
  uppercase: { declared: {}, input: 'hk-32ea', expected: 'HK-32EA' },
  lowercase: { declared: {}, input: 'HK-32EA', expected: 'hk-32ea' },
  // First character up, the rest down, per whitespace-separated part.
  title_case: { declared: {}, input: 'blower MOTOR', expected: 'Blower Motor' },
  // Collapses runs and trims the ends.
  collapse_whitespace: { declared: {}, input: '  a   b  ', expected: 'a b' },
  strip_whitespace: { declared: {}, input: '  hk32  ', expected: 'hk32' },
  strip_characters: {
    declared: { characters: '-/' },
    input: 'HK-32EA/001',
    expected: 'HK32EA001',
  },
  strip_non_digits: { declared: {}, input: 'AHRI 1234-5', expected: '12345' },
  strip_prefix: {
    declared: { prefixes: ['CARRIER-'] },
    input: 'CARRIER-24ANB7',
    expected: '24ANB7',
  },
  left_pad: { declared: { length: 8, character: '0' }, input: '12345', expected: '00012345' },
  // HONEST LIMITATION: `AliasNormalizer.normalize` runs `normalizeUnicode` over
  // the raw value before the declared chain, so by the time this op executes
  // the input is already NFKC. This vector therefore proves the op preserves an
  // already-normalized value, not that it normalizes — a rewrite to the
  // identity function would pass it. Anchoring it properly needs a seam that
  // reaches the handler without the pre-pass, which does not exist today.
  unicode_normalize: { declared: {}, input: '\uFF11\uFF12\uFF13', expected: '123' },
};

describe('every identifier op still means what its name says', () => {
  it('has a vector for every op the dispatch advertises', () => {
    // The `Record` makes this true at compile time; asserted at runtime too so
    // a cast or a widened type cannot quietly reopen the hole.
    expect([...IDENTIFIER_OPS].sort()).toEqual(Object.keys(SEMANTICS).sort());
  });

  it.each(IDENTIFIER_OPS)('%s transforms its input as declared', (op) => {
    const vector = SEMANTICS[op];
    expect(runOp({ op, ...vector.declared }, vector.input), op).toBe(vector.expected);
  });
});

describe('the exported identifier vocabulary is the dispatch, not a copy of it', () => {
  it('executes every op it advertises', () => {
    expect(IDENTIFIER_OPS.length).toBeGreaterThan(0);

    for (const op of IDENTIFIER_OPS) {
      const declared = { op, ...(OP_ARGUMENTS[op] ?? {}) };
      // The assertion is that dispatch happens at all: an op on the exported
      // list with no implementation behind it lands in `applyOp`'s fail-closed
      // branch and throws instead of returning a string.
      expect(() => runOp(declared), `${op} is exported but not dispatched`).not.toThrow();
      expect(typeof runOp(declared)).toBe('string');
    }
  });

  it('refuses an op it does not advertise, naming it', () => {
    expect(IDENTIFIER_OPS).not.toContain('strip_contorl_characters');

    expect(() => runOp({ op: 'strip_contorl_characters' })).toThrow(PipelineConfigurationError);
    expect(() => runOp({ op: 'strip_contorl_characters' })).toThrow(
      'identifier op "strip_contorl_characters" is declared by the vertical but not implemented by the ingest worker',
    );
  });

  it('refuses a step that names no op at all rather than treating it as a no-op', () => {
    expect(() => runOp({ characters: '-' })).toThrow(PipelineConfigurationError);
  });

  /**
   * The reverse direction: an op the dispatch handles but the exported list
   * omits. That is the drift that would make the CI gate reject a config which
   * actually works, and it needs a pool of names to probe, since no test can
   * enumerate every string.
   *
   * This pool is a deliberate hard-coded superset — the one place a second copy
   * of the vocabulary is *wanted*, because its whole job is to notice when the
   * real one changes. It holds every identifier op known when this was written,
   * every value transform kind (which must NOT dispatch here), and some typos.
   * Adding an op means adding it here too, and a reviewer sees the vocabulary
   * grow in the diff.
   */
  const CANDIDATE_POOL: readonly string[] = [
    // identifier ops
    'uppercase',
    'lowercase',
    'title_case',
    'collapse_whitespace',
    'strip_whitespace',
    'strip_characters',
    'strip_non_digits',
    'strip_prefix',
    'left_pad',
    'unicode_normalize',
    // value transform kinds — a different stage, and none may dispatch here
    'trim',
    'unicode_nfkc',
    'normalize_punctuation',
    'decode_html_entities',
    'case',
    'replace',
    'number',
    'quantity',
    'boolean',
    'date',
    'datetime',
    'integer',
    'round',
    'range',
    'vocabulary',
    // near misses and inherited object properties
    'strip_contorl_characters',
    'strip_control_characters',
    'uppercse',
    '',
    'toString',
    'constructor',
  ];

  it('dispatches exactly the ops it advertises, and nothing else', () => {
    for (const candidate of CANDIDATE_POOL) {
      const listed = (IDENTIFIER_OPS as readonly string[]).includes(candidate);
      expect(isIdentifierOp(candidate), `${candidate}: list and membership test disagree`).toBe(
        listed,
      );

      // The behavioural half: what the module *does* with the name, not what it
      // says about it. A name it executes but does not advertise would make the
      // CI gate reject a working config; a name it advertises but cannot
      // execute would make the gate wave through a broken one.
      let dispatched = true;
      try {
        runOp({ op: candidate, ...(OP_ARGUMENTS[candidate] ?? {}) });
      } catch (error) {
        if (!(error instanceof PipelineConfigurationError)) throw error;
        dispatched = false;
      }
      expect(dispatched, `${candidate}: dispatched=${dispatched} but advertised=${listed}`).toBe(
        listed,
      );
    }
  });

  it('advertises every identifier op the pool knows about', () => {
    // Guards the pool itself against falling behind: if an op is added to the
    // dispatch and to the exported list but not to CANDIDATE_POOL, the case
    // above would silently stop covering it.
    for (const op of IDENTIFIER_OPS) {
      expect(CANDIDATE_POOL, `${op} is implemented but missing from the probe pool`).toContain(op);
    }
  });

  it('still normalizes the vertical the way layer 3 declares', () => {
    // A behavioural anchor for the dispatch-table refactor: these are the
    // spellings `03-domain-normalization.yaml` exists to collapse.
    expect(runOp({ op: 'uppercase' }, '24acc6-36a003')).toBe('24ACC6-36A003');
    expect(runOp({ op: 'strip_characters', characters: '-_. /\\' }, '24ACC6-36A003')).toBe(
      '24ACC636A003',
    );
    expect(runOp({ op: 'strip_prefix', prefixes: ['AHRI-', 'AHRI'] }, 'AHRI-20134501')).toBe(
      '20134501',
    );
    expect(runOp({ op: 'strip_non_digits' }, 'UPC 8345-6120010')).toBe('83456120010');
    expect(runOp({ op: 'left_pad', length: 12, character: '0' }, '83456120010')).toBe(
      '083456120010',
    );
    expect(runOp({ op: 'title_case' }, 'comfort 16')).toBe('Comfort 16');
  });
});
