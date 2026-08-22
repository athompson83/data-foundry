/**
 * A bulk export is opened in a spreadsheet. That is what "bulk export" means to
 * most of the people who download one.
 *
 * So the last hop of this pipeline is not a file on disk, it is Excel's parser,
 * and Excel compiles any cell whose first character is `=`, `+`, `-`, `@`, a tab
 * or a CR. Our rows carry supplier- and forum-sourced strings, so the attacker
 * is whoever publishes a model number — the AGENTS.md rule 1 chain has no say
 * here, because the value is perfectly lawful data that happens to also be a
 * program (CWE-1236).
 *
 * This suite works on the bytes a real build hands a customer, not on the
 * writer in isolation: it runs `buildDatasetExport` over the fixture database,
 * reads `facts.csv` back with the conforming reader in `csv-reader.ts`, and
 * checks three separate claims — the formula cell is inert, the value is still
 * recoverable from it, and no other cell moved. `facts.jsonl` is checked too,
 * in the opposite direction: it must still carry the raw string, because JSONL
 * is the lossless form and no JSON reader executes a cell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CSV_FORMULA_ESCAPE,
  FACTS_CSV,
  FACTS_JSONL,
  buildDatasetExport,
  createMemorySink,
  fromUtf8,
  type DatasetExportResult,
} from '../src/index.js';
import { parseCsv, type Cell } from './csv-reader.js';
import {
  FORMULA_PROPERTY,
  FORMULA_VALUE,
  baseOptions,
  createExportFixtures,
  type ExportFixtures,
} from './support.js';

let fixtures: ExportFixtures;
let result: DatasetExportResult;

/** The entity whose only certification reference came from the aggregator. */
const COIL_SLUG = 'replacement-coil-24anb7';

beforeAll(async () => {
  fixtures = await createExportFixtures();
  result = await buildDatasetExport({
    ...baseOptions(fixtures),
    sink: createMemorySink('formula'),
  });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

const text = (path: string): string => {
  const bytes = result.artifacts.get(path);
  if (bytes === undefined) throw new Error(`no artifact at ${path}`);
  return fromUtf8(bytes);
};

/** Cells of `facts.csv`, keyed by (entity_slug, property), read back properly. */
const csvCells = (): Map<string, Map<string, Cell>> => {
  const rows = parseCsv(text(FACTS_CSV));
  const [header, ...records] = rows;
  if (header === undefined) throw new Error('facts.csv has no header');
  const columns = header.map((cell) => cell ?? '');
  const byKey = new Map<string, Map<string, Cell>>();
  for (const record of records) {
    const cells = new Map<string, Cell>();
    columns.forEach((column, index) => cells.set(column, record[index] ?? null));
    byKey.set(`${cells.get('entity_slug') ?? ''}|${cells.get('property') ?? ''}`, cells);
  }
  return byKey;
};

const jsonRows = (): Record<string, unknown>[] =>
  text(FACTS_JSONL)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('the fixture really does publish an attacker-written formula', () => {
  it('selects the aggregator value, so this suite is not testing nothing', () => {
    const row = result.rows.find(
      (candidate) => candidate.entity_slug === COIL_SLUG && candidate.property === FORMULA_PROPERTY,
    );
    expect(row?.value).toBe(FORMULA_VALUE);
    expect(row?.fact_id).not.toBeNull();
  });
});

describe('facts.csv hands a spreadsheet data, never a program', () => {
  it('writes the formula cell as text', () => {
    const cell = csvCells().get(`${COIL_SLUG}|${FORMULA_PROPERTY}`)?.get('value');
    expect(cell).toBeDefined();
    expect(/^[=+\-@\t\r]/.test(cell as string)).toBe(false);
    expect((cell as string).startsWith(CSV_FORMULA_ESCAPE)).toBe(true);
  });

  it('still hands over the value, one strip away', () => {
    const cell = csvCells().get(`${COIL_SLUG}|${FORMULA_PROPERTY}`)?.get('value') as string;
    expect(cell.slice(CSV_FORMULA_ESCAPE.length)).toBe(FORMULA_VALUE);
  });

  it('leaves every cell that does not open with a risky character alone', () => {
    // The escape is not allowed to be a general-purpose rewrite of the file: if
    // it touched ordinary values, every consumer's join keys and numbers would
    // silently change under them.
    let compared = 0;
    for (const cells of csvCells().values()) {
      for (const [column, cell] of cells) {
        if (cell === null) continue;
        if (/^['=+\-@\t\r]/.test(cell)) continue;
        const row = result.rows.find(
          (candidate) =>
            candidate.entity_slug === cells.get('entity_slug') &&
            candidate.property === cells.get('property'),
        );
        const raw = (row as unknown as Record<string, unknown>)[column];
        if (raw === null || raw === undefined) continue;
        expect(cell, `${column} of ${cells.get('property') ?? '?'}`).toBe(String(raw));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('escapes exactly the cells that needed it, and no others', () => {
    const escaped = [...csvCells().values()].flatMap((cells) =>
      [...cells.values()].filter(
        (cell) => cell !== null && cell.startsWith(CSV_FORMULA_ESCAPE),
      ),
    );
    expect(escaped).toHaveLength(1);
  });
});

describe('facts.jsonl is the lossless form and stays that way', () => {
  it('carries the raw value, unescaped', () => {
    const row = jsonRows().find(
      (candidate) =>
        candidate['entity_slug'] === COIL_SLUG && candidate['property'] === FORMULA_PROPERTY,
    );
    expect(row?.['value']).toBe(FORMULA_VALUE);
  });

  it('does not carry the CSV escape anywhere', () => {
    expect(text(FACTS_JSONL)).not.toContain(`${CSV_FORMULA_ESCAPE}${FORMULA_VALUE}`);
  });
});
