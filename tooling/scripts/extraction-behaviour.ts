/**
 * The extraction-behaviour fingerprint (ADR-0017): a SHA-256 over everything that decides what the local collector
 * extracts and what the server accepts, beyond the extractor version, model and prompt hash:
 *
 * - the authoritative acceptance rules (packages/product-recall-structuring/src/identifier-candidates.ts) and their
 *   collector mirror (apps/local-collector/df_collector/validate.py);
 * - the extractor's request (schema, field truncation, prompt assembly: df_collector/extract.py) and model options
 *   (df_collector/ollama.py), with the generation defaults from df_collector/config.py.
 *
 * The recalls Worker stamps EXTRACTION_BEHAVIOUR_SHA256 on every accepted row and publishes only rows whose
 * fingerprint is the one a PUBLISHABLE_EXTRACTORS entry was benchmarked with. tooling/test/local-collector.test.ts
 * fails when any of these files changes until the benchmark is re-run (--score-only suffices for a rules-only change;
 * a prompt, schema or option change needs a full run) and both constants are updated in a reviewed change.
 *
 *   tsx tooling/scripts/extraction-behaviour.ts   # print the current fingerprint
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

export const EXTRACTION_BEHAVIOUR_FILES = [
  'packages/product-recall-structuring/src/identifier-candidates.ts',
  'apps/local-collector/df_collector/validate.py',
  'apps/local-collector/df_collector/extract.py',
  'apps/local-collector/df_collector/ollama.py',
] as const;

/** Generation defaults read from config.py (only the fields that change model output). */
function generationDefaults(): Record<string, string> {
  const config = readFileSync(join(ROOT, 'apps/local-collector/df_collector/config.py'), 'utf8');
  const out: Record<string, string> = {};
  for (const name of ['model', 'num_ctx', 'think']) {
    const match = new RegExp(`^\\s+${name}:[^=\\n]*=\\s*(.+)$`, 'm').exec(config);
    if (!match) throw new Error(`config.py has no default for ${name}`);
    out[name] = (match[1] as string).trim();
  }
  return out;
}

export function extractionBehaviourSha256(): string {
  const hash = createHash('sha256');
  for (const path of EXTRACTION_BEHAVIOUR_FILES) {
    // Line endings are normalised so a Windows checkout computes the same fingerprint.
    hash.update(`${path}\n${readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')}\n`);
  }
  hash.update(JSON.stringify(generationDefaults()));
  return hash.digest('hex');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() as string)) {
  process.stdout.write(`${extractionBehaviourSha256()}\n`);
}
