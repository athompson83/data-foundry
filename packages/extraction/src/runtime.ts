/** Worker-safe explicit JSON/CSV registry; no PDF, HTML or filesystem dependency. */
export * from './types.js';
export * from './schema.js';
export { ExtractionProviderRegistry } from './registry-core.js';
import { ExtractionProviderRegistry } from './registry-core.js';
import { JsonExtractor } from './providers/json-extractor.js';
import { CsvExtractor } from './providers/csv-extractor.js';
export const createRuntimeExtractionRegistry = () => new ExtractionProviderRegistry([new JsonExtractor(), new CsvExtractor()]);
