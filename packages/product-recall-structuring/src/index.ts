/**
 * Consumer-product recall notices from CPSC (US) and Health Canada (CA),
 * structured into one shape with one taxonomy. Each notice keeps its own
 * agency's facts; notices link only through declared citations
 * (cross_references), while joint-recall markers stay candidate evidence.
 */

export { structureCpscRecall, isUsableCpscRecord, titleFirm, sumUnits, CPSC_RECALL_NUMBER, type CpscRecallRecord } from './cpsc.js';
export { structureHcRecall, isConsumerProductRecord, HC_CONSUMER_ORGANIZATION, type HcRecallRecord } from './hc.js';
export { canonicalHcUrl, crossReference, jointAgencies } from './links.js';
export { extractModelNumbers, extractModelNumbersWithFields, type ModelNumbers } from './models.js';
export { classifyHazards, classifyRemedies, tradeFacets, HAZARD_CLASSES, REMEDY_CLASSES, TRADE_FACETS, type HazardClass, type RemedyClass, type TradeFacet } from './taxonomy.js';
export { cleanText, digitCodes, gtin14, gtinReadings, modelKey } from './text.js';
export { parseUnits, type UnitCounts } from './units.js';
export { PARSER_VERSION, type Agency, type CounterpartAgency, type CrossReference, type FirmMention, type RecallProduct, type StructuredProductRecall } from './types.js';
export {
  candidateFields,
  candidateFieldText,
  decideIdentifierCandidate,
  decideIdentifierInRecord,
  IDENTIFIER_LABELS,
  IDENTIFIER_TASK,
  type CandidateDecision,
  type CandidateRejection,
  type IdentifierLabel,
  type RecordDecision,
} from './identifier-candidates.js';
