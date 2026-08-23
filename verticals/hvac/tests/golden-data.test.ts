/**
 * GOLDEN DATA tests for `hvac`.
 *
 * These check that the expected canonical output in `fixtures/golden/` is
 * internally consistent and consistent with the declared configuration — that
 * the contract itself is coherent, before any pipeline exists to satisfy it.
 *
 * A golden file nobody validates is a wish, not a contract.
 *
 * Self-contained: `yaml`, `vitest` and Node built-ins only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTICAL = join(HERE, '..');

const readYaml = (...s: string[]): any => parseYaml(readFileSync(join(VERTICAL, ...s), 'utf8'));
const readJson = (...s: string[]): any => JSON.parse(readFileSync(join(VERTICAL, ...s), 'utf8'));

const vertical = readYaml('vertical.yaml');
const relationshipDefs = readYaml('relationships.yaml');
const seo = readYaml('seo.yaml');
const entityDefs: Record<string, any> = Object.fromEntries(
  (vertical.entity_types as string[]).map((t) => [t, readYaml('entities', `${t}.yaml`)]),
);

const golden = {
  entities: readJson('fixtures', 'golden', 'entities.json'),
  facts: readJson('fixtures', 'golden', 'facts.json'),
  relationships: readJson('fixtures', 'golden', 'relationships.json'),
};

const entityByRef: Record<string, any> = Object.fromEntries(
  golden.entities.entities.map((e: any) => [e.ref, e]),
);
const activeFacts = golden.facts.facts.filter((f: any) => f.status === 'ACTIVE');

/**
 * Reference implementation of the Layer 3 `model_number` rule from
 * normalizers/03-domain-normalization.yaml: uppercase, strip separators.
 *
 * Deliberately re-implemented here rather than imported. This test asserts that
 * the golden join keys are what the DECLARED RULE produces — if the rule and the
 * golden data ever disagree, that is exactly the failure worth catching.
 */
const normalizeModelNumber = (raw: string): string =>
  raw.toUpperCase().replace(/[-_. /\\]/g, '');

describe('golden entities', () => {
  it('contains the documented population', () => {
    const counts = golden.entities.counts;
    expect(counts).toEqual({
      manufacturer: 3,
      equipment_model: 13,
      certification: 11,
      total: 27,
    });
    expect(golden.entities.entities).toHaveLength(counts.total);
    for (const [type, expected] of Object.entries(counts)) {
      if (type === 'total') continue;
      expect(
        golden.entities.entities.filter((e: any) => e.entity_type === type),
      ).toHaveLength(expected as number);
    }
  });

  it('uses only declared entity types and alias types', () => {
    const aliasTypes = new Set<string>([
      ...vertical.alias_types.map((a: any) => a.type),
      // Platform CORE_ALIAS_TYPES, used for manufacturer identity.
      'name', 'legal_name', 'dba', 'abbreviation', 'former_name',
    ]);
    for (const entity of golden.entities.entities) {
      expect(vertical.entity_types, entity.ref).toContain(entity.entity_type);
      for (const alias of entity.aliases) {
        expect(aliasTypes.has(alias.alias_type), `${entity.ref}: ${alias.alias_type}`).toBe(true);
      }
    }
  });

  it('normalizes four source spellings of one model to one join key (rule 7)', () => {
    // The central assertion of the whole fixture set.
    const star = entityByRef['equipment_model:24ACC636A003'];
    const modelAliases = star.aliases.filter((a: any) => a.alias_type === 'model_number');

    const spellings = modelAliases.map((a: any) => a.alias_value).sort();
    expect(spellings).toEqual(['24ACC6 36A003', '24ACC636A003', '24acc6-36a003']);

    for (const alias of modelAliases) {
      expect(alias.normalized_value, alias.alias_value).toBe('24ACC636A003');
    }
    // All four sources contribute, via three distinct spellings.
    expect(new Set(modelAliases.flatMap((a: any) => a.sources)).size).toBe(4);
  });

  it('produces every golden join key from the declared normalization rule', () => {
    for (const entity of golden.entities.entities) {
      for (const alias of entity.aliases.filter((a: any) => a.alias_type === 'model_number')) {
        expect(
          normalizeModelNumber(alias.alias_value),
          `${entity.ref}: "${alias.alias_value}"`,
        ).toBe(alias.normalized_value);
      }
    }
  });

  it('strips punctuation the manufacturer uses, so the key differs from every spelling', () => {
    // BTW-C2036 -> BTWC2036. canonical_name keeps the punctuation for display;
    // the join key does not.
    const borealis = entityByRef['equipment_model:BTWC2036'];
    expect(borealis.canonical_name).toContain('BTW-C2036');
    for (const alias of borealis.aliases.filter((a: any) => a.alias_type === 'model_number')) {
      expect(alias.normalized_value).toBe('BTWC2036');
    }
  });

  it('validates every UPC checksum', () => {
    // A mistyped barcode entering the alias index attaches one product's
    // identity to another, so the check digit is used rather than trusted.
    const upcs = golden.entities.entities.flatMap((e: any) =>
      e.aliases.filter((a: any) => a.alias_type === 'upc').map((a: any) => a.normalized_value),
    );
    expect(upcs.length).toBeGreaterThanOrEqual(5);
    for (const upc of upcs) {
      expect(upc).toMatch(/^[0-9]{12}$/);
      const digits = [...upc].map(Number);
      const sum = digits
        .slice(0, 11)
        .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
      expect((10 - (sum % 10)) % 10, `UPC ${upc} checksum`).toBe(digits[11]);
    }
  });

  it('records durable negative judgments for the pairs blocking will propose', () => {
    // Doc 06: never lose negative judgments; they prevent repeated bad matching.
    expect(golden.entities.negative_judgments.length).toBeGreaterThanOrEqual(3);
    for (const judgment of golden.entities.negative_judgments) {
      expect(judgment.decision).toBe('different');
      expect(judgment.rationale).toBeTruthy();
      expect(entityByRef[judgment.left], judgment.left).toBeDefined();
      expect(entityByRef[judgment.right], judgment.right).toBeDefined();
    }
  });

  it('never records a supersession pair as the same entity', () => {
    // Merging a model into its successor destroys the replacement lookup.
    const supersessionPairs = golden.relationships.relationships
      .filter((r: any) => r.predicate === 'supersedes')
      .map((r: any) => [r.subject, r.object].sort().join('|'));
    const negatives = new Set(
      golden.entities.negative_judgments.map((j: any) => [j.left, j.right].sort().join('|')),
    );
    for (const pair of supersessionPairs) {
      expect(negatives.has(pair), `${pair} must be a recorded non-match`).toBe(true);
    }
  });
});

describe('golden facts', () => {
  it('matches its own declared counts', () => {
    const counts = golden.facts.counts;
    expect(golden.facts.facts).toHaveLength(counts.total);
    expect(activeFacts).toHaveLength(counts.active);
    expect(golden.facts.facts.filter((f: any) => f.status === 'SUPERSEDED')).toHaveLength(
      counts.superseded,
    );
  });

  it('attaches every fact to a known entity and a declared property', () => {
    for (const fact of golden.facts.facts) {
      const entity = entityByRef[fact.entity];
      expect(entity, fact.entity).toBeDefined();
      const declared = entityDefs[entity.entity_type].properties.map((p: any) => p.name);
      expect(declared, `${fact.entity}.${fact.property}`).toContain(fact.property);
    }
  });

  it('gives every fact evidence (AGENTS.md rule 2)', () => {
    // "No published fact without evidence." 171 of 171.
    for (const fact of golden.facts.facts) {
      expect(fact.evidence?.length, `${fact.entity}.${fact.property}`).toBeGreaterThan(0);
      for (const evidence of fact.evidence) {
        expect(evidence.source, `${fact.entity}.${fact.property}`).toBeTruthy();
        expect(evidence.source_value).toBeDefined();
        expect(evidence.locator_type).toBeTruthy();
      }
    }
  });

  it('cites only declared sources, with valid locator types', () => {
    const sourceKeys = new Set(['acme-hvac-catalog', 'coolsupply-distributor', 'ahri-directory-export', 'acme-spec-sheets']);
    const locatorTypes = new Set([
      'WHOLE_DOCUMENT', 'CSS_SELECTOR', 'XPATH', 'JSON_POINTER',
      'PAGE', 'LINE_RANGE', 'BYTE_RANGE', 'TABLE_CELL', 'REGEX_MATCH',
    ]);
    for (const fact of golden.facts.facts) {
      for (const evidence of fact.evidence) {
        expect(sourceKeys.has(evidence.source), evidence.source).toBe(true);
        expect(locatorTypes.has(evidence.locator_type), evidence.locator_type).toBe(true);
      }
    }
  });

  it('carries units exactly where the property declares one', () => {
    for (const fact of golden.facts.facts) {
      const entity = entityByRef[fact.entity];
      const definition = entityDefs[entity.entity_type].properties.find(
        (p: any) => p.name === fact.property,
      );
      expect(fact.unit, `${fact.entity}.${fact.property}`).toBe(definition.unit ?? null);
      expect(fact.value_type).toBe(definition.value_type);
    }
  });

  it('keeps confidence on the unit interval', () => {
    for (const fact of golden.facts.facts) {
      expect(fact.confidence).toBeGreaterThanOrEqual(0);
      expect(fact.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('records which criterion selected every active value', () => {
    // Without this the canonical value is unexplainable.
    const criteria = new Set([
      'authoritative_source', 'field_reliability', 'corroboration',
      'recency', 'consistency_check', 'editorial_override', 'derived',
    ]);
    for (const fact of activeFacts) {
      expect(criteria.has(fact.selected_by), `${fact.entity}.${fact.property}: ${fact.selected_by}`).toBe(true);
    }
  });

  it('retains every losing claim with its evidence and its reason', () => {
    // AGENTS.md rules 2 and 10 — nothing in this model deletes a claim.
    const superseded = golden.facts.facts.filter((f: any) => f.status === 'SUPERSEDED');
    expect(superseded).toHaveLength(2);
    for (const fact of superseded) {
      expect(fact.lost_to, `${fact.entity}.${fact.property}`).toBeTruthy();
      expect(fact.lost_because).toBe('authoritative_source');
      expect(fact.retention_note).toBeTruthy();
      expect(fact.evidence.length).toBeGreaterThan(0);
      // The winner must still exist as an ACTIVE fact on the same property.
      expect(
        activeFacts.some((a: any) => a.entity === fact.entity && a.property === fact.property),
      ).toBe(true);
    }
  });

  it('resolves Conflict A by authority, against two agreeing sources', () => {
    // The instructive one: corroboration cannot outvote an authoritative source.
    const claims = golden.facts.facts.filter(
      (f: any) => f.entity === 'equipment_model:24ACC636A003' && f.property === 'seer2',
    );
    expect(claims).toHaveLength(2);

    const winner = claims.find((c: any) => c.status === 'ACTIVE');
    const loser = claims.find((c: any) => c.status === 'SUPERSEDED');

    expect(winner.normalized_value).toBe(14.3);
    expect(winner.evidence.map((e: any) => e.source)).toEqual(['ahri-directory-export']);

    expect(loser.normalized_value).toBe(14.5);
    // TWO sources back the losing value.
    expect(loser.evidence).toHaveLength(2);
    expect(loser.evidence.map((e: any) => e.source).sort()).toEqual([
      'acme-hvac-catalog',
      'coolsupply-distributor',
    ]);
  });

  it('resolves Conflict B in favour of the published engineering document', () => {
    const claims = golden.facts.facts.filter(
      (f: any) => f.entity === 'equipment_model:24ACC648A003' && f.property === 'sound_level_db',
    );
    expect(claims).toHaveLength(2);
    const winner = claims.find((c: any) => c.status === 'ACTIVE');
    const loser = claims.find((c: any) => c.status === 'SUPERSEDED');
    expect(winner.normalized_value).toBe(72);
    expect(winner.evidence[0].source).toBe('acme-spec-sheets');
    expect(loser.normalized_value).toBe(69);
    expect(loser.evidence[0].source).toBe('coolsupply-distributor');
  });

  it('documents both conflicts in the file header', () => {
    expect(golden.facts.conflicts).toHaveLength(2);
    for (const conflict of golden.facts.conflicts) {
      expect(conflict.decided_by).toBe('authoritative_source');
      expect(conflict.note).toBeTruthy();
    }
  });

  it('keeps capacity and tonnage consistent at exactly 12000:1', () => {
    const byEntity: Record<string, Record<string, number>> = {};
    for (const fact of activeFacts) {
      if (fact.property === 'cooling_capacity_btu' || fact.property === 'nominal_tonnage') {
        (byEntity[fact.entity] ??= {})[fact.property] = fact.normalized_value;
      }
    }
    const pairs = Object.entries(byEntity).flatMap(([ref, values]) => {
      const capacity = values['cooling_capacity_btu'];
      const tonnage = values['nominal_tonnage'];
      return capacity === undefined || tonnage === undefined ? [] : [{ ref, capacity, tonnage }];
    });
    // Every one of the 13 models carries both, one direct and one derived.
    expect(pairs).toHaveLength(13);
    for (const { ref, capacity, tonnage } of pairs) {
      expect(capacity, ref).toBeCloseTo(tonnage * 12000, 6);
    }
  });

  it('publishes hspf2 only for heat pumps', () => {
    // Its absence on air conditioners is correct absence, not missing data.
    const productType: Record<string, string> = {};
    for (const fact of activeFacts) {
      if (fact.property === 'product_type') productType[fact.entity] = fact.normalized_value;
    }
    for (const fact of activeFacts.filter((f: any) => f.property === 'hspf2')) {
      expect(productType[fact.entity], fact.entity).toBe('heat_pump');
    }
    const heatPumps = Object.entries(productType).filter(([, t]) => t === 'heat_pump');
    const withHspf2 = activeFacts.filter((f: any) => f.property === 'hspf2');
    expect(withHspf2).toHaveLength(heatPumps.length);
  });

  it('normalizes every refrigerant and product_type to a declared term', () => {
    const enums: Record<string, string[]> = {};
    for (const definition of entityDefs['equipment_model'].properties) {
      if (definition.enum) enums[definition.name] = definition.enum;
    }
    for (const fact of golden.facts.facts) {
      if (enums[fact.property]) {
        expect(enums[fact.property], `${fact.entity}.${fact.property}`).toContain(fact.normalized_value);
      }
    }
  });

  it('keeps seer2 above eer2 everywhere, catching a column swap', () => {
    const byEntity: Record<string, Record<string, number>> = {};
    for (const fact of activeFacts) {
      if (fact.property === 'seer2' || fact.property === 'eer2') {
        (byEntity[fact.entity] ??= {})[fact.property] = fact.normalized_value;
      }
    }
    for (const [ref, values] of Object.entries(byEntity)) {
      const seer2 = values['seer2'];
      const eer2 = values['eer2'];
      if (seer2 !== undefined && eer2 !== undefined) {
        expect(seer2, `${ref}: SEER2/EER2 look swapped`).toBeGreaterThan(eer2);
      }
    }
  });

  it('satisfies every declared range rule', () => {
    const ranges = entityDefs['equipment_model'].quality_rules.filter((r: any) => r.rule === 'range');
    expect(ranges.length).toBeGreaterThan(0);
    for (const rule of ranges) {
      for (const fact of activeFacts.filter((f: any) => f.property === rule.property)) {
        expect(fact.normalized_value, `${fact.entity}.${rule.property}`).toBeGreaterThanOrEqual(rule.min);
        expect(fact.normalized_value, `${fact.entity}.${rule.property}`).toBeLessThanOrEqual(rule.max);
      }
    }
  });
});

describe('golden relationships', () => {
  it('matches its own declared counts', () => {
    const counts = golden.relationships.counts;
    expect(golden.relationships.relationships).toHaveLength(counts.total);
    for (const predicate of vertical.relationship_predicates) {
      expect(
        golden.relationships.relationships.filter((r: any) => r.predicate === predicate),
        predicate,
      ).toHaveLength(counts[predicate]);
    }
  });

  it('uses declared predicates with the declared subject and object types', () => {
    const byPredicate = Object.fromEntries(
      relationshipDefs.predicates.map((p: any) => [p.predicate, p]),
    );
    for (const edge of golden.relationships.relationships) {
      const definition = byPredicate[edge.predicate];
      expect(definition, edge.predicate).toBeDefined();
      expect(entityByRef[edge.subject], edge.subject).toBeDefined();
      expect(entityByRef[edge.object], edge.object).toBeDefined();
      expect(entityByRef[edge.subject].entity_type).toBe(definition.subject_type);
      expect(entityByRef[edge.object].entity_type).toBe(definition.object_type);
    }
  });

  it('gives every edge evidence and clears its minimum confidence', () => {
    const byPredicate = Object.fromEntries(
      relationshipDefs.predicates.map((p: any) => [p.predicate, p]),
    );
    for (const edge of golden.relationships.relationships) {
      expect(edge.evidence?.length, `${edge.subject} ${edge.predicate} ${edge.object}`).toBeGreaterThan(0);
      expect(edge.confidence).toBeGreaterThanOrEqual(byPredicate[edge.predicate].min_confidence);
    }
  });

  it('gives every equipment model exactly one manufacturer', () => {
    const models = golden.entities.entities.filter((e: any) => e.entity_type === 'equipment_model');
    for (const model of models) {
      const edges = golden.relationships.relationships.filter(
        (r: any) => r.predicate === 'manufactures' && r.object === model.ref,
      );
      expect(edges, model.ref).toHaveLength(1);
    }
  });

  it('keeps supersession acyclic, self-free and within one manufacturer', () => {
    const edges = golden.relationships.relationships.filter((r: any) => r.predicate === 'supersedes');
    const manufacturerOf: Record<string, string> = {};
    for (const edge of golden.relationships.relationships.filter((r: any) => r.predicate === 'manufactures')) {
      manufacturerOf[edge.object] = edge.subject;
    }

    const successorOf: Record<string, string> = {};
    for (const edge of edges) {
      expect(edge.subject, 'no self-supersession').not.toBe(edge.object);
      expect(manufacturerOf[edge.subject], 'supersession must stay within a manufacturer')
        .toBe(manufacturerOf[edge.object]);
      successorOf[edge.object] = edge.subject;
    }

    // Walk every chain; a cycle would not terminate.
    for (const start of Object.keys(successorOf)) {
      const seen = new Set<string>([start]);
      let node = start;
      for (;;) {
        const next = successorOf[node];
        if (next === undefined) break;
        node = next;
        expect(seen.has(node), `cycle through ${node}`).toBe(false);
        seen.add(node);
      }
    }
  });

  it('resolves the two-hop chain to the current model, not the first hop', () => {
    // The single most important traversal in the vertical. A one-hop answer
    // returns another discontinued model: it looks right and is wrong.
    const traversal = golden.relationships.expected_traversals.find(
      (t: any) => t.start === 'equipment_model:24ACA636A003',
    );
    expect(traversal.hops).toBe(2);
    expect(traversal.expected_terminal).toBe('equipment_model:24ACC636A003');
    expect(traversal.expected_path).toEqual([
      'equipment_model:24ACA636A003',
      'equipment_model:24ACB636A003',
      'equipment_model:24ACC636A003',
    ]);

    // And the declared path is what the golden edges actually produce.
    const successorOf: Record<string, string> = {};
    for (const edge of golden.relationships.relationships.filter((r: any) => r.predicate === 'supersedes')) {
      successorOf[edge.object] = edge.subject;
    }
    const walked = ['equipment_model:24ACA636A003'];
    for (;;) {
      const last = walked[walked.length - 1];
      if (last === undefined) break;
      const next = successorOf[last];
      if (next === undefined) break;
      walked.push(next);
    }
    expect(walked).toEqual(traversal.expected_path);
  });

  it('reports the current model as current rather than returning nothing', () => {
    const traversal = golden.relationships.expected_traversals.find(
      (t: any) => t.start === 'equipment_model:24ACC636A003',
    );
    expect(traversal.hops).toBe(0);
    expect(traversal.expected_terminal).toBe('equipment_model:24ACC636A003');
  });

  it('crosses a refrigerant change along the chain', () => {
    // Which is why the replacement is not a drop-in, and why the tool must say so.
    const refrigerantOf: Record<string, string> = {};
    for (const fact of activeFacts.filter((f: any) => f.property === 'refrigerant')) {
      refrigerantOf[fact.entity] = fact.normalized_value;
    }
    expect(refrigerantOf['equipment_model:24ACA636A003']).toBe('R-410A');
    expect(refrigerantOf['equipment_model:24ACB636A003']).toBe('R-410A');
    expect(refrigerantOf['equipment_model:24ACC636A003']).toBe('R-454B');
  });

  it('fabricates no compatibility edges', () => {
    // No source asserts compatibility; inference and transitive closure are both
    // forbidden. Any edge here is a fabricated safety-relevant claim.
    expect(
      golden.relationships.relationships.filter((r: any) => r.predicate === 'compatible_with'),
    ).toHaveLength(0);
    expect(golden.relationships.counts.compatible_with).toBe(0);
  });

  it('leaves discontinued models uncertified', () => {
    // Directories drop withdrawn models. Back-filling from an older export
    // would assert a currently-valid certification that does not exist.
    for (const ref of ['equipment_model:24ACA636A003', 'equipment_model:24ACB636A003']) {
      expect(
        golden.relationships.relationships.filter(
          (r: any) => r.predicate === 'certified_by' && r.subject === ref,
        ),
        ref,
      ).toHaveLength(0);
    }
  });

  it('agrees on capacity across every certified_by join', () => {
    // A mismatch means the model number resolved to the wrong entity — the
    // highest-consequence resolution error possible in this vertical.
    const capacityOf: Record<string, number> = {};
    for (const fact of activeFacts.filter((f: any) => f.property === 'cooling_capacity_btu')) {
      capacityOf[fact.entity] = fact.normalized_value;
    }
    const edges = golden.relationships.relationships.filter((r: any) => r.predicate === 'certified_by');
    expect(edges).toHaveLength(11);
    for (const edge of edges) {
      expect(capacityOf[edge.subject], `${edge.subject} vs ${edge.object}`)
        .toBe(capacityOf[edge.object]);
    }
  });

  it('leaves no orphan certifications', () => {
    const certified = new Set(
      golden.relationships.relationships
        .filter((r: any) => r.predicate === 'certified_by')
        .map((r: any) => r.object),
    );
    for (const certification of golden.entities.entities.filter((e: any) => e.entity_type === 'certification')) {
      expect(certified.has(certification.ref), `${certification.ref} is orphaned`).toBe(true);
    }
  });
});

describe('indexability gate applied to the golden data', () => {
  /** Critical properties present, per equipment model. */
  const criticalProperties: string[] = entityDefs['equipment_model'].properties
    .filter((p: any) => p.critical)
    .map((p: any) => p.name);

  const modelFacts: Record<string, string[]> = {};
  for (const fact of activeFacts) {
    if (fact.entity.startsWith('equipment_model:')) {
      (modelFacts[fact.entity] ??= []).push(fact.property);
    }
  }

  const gate = seo.quality_gates.entity_detail;
  const evaluate = (properties: string[]) => {
    const covered = criticalProperties.filter((c) => properties.includes(c)).length;
    return {
      coverage: covered / criticalProperties.length,
      total: properties.length,
      passes:
        covered / criticalProperties.length >= gate.min_critical_fact_coverage &&
        properties.length >= gate.min_total_facts,
    };
  };

  it('passes exactly 7 of 13 models — the documented, honest number', () => {
    const results = Object.entries(modelFacts).map(([ref, props]) => ({ ref, ...evaluate(props) }));
    expect(results).toHaveLength(13);
    expect(results.filter((r) => r.passes)).toHaveLength(7);
    expect(results.filter((r) => !r.passes)).toHaveLength(6);
  });

  it('fails every model for the same reason: no voltage', () => {
    // The gate reports a real, specific, fixable source gap — only the
    // manufacturer family publishes electrical data, and we hold one.
    const failing = Object.entries(modelFacts)
      .filter(([, props]) => !evaluate(props).passes)
      .map(([ref]) => ref);
    expect(failing.sort()).toEqual([
      'equipment_model:BTWC2036',
      'equipment_model:BTWC2048',
      'equipment_model:BTWH3036',
      'equipment_model:NWA1424AC1',
      'equipment_model:NWA1436AC1',
      'equipment_model:NWA1448AC1',
    ]);
    for (const ref of failing) {
      expect(modelFacts[ref], ref).not.toContain('voltage');
    }
  });

  it('needs BOTH thresholds — neither works alone', () => {
    // Coverage alone passes all 13 (every model reaches 0.833 > 0.80); it is
    // min_total_facts that catches the genuinely thin ones.
    const coverageOnly = Object.values(modelFacts).filter(
      (props) => evaluate(props).coverage >= gate.min_critical_fact_coverage,
    );
    expect(coverageOnly).toHaveLength(13);
  });
});
