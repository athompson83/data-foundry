/**
 * Provenance tests run against the same PGlite + real-migrations harness the
 * store tests use. One fixture definition, so a schema change cannot leave the
 * two packages testing different worlds.
 */
export {
  claim,
  countRows,
  createFixtures,
  migrate,
  ts,
  type ClaimOptions,
  type Fixtures,
  type SourceFixture,
  type SourceKey,
} from '../../canonical-store/test/support.js';
