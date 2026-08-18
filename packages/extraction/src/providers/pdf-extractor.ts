import type { ExtractorVersion } from '@data-foundry/canonical-schema';
import { extractText, getDocumentProxy } from 'unpdf';
import { pageLocator, regexMatchLocator, type EvidenceLocator } from '../locator.js';
import {
  applyRecordKeyPolicy,
  buildRecord,
  finishField,
  type FieldOutcome,
  type LocatedValue,
} from '../record-builder.js';
import type { ExtractionSchema, FieldRule } from '../schema.js';
import {
  ExtractionError,
  artifactBytes,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionIssue,
  type ExtractionProvider,
} from '../types.js';
import { labelMatches } from './html-dom.js';

/**
 * PDF extractor built on `unpdf`, reading the embedded **text layer** only.
 *
 * OCR is explicitly out of scope (doc 02: "OCR only as last resort"). A scanned
 * PDF with no text layer produces an `EMPTY_TEXT_LAYER` issue and a low
 * `extraction_confidence` rather than a guess — a wrong value with a confident
 * score is far more expensive than a missing one.
 *
 * Locators are `PAGE` with the 1-based page number and, where a label or regex
 * matched a specific line, the 1-based line index inside that page's text.
 */
export class PdfExtractor implements ExtractionProvider {
  readonly name = 'pdf-extractor';
  readonly format = 'pdf' as const;
  readonly version: ExtractorVersion;

  constructor(version: ExtractorVersion = 'pdf-extractor@1.0.0') {
    this.version = version;
  }

  supports(schema: ExtractionSchema): boolean {
    return schema.format === 'pdf';
  }

  async extract(
    artifact: ExtractionArtifact,
    schema: ExtractionSchema,
  ): Promise<ExtractedRecord[]> {
    if (!this.supports(schema)) {
      throw new ExtractionError(`PdfExtractor cannot handle format ${schema.format}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    let pages: string[];
    try {
      const document = await getDocumentProxy(artifactBytes(artifact));
      const result = await extractText(document, { mergePages: false });
      pages = result.text;
    } catch (error) {
      throw new ExtractionError('artifact body is not a readable PDF', {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
        cause: error,
      });
    }

    const selector = schema.record;
    let scopes: PdfScope[];
    if (selector.kind === 'pdf_pages') {
      scopes = pages.map((text, index) => ({ pages: [{ page: index + 1, text }] }));
    } else if (selector.kind === 'whole_document') {
      scopes = [{ pages: pages.map((text, index) => ({ page: index + 1, text })) }];
    } else {
      throw new ExtractionError(`PdfExtractor cannot handle record selector ${selector.kind}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    const records = scopes.map((scope, ordinal) =>
      buildRecord({
        schema,
        artifact: artifact.artifact,
        ordinal,
        record_locator: scopeLocator(scope),
        outcomes: schema.fields.map((rule) => readField(scope, rule)),
        extra_issues: emptyTextLayerIssues(scope),
      }),
    );
    return applyRecordKeyPolicy(schema, records);
  }
}

export const createPdfExtractor = (version?: ExtractorVersion): ExtractionProvider =>
  version === undefined ? new PdfExtractor() : new PdfExtractor(version);

interface PdfPage {
  readonly page: number;
  readonly text: string;
}

interface PdfScope {
  readonly pages: readonly PdfPage[];
}

const scopeLocator = (scope: PdfScope): EvidenceLocator => {
  const first = scope.pages[0];
  const last = scope.pages[scope.pages.length - 1];
  if (first === undefined || last === undefined) return pageLocator(0);
  return first.page === last.page
    ? pageLocator(first.page)
    : { type: 'PAGE', value: `page=${first.page}-${last.page}` };
};

function emptyTextLayerIssues(scope: PdfScope): ExtractionIssue[] {
  return scope.pages
    .filter((page) => page.text.trim() === '')
    .map((page) => ({
      code: 'EMPTY_TEXT_LAYER' as const,
      field: null,
      message: `page ${page.page} has no embedded text layer; OCR is out of scope for this provider`,
      locator: pageLocator(page.page),
    }));
}

interface PdfLine {
  readonly page: number;
  readonly line: number;
  readonly text: string;
}

const linesOf = (scope: PdfScope): PdfLine[] =>
  scope.pages.flatMap((page) =>
    page.text.split(/\r\n|\r|\n/).map((text, index) => ({
      page: page.page,
      line: index + 1,
      text,
    })),
  );

const DEFAULT_LABEL_SEPARATORS = ':\\-–—=';

function readField(scope: PdfScope, rule: FieldRule): FieldOutcome {
  const selector = rule.locate;
  const fallback = scopeLocator(scope);

  if (selector.kind === 'pdf_label') {
    const separators = selector.separator ?? DEFAULT_LABEL_SEPARATORS;
    const located: LocatedValue[] = [];
    for (const line of linesOf(scope)) {
      const split = splitLabelledLine(line.text, separators);
      if (split === null) continue;
      if (!labelMatches(split.label, selector.label, selector.match ?? 'exact')) continue;
      if (split.value === '') continue;
      located.push({
        value: split.value,
        locator: pageLocator(line.page, { line: line.line }),
      });
    }
    return finishField(rule, located, fallback);
  }

  if (selector.kind === 'pdf_regex') {
    let regex: RegExp;
    try {
      regex = new RegExp(selector.pattern, (selector.flags ?? '').replace(/g/g, ''));
    } catch (error) {
      return {
        field: rule.field,
        raw: null,
        locator: fallback,
        match_count: 0,
        failure: {
          code: 'FIELD_PARSE_FAILURE',
          message: `invalid pdf_regex ${selector.pattern}: ${String(error)}`,
        },
      };
    }

    const located: LocatedValue[] = [];
    let matchIndex = 0;
    for (const line of linesOf(scope)) {
      const match = regex.exec(line.text);
      if (match === null) continue;
      const group = selector.group ?? (match.length > 1 ? 1 : 0);
      const captured = match[group];
      if (captured === undefined || captured === '') continue;
      located.push({
        value: captured,
        locator: mergeLocators(
          pageLocator(line.page, { line: line.line }),
          regexMatchLocator(selector.pattern, matchIndex),
        ),
      });
      matchIndex += 1;
    }
    return finishField(rule, located, fallback);
  }

  return {
    field: rule.field,
    raw: null,
    locator: fallback,
    match_count: 0,
    failure: {
      code: 'FIELD_PARSE_FAILURE',
      message: `PdfExtractor cannot handle field selector ${selector.kind}`,
    },
  };
}

/**
 * `PAGE` wins as the locator type because the page is what a human can be
 * pointed at; the regex detail is appended so the exact match is reproducible.
 */
const mergeLocators = (page: EvidenceLocator, regex: EvidenceLocator): EvidenceLocator => ({
  type: 'PAGE',
  value: `${page.value};${regex.value}`,
});

/** Splits `SEER2: 15.2` into label and value without touching the value's own text. */
function splitLabelledLine(
  line: string,
  separators: string,
): { readonly label: string; readonly value: string } | null {
  const pattern = new RegExp(`^\\s*([^${separators}]+?)\\s*[${separators}]\\s*(.*)$`);
  const match = pattern.exec(line);
  if (match === null) return null;
  const label = match[1];
  const value = match[2];
  if (label === undefined || value === undefined) return null;
  return { label, value: value.trim() };
}
