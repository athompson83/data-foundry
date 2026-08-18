import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CsvExtractor,
  HtmlExtractor,
  JsonExtractor,
  PdfExtractor,
  toSourceRecordInsert,
} from '../src/index.js';
import { JSON_SCHEMA, jsonArtifact } from './fixtures.js';

/**
 * Architecture boundary, enforced mechanically.
 *
 * AGENTS.md: "Extraction creates source-native records… avoid imports that cross
 * these boundaries in the wrong direction." Extraction may not know that
 * canonical entities exist, may not resolve identity, and may not reach into
 * canonical storage. A comment saying so is a wish; a failing test is a rule.
 */
describe('architecture boundary', () => {
  const sourceDir = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  const sourceFiles = (): string[] =>
    readdirSync(sourceDir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath, entry.name));

  it('imports nothing downstream of extraction', () => {
    const forbidden = [
      '@data-foundry/canonical-store',
      '@data-foundry/entity-resolution',
      '@data-foundry/normalization',
      '@data-foundry/query-model',
      '@data-foundry/provenance',
    ];
    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf8');
      for (const specifier of forbidden) {
        expect(contents.includes(`from '${specifier}'`), `${file} imports ${specifier}`).toBe(false);
      }
    }
  });

  it('never fetches: acquisition owns the network, extraction owns the bytes', () => {
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of sourceFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${file} must not do I/O`).not.toMatch(
        /\bfetch\(|node:https?|node:fs|XMLHttpRequest/,
      );
    }
  });

  it('does not add OCR to the PDF provider', () => {
    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf8').toLowerCase();
      // The word appears only where the docs explain that OCR is out of scope.
      const ocrImports = /from '[^']*(tesseract|ocr)[^']*'/.exec(contents);
      expect(ocrImports).toBeNull();
    }
  });

  it('emits nothing that looks like a canonical entity', async () => {
    const records = await new JsonExtractor().extract(jsonArtifact(), JSON_SCHEMA);
    const insert = toSourceRecordInsert(records[0] ?? (() => {
      throw new Error('expected a record');
    })());

    expect(Object.keys(insert).sort()).toEqual([
      'artifact_id',
      'entity_type',
      'extraction_confidence',
      'extractor_version',
      'normalized_payload',
      'raw_payload',
      'source_id',
      'source_record_key',
    ]);
    // Normalization fills this in. Extraction pre-populating it would be the
    // boundary violation that is easiest to commit by accident.
    expect(insert.normalized_payload).toBeNull();
  });

  it('keeps every provider behind the same interface', () => {
    for (const provider of [
      new JsonExtractor(),
      new CsvExtractor(),
      new HtmlExtractor(),
      new PdfExtractor(),
    ]) {
      expect(typeof provider.extract).toBe('function');
      expect(typeof provider.supports).toBe('function');
      expect(provider.extract.length).toBe(2);
    }
  });
});
