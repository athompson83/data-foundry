import * as cheerio from 'cheerio';
import { cssPathOf, isTagNode, type HtmlNodeLike } from './providers/html-dom.js';

/**
 * Record-selector suggestions for onboarding an HTML source.
 *
 * Drafting an extraction schema for a new listing page starts with one question:
 * which repeated element is one record? This finds sibling groups that share a
 * tag, classes and child shape (result rows, cards, list items) and proposes a
 * CSS selector for each, ranked by how record-like the group looks.
 *
 * A suggestion is a draft for the source's extraction schema, never a decision.
 * It is accepted only when the schema built from it passes the source's fixture
 * and golden-record tests like any hand-written selector. Nothing here runs at
 * ingestion time.
 */

interface ElementLike extends HtmlNodeLike {
  readonly attribs?: Readonly<Record<string, string>>;
  readonly children?: readonly ElementLike[];
}

interface Selection {
  text(): string;
  toArray(): ElementLike[];
}

interface DocumentQuery {
  (subject: string | ElementLike): Selection;
  root(): Selection;
}

export interface RecordSelectorSuggestion {
  /** CSS selector matching exactly the members of the group, verified against the document. */
  readonly selector: string;
  readonly count: number;
  /** Share of members whose direct-child tag sequence equals the group's most common one (0–1). */
  readonly consistency: number;
  /** Median number of non-empty text leaves per member: a proxy for how many fields a record carries. */
  readonly fieldCount: number;
  readonly score: number;
  /** Collapsed text of the first members, for a reviewer to recognise the records. */
  readonly samples: readonly string[];
}

export interface SuggestRecordSelectorsOptions {
  /** Fewest siblings that count as a repeated group. Default 3. */
  readonly minRepeats?: number | undefined;
  readonly maxSuggestions?: number | undefined;
  readonly sampleCount?: number | undefined;
  readonly sampleChars?: number | undefined;
}

const IGNORED_TAGS: ReadonlySet<string> = new Set([
  'head', 'script', 'style', 'noscript', 'template', 'svg', 'path', 'option', 'br', 'hr', 'meta', 'link',
]);
const CSS_IDENTIFIER = /^-?[A-Za-z_][\w-]*$/;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const elementChildren = (node: ElementLike): ElementLike[] =>
  (node.children ?? []).filter(
    (child): child is ElementLike => isTagNode(child) && !IGNORED_TAGS.has(String(child.name).toLowerCase()),
  );

function signature(node: ElementLike): string {
  const tag = String(node.name).toLowerCase();
  const classes = (node.attribs?.['class'] ?? '')
    .split(/\s+/)
    .filter((name) => CSS_IDENTIFIER.test(name))
    .sort();
  return [tag, ...classes.map((name) => `.${name}`)].join('');
}

const childShape = (node: ElementLike): string =>
  elementChildren(node)
    .map((child) => String(child.name).toLowerCase())
    .join(',');

/** Non-empty text of each leaf element, in document order, so adjacent cells are not run together. */
function textLeaves($: DocumentQuery, node: ElementLike): string[] {
  const children = elementChildren(node);
  if (children.length === 0) {
    const text = collapse($(node).text());
    return text === '' ? [] : [text];
  }
  return children.flatMap((child) => textLeaves($, child));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function* walk(node: ElementLike): Generator<ElementLike> {
  for (const child of elementChildren(node)) {
    yield child;
    yield* walk(child);
  }
}

/** Rank repeated sibling groups in `html` as candidate `{ kind: 'css' }` record selectors. */
export function suggestHtmlRecordSelectors(
  html: string,
  options: SuggestRecordSelectorsOptions = {},
): RecordSelectorSuggestion[] {
  const minRepeats = options.minRepeats ?? 3;
  const maxSuggestions = options.maxSuggestions ?? 5;
  const sampleCount = options.sampleCount ?? 2;
  const sampleChars = options.sampleChars ?? 160;

  const $ = cheerio.load(html) as unknown as DocumentQuery;
  const [root] = $.root().toArray();
  if (root === undefined) return [];

  const parents = [root, ...walk(root)];

  // Pass 1: every repeated sibling group in the document.
  const groups: Array<{ readonly parent: ElementLike; readonly key: string; readonly members: ElementLike[] }> = [];
  for (const parent of parents) {
    const byKey = new Map<string, ElementLike[]>();
    for (const child of elementChildren(parent)) {
      const key = signature(child);
      byKey.set(key, [...(byKey.get(key) ?? []), child]);
    }
    for (const [key, members] of byKey) {
      if (members.length >= minRepeats) groups.push({ parent, key, members });
    }
  }

  // A group inside a member of another repeated group is a set of fields within
  // each record (the cells of a result row), not a record list of its own.
  const repeatedMembers = new Set<ElementLike>(groups.flatMap((group) => group.members));

  const suggestions: RecordSelectorSuggestion[] = [];
  for (const { parent, key, members } of groups) {
    if (repeatedMembers.has(parent)) continue;
    const withText = members.filter((member) => collapse($(member).text()) !== '');
    if (withText.length === 0) continue;

    const parentPath = parent === root ? '' : cssPathOf(parent);
    const selector = parentPath === '' ? key : `${parentPath} > ${key}`;
    // The selector must select exactly this group; otherwise it would not describe these records.
    if ($(selector).toArray().length !== members.length) continue;

    const shapes = new Map<string, number>();
    for (const member of members) {
      const shape = childShape(member);
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    const consistency = Math.max(...shapes.values()) / members.length;
    const fieldCount = median(members.map((member) => textLeaves($, member).length));
    const textCoverage = withText.length / members.length;
    const score =
      Math.round(Math.log2(members.length + 1) * consistency * textCoverage * Math.min(fieldCount, 12) * 1000) / 1000;
    if (score === 0) continue;

    suggestions.push({
      selector,
      count: members.length,
      consistency: Math.round(consistency * 1000) / 1000,
      fieldCount,
      score,
      samples: withText
        .slice(0, sampleCount)
        .map((member) => textLeaves($, member).join(' ').slice(0, sampleChars)),
    });
  }

  return suggestions
    .sort((a, b) => b.score - a.score || (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))
    .slice(0, maxSuggestions);
}
