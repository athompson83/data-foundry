/** Health Canada open-index fields admitted by the source rights record. Advice/contact text is excluded. */
import { decideIdentifierCandidate, type RecordDecision } from './identifier-candidates.js';

export const HC_IDENTIFIER_TASK = 'health-canada-product-identifiers@1';

export function decideHcIdentifierInRecord(record: unknown, value: string, claimedField: string): RecordDecision {
  if (claimedField !== 'Title' && claimedField !== 'Product') return { ok: false, reason: 'field_not_allowed', field: claimedField };
  const source = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  const fields = [claimedField, ...['Title', 'Product'].filter((field) => field !== claimedField)];
  let first: RecordDecision | undefined;
  for (const field of fields) {
    const text = source[field];
    if (typeof text !== 'string') continue;
    // Same code/label rules as CPSC prose, never the implicit Products[n].Model anchor.
    const decision = { ...decideIdentifierCandidate(text, value, 'Description'), field };
    if (decision.ok) return decision;
    if (decision.reason !== 'not_in_source') first ??= decision;
  }
  return first ?? { ok: false, reason: 'not_in_source', field: claimedField };
}
