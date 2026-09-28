import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { candidateFields, candidateFieldText, decideIdentifierCandidate, decideIdentifierInRecord } from '../src/index.js';

interface Vector {
  name: string;
  field: string;
  text: string;
  value: string;
  expect: { ok: boolean; label?: string; key?: string; reason?: string; start?: number };
}

interface RecordVector {
  name: string;
  record: unknown;
  value: string;
  claimed_field: string;
  expect: { ok: boolean; field?: string; label?: string; reason?: string };
}

const vectors = JSON.parse(readFileSync(new URL('./identifier-candidate-vectors.json', import.meta.url), 'utf8')) as { cases: Vector[]; records: RecordVector[] };

describe('identifier candidate acceptance (shared vectors)', () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const decision = decideIdentifierCandidate(vector.text, vector.value, vector.field);
      expect(decision.ok).toBe(vector.expect.ok);
      if (decision.ok) {
        if (vector.expect.label) expect(decision.label).toBe(vector.expect.label);
        if (vector.expect.key) expect(decision.key).toBe(vector.expect.key);
        if (vector.expect.start !== undefined) expect(decision.start).toBe(vector.expect.start);
        expect(vector.text.slice(decision.start, decision.end)).toBe(vector.value);
      } else {
        expect(decision.reason).toBe(vector.expect.reason);
      }
    });
  }
});

describe('record-level decisions (shared vectors)', () => {
  for (const vector of vectors.records) {
    it(vector.name, () => {
      const decision = decideIdentifierInRecord(vector.record, vector.value, vector.claimed_field);
      expect(decision.ok).toBe(vector.expect.ok);
      if (decision.ok) {
        expect(decision.field).toBe(vector.expect.field);
        expect(decision.label).toBe(vector.expect.label);
      } else {
        expect(decision.reason).toBe(vector.expect.reason);
      }
    });
  }
});

describe('candidate fields', () => {
  const record = { Title: 'X Recalls Heaters', Description: 'Item 12345', ConsumerContact: 'call 800', Products: [{ Name: 'Heater', Model: 'H-1', Description: '' }] };

  it('lists only allowed, non-empty fields', () => {
    expect(candidateFields(record)).toEqual(['Title', 'Description', 'Products[0].Name', 'Products[0].Model']);
  });

  it('reads allowed paths and refuses others', () => {
    expect(candidateFieldText(record, 'Products[0].Model')).toBe('H-1');
    expect(candidateFieldText(record, 'ConsumerContact')).toBeNull();
    expect(candidateFieldText(record, 'Products[3].Name')).toBeNull();
    expect(candidateFieldText(record, 'Products[0].__proto__')).toBeNull();
  });
});
