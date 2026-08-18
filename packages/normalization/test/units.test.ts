import { describe, expect, it } from 'vitest';
import {
  BTU_PER_HOUR_PER_TON,
  btuPerHourToTons,
  convertUnit,
  findUnit,
  parseDecimal,
  parseQuantity,
  tonsToBtuPerHour,
  UNIT_DEFINITIONS,
} from '../src/index.js';

describe('BTU/h ↔ ton', () => {
  it('holds the defining identity in both directions', () => {
    expect(BTU_PER_HOUR_PER_TON).toBe(12_000);
    expect(tonsToBtuPerHour(1)).toBe(12_000);
    expect(btuPerHourToTons(12_000)).toBe(1);
  });

  it('round-trips exactly across the whole residential range', () => {
    for (const tons of [1, 1.5, 2, 2.5, 3, 3.5, 4, 5]) {
      const btu = tonsToBtuPerHour(tons);
      expect(btuPerHourToTons(btu)).toBe(tons);
      expect(convertUnit(tons, 'ton', 'BTU/h')).toEqual({
        ok: true,
        value: { value: btu, unit: 'BTU/h', source_unit: 'ton' },
      });
      expect(convertUnit(btu, 'BTU/h', 'ton')).toEqual({
        ok: true,
        value: { value: tons, unit: 'ton', source_unit: 'BTU/h' },
      });
    }
  });

  it('agrees with the registry for the common nameplate sizes', () => {
    expect(convertUnit(36_000, 'BTU/h', 'ton')).toMatchObject({ ok: true, value: { value: 3 } });
    expect(convertUnit(48_000, 'BTU/h', 'ton')).toMatchObject({ ok: true, value: { value: 4 } });
    expect(convertUnit(2.5, 'tons', 'BTU/h')).toMatchObject({ ok: true, value: { value: 30_000 } });
  });
});

describe('convertUnit', () => {
  it('retains the source unit on every conversion', () => {
    const result = convertUnit(100, 'kg', 'lb');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source_unit).toBe('kg');
    expect(result.value.unit).toBe('lb');
    expect(result.value.value).toBeCloseTo(220.462, 3);
  });

  it('round-trips inexact factors within floating-point tolerance', () => {
    for (const [value, from, to] of [
      [3.5, 'kW', 'BTU/h'],
      [24, 'in', 'mm'],
      [1500, 'CFM', 'm3/h'],
    ] as const) {
      const forward = convertUnit(value, from, to);
      expect(forward.ok).toBe(true);
      if (!forward.ok) return;
      const back = convertUnit(forward.value.value, to, from);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(back.value.value).toBeCloseTo(value, 8);
    }
  });

  it('handles the affine temperature conversion in both directions', () => {
    expect(convertUnit(0, '°C', '°F')).toMatchObject({ ok: true, value: { value: 32 } });
    expect(convertUnit(100, '°C', '°F')).toMatchObject({ ok: true, value: { value: 212 } });
    expect(convertUnit(32, '°F', '°C')).toMatchObject({ ok: true, value: { value: 0 } });
  });

  it('fails rather than guessing across dimensions', () => {
    const result = convertUnit(36_000, 'BTU/h', 'lb');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('INCOMPATIBLE_UNIT_DIMENSION');
    expect(result.message).toContain('power');
    expect(result.message).toContain('mass');
  });

  it('fails on an unknown unit instead of passing the number through', () => {
    const result = convertUnit(5, 'sprockets', 'BTU/h');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNKNOWN_UNIT');
  });

  it('resolves units through aliases and casing', () => {
    expect(findUnit('BTUH')?.symbol).toBe('BTU/h');
    expect(findUnit('btu/hr')?.symbol).toBe('BTU/h');
    expect(findUnit('Tons')?.symbol).toBe('ton');
    expect(findUnit('lbs')?.symbol).toBe('lb');
    expect(findUnit('volts')?.symbol).toBe('V');
  });

  it('keeps dBA distinct from dB rather than aliasing an A-weighted figure', () => {
    expect(findUnit('dBA')?.symbol).toBe('dBA');
    expect(findUnit('dB')?.symbol).toBe('dB');
  });

  it('has a base unit for every dimension it defines', () => {
    const dimensions = new Set(UNIT_DEFINITIONS.map((unit) => unit.dimension));
    for (const dimension of dimensions) {
      const bases = UNIT_DEFINITIONS.filter(
        (unit) => unit.dimension === dimension && unit.to_base === 1 && (unit.offset ?? 0) === 0,
      );
      expect(bases.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('parseQuantity', () => {
  it('splits value and unit, retaining the unit as written', () => {
    expect(parseQuantity('36,000 BTU/h')).toEqual({
      ok: true,
      value: { value: 36_000, unit: 'BTU/h', source_unit: 'BTU/h' },
    });
    expect(parseQuantity('3 tons')).toEqual({
      ok: true,
      value: { value: 3, unit: 'ton', source_unit: 'tons' },
    });
    expect(parseQuantity('189.5 lb')).toMatchObject({ ok: true, value: { unit: 'lb' } });
  });

  it('reports a bare number as unitless rather than inventing a unit', () => {
    expect(parseQuantity('15.2')).toEqual({
      ok: true,
      value: { value: 15.2, unit: null, source_unit: null },
    });
  });

  it('refuses trailing text it does not recognise as a unit', () => {
    const result = parseQuantity('36,000 BTU/h (nominal)');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNKNOWN_UNIT');
  });

  it('honours vertical-configured separators', () => {
    expect(parseDecimal('1.234,56', { decimal_separator: ',', group_separator: '.' })).toEqual({
      ok: true,
      value: 1234.56,
    });
    expect(parseDecimal("1'234'567", { group_separator: "'" })).toEqual({ ok: true, value: 1_234_567 });
  });

  it('reads the foot and inch marks as units, not as digit separators', () => {
    expect(parseQuantity("32'")).toEqual({
      ok: true,
      value: { value: 32, unit: 'ft', source_unit: "'" },
    });
    expect(parseQuantity('24"')).toEqual({
      ok: true,
      value: { value: 24, unit: 'in', source_unit: '"' },
    });
    // A compound feet-and-inches measurement is not something this parser
    // pretends to understand: it fails rather than reading `32' 6"` as 32.
    expect(parseQuantity('32\' 6"').ok).toBe(false);
  });

  it('fails on values that are not numbers at all', () => {
    for (const raw of ['', 'call for pricing', 'N/A']) {
      expect(parseQuantity(raw).ok).toBe(false);
    }
  });
});
