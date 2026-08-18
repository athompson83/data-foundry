import type { ExtractorVersion } from '@data-foundry/canonical-schema';
import * as cheerio from 'cheerio';
import { cssSelectorLocator, wholeDocumentLocator, type EvidenceLocator } from '../locator.js';
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
  artifactText,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
} from '../types.js';
import { cssPathOf, labelMatches, withAttribute, type HtmlNodeLike } from './html-dom.js';

/**
 * The slice of cheerio's selection API this provider uses.
 *
 * cheerio's own generics thread `domhandler`'s `Element`/`AnyNode` through every
 * signature, and `domhandler` is a transitive dependency this package must not
 * import. Narrowing to the handful of methods actually used, at one cast site in
 * `loadDocument`, keeps the provider's types honest and self-contained. The
 * runtime object is unchanged cheerio.
 */
interface Selection {
  find(selector: string): Selection;
  nextAll(selector: string): Selection;
  text(): string;
  attr(name: string): string | undefined;
  toArray(): HtmlNodeLike[];
  get(index: number): HtmlNodeLike | undefined;
}

interface DocumentQuery {
  (subject: string | HtmlNodeLike): Selection;
  root(): Selection;
}

const loadDocument = (html: string): DocumentQuery =>
  cheerio.load(html) as unknown as DocumentQuery;

/**
 * HTML extractor built on `cheerio`.
 *
 * Aware of the two shapes that carry almost all real specification data:
 * `<table>` label/value rows and `<dl>` term/definition pairs. Every value's
 * locator is a computed unique CSS path to the node it came from, not the
 * (usually multi-matching) selector from the config.
 */
export class HtmlExtractor implements ExtractionProvider {
  readonly name = 'html-extractor';
  readonly format = 'html' as const;
  readonly version: ExtractorVersion;

  constructor(version: ExtractorVersion = 'html-extractor@1.0.0') {
    this.version = version;
  }

  supports(schema: ExtractionSchema): boolean {
    return schema.format === 'html';
  }

  extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]> {
    if (!this.supports(schema)) {
      throw new ExtractionError(`HtmlExtractor cannot handle format ${schema.format}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    const $ = loadDocument(artifactText(artifact));
    const selector = schema.record;

    let scopes: Array<{ readonly selection: Selection; readonly locator: EvidenceLocator }>;
    if (selector.kind === 'whole_document') {
      scopes = [{ selection: $.root(), locator: wholeDocumentLocator() }];
    } else if (selector.kind === 'css') {
      scopes = $(selector.selector)
        .toArray()
        .map((node) => ({
          selection: $(node),
          locator: cssSelectorLocator(cssPathOf(node)),
        }));
    } else {
      throw new ExtractionError(`HtmlExtractor cannot handle record selector ${selector.kind}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    const records = scopes.map((scope, ordinal) =>
      buildRecord({
        schema,
        artifact: artifact.artifact,
        ordinal,
        record_locator: scope.locator,
        outcomes: schema.fields.map((rule) => readField($, scope.selection, scope.locator, rule)),
      }),
    );

    return Promise.resolve(applyRecordKeyPolicy(schema, records));
  }
}

export const createHtmlExtractor = (version?: ExtractorVersion): ExtractionProvider =>
  version === undefined ? new HtmlExtractor() : new HtmlExtractor(version);

function readField(
  $: DocumentQuery,
  scope: Selection,
  scopeLocator: EvidenceLocator,
  rule: FieldRule,
): FieldOutcome {
  const selector = rule.locate;
  switch (selector.kind) {
    case 'css':
      return finishField(
        rule,
        collectCss($, scope, selector.selector, selector.attribute),
        scopeLocator,
      );
    case 'html_table_label':
      return finishField(
        rule,
        collectTableLabel($, scope, {
          label: selector.label,
          match: selector.match ?? 'exact',
          rowSelector: selector.row_selector ?? 'tr',
          labelSelector: selector.label_selector ?? 'th, td',
          valueSelector: selector.value_selector ?? 'td',
        }),
        scopeLocator,
      );
    case 'html_definition_list':
      return finishField(
        rule,
        collectDefinitionList($, scope, {
          term: selector.term,
          match: selector.match ?? 'exact',
          listSelector: selector.list_selector ?? 'dl',
        }),
        scopeLocator,
      );
    default:
      return {
        field: rule.field,
        raw: null,
        locator: scopeLocator,
        match_count: 0,
        failure: {
          code: 'FIELD_PARSE_FAILURE',
          message: `HtmlExtractor cannot handle field selector ${selector.kind}`,
        },
      };
  }
}

/**
 * Outer whitespace is trimmed because HTML indentation is markup, not data.
 * Inner whitespace is left alone — collapsing it is normalization's decision,
 * and extraction must not pre-empt it.
 */
const textOf = ($: DocumentQuery, node: HtmlNodeLike): string => $(node).text().trim();

function collectCss(
  $: DocumentQuery,
  scope: Selection,
  selector: string,
  attribute: string | undefined,
): LocatedValue[] {
  const located: LocatedValue[] = [];
  for (const node of scope.find(selector).toArray()) {
    const raw = attribute === undefined ? textOf($, node) : $(node).attr(attribute);
    if (raw === undefined || raw === '') continue;
    located.push({
      value: attribute === undefined ? raw : raw.trim(),
      locator: cssSelectorLocator(withAttribute(cssPathOf(node), attribute)),
    });
  }
  return located;
}

interface TableLabelOptions {
  readonly label: string;
  readonly match: 'exact' | 'contains' | 'prefix';
  readonly rowSelector: string;
  readonly labelSelector: string;
  readonly valueSelector: string;
}

function collectTableLabel(
  $: DocumentQuery,
  scope: Selection,
  options: TableLabelOptions,
): LocatedValue[] {
  const located: LocatedValue[] = [];
  for (const row of scope.find(options.rowSelector).toArray()) {
    const rowSelection = $(row);
    const labelNode = rowSelection.find(options.labelSelector).get(0);
    if (labelNode === undefined) continue;
    if (!labelMatches(textOf($, labelNode), options.label, options.match)) continue;

    const valueNode = rowSelection
      .find(options.valueSelector)
      .toArray()
      .find((candidate) => candidate !== labelNode);
    if (valueNode === undefined) continue;

    const raw = textOf($, valueNode);
    if (raw === '') continue;
    located.push({ value: raw, locator: cssSelectorLocator(cssPathOf(valueNode)) });
  }
  return located;
}

interface DefinitionListOptions {
  readonly term: string;
  readonly match: 'exact' | 'contains' | 'prefix';
  readonly listSelector: string;
}

function collectDefinitionList(
  $: DocumentQuery,
  scope: Selection,
  options: DefinitionListOptions,
): LocatedValue[] {
  const located: LocatedValue[] = [];
  // The scope may be the `<dl>` itself or an ancestor of it, so look both ways.
  const lists = [...scope.find(options.listSelector).toArray()];
  const scopeNode = scope.get(0);
  if (scopeNode !== undefined && scopeNode.name?.toLowerCase() === 'dl') lists.unshift(scopeNode);

  for (const list of lists) {
    for (const term of $(list).find('dt').toArray()) {
      if (!labelMatches(textOf($, term), options.term, options.match)) continue;
      const definition = $(term).nextAll('dd').get(0);
      if (definition === undefined) continue;
      const raw = textOf($, definition);
      if (raw === '') continue;
      located.push({ value: raw, locator: cssSelectorLocator(cssPathOf(definition)) });
    }
  }
  return located;
}
