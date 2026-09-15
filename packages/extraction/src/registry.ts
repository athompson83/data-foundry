import { CsvExtractor } from './providers/csv-extractor.js';
import { HtmlExtractor } from './providers/html-extractor.js';
import { JsonExtractor } from './providers/json-extractor.js';
import { PdfExtractor } from './providers/pdf-extractor.js';
import type { ExtractionProvider } from './types.js';
import { ExtractionProviderRegistry } from './registry-core.js';
export { ExtractionProviderRegistry } from './registry-core.js';
/** The four providers this package ships. Fresh instances per call — no shared mutable state. */
export const createDefaultExtractionProviders = (): ExtractionProvider[] => [
  new JsonExtractor(),
  new CsvExtractor(),
  new HtmlExtractor(),
  new PdfExtractor(),
];

export const createExtractionRegistry = (
  providers: readonly ExtractionProvider[] = createDefaultExtractionProviders(),
): ExtractionProviderRegistry => new ExtractionProviderRegistry(providers);
