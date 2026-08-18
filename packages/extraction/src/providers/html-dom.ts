/**
 * A minimal structural view of the parsed HTML tree.
 *
 * `cheerio` types its nodes with `domhandler`'s `Element` / `AnyNode`, but
 * `domhandler` is a transitive dependency and this package must not import
 * modules it does not declare. The three properties below (`type`, `name`,
 * `parent`, `children`) are exactly what `domhandler` exposes at runtime and all
 * this module needs to compute a re-resolvable CSS path.
 */
export interface HtmlNodeLike {
  readonly type?: string;
  readonly name?: string;
  readonly parent?: HtmlNodeLike | null;
  readonly children?: readonly HtmlNodeLike[];
}

const TAG_NODE_TYPES: ReadonlySet<string> = new Set(['tag', 'script', 'style']);

export const isTagNode = (node: HtmlNodeLike | null | undefined): node is HtmlNodeLike =>
  node !== null &&
  node !== undefined &&
  typeof node.name === 'string' &&
  node.name.length > 0 &&
  (node.type === undefined || TAG_NODE_TYPES.has(node.type));

/**
 * Builds a CSS path that identifies exactly one element in the document, e.g.
 * `html > body > table:nth-of-type(2) > tbody > tr:nth-of-type(4) > td:nth-of-type(2)`.
 *
 * The *configured* selector is not good enough as a locator: `table.specs td`
 * matches thirty cells, so storing it as evidence would prove nothing. The path
 * is computed from the matched node so provenance can re-resolve the one cell a
 * value actually came from.
 */
export function cssPathOf(node: HtmlNodeLike | null | undefined): string {
  const parts: string[] = [];
  let current: HtmlNodeLike | null | undefined = node;

  while (isTagNode(current)) {
    const tag = String(current.name).toLowerCase();
    const parent: HtmlNodeLike | null | undefined = current.parent;
    const siblings = (parent?.children ?? []).filter(
      (child) => isTagNode(child) && String(child.name).toLowerCase() === tag,
    );
    const position = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 && position > 0 ? `${tag}:nth-of-type(${position})` : tag);
    current = parent;
  }

  return parts.join(' > ');
}

/** Scrapy-style suffix so an attribute-sourced value keeps a single-string locator. */
export const withAttribute = (path: string, attribute: string | undefined): string =>
  attribute === undefined ? path : `${path}::attr(${attribute})`;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Label comparison for table/definition-list selectors. Trailing colons and
 * casing differ constantly between manufacturer templates and carry no meaning,
 * so they are ignored for *matching* only — the raw value is untouched.
 */
export function labelMatches(
  candidate: string,
  label: string,
  mode: 'exact' | 'contains' | 'prefix' = 'exact',
): boolean {
  const left = collapse(candidate).replace(/[:：]\s*$/, '').toLowerCase();
  const right = collapse(label).replace(/[:：]\s*$/, '').toLowerCase();
  switch (mode) {
    case 'exact':
      return left === right;
    case 'contains':
      return left.includes(right);
    case 'prefix':
      return left.startsWith(right);
  }
}
