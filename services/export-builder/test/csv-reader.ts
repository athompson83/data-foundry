/**
 * A conforming RFC 4180 reader, written here from the specification.
 *
 * The tests that check this service's CSV writer do not assert on the emitted
 * string alone: they read the output back and assert that what comes back is
 * what went in. A writer that only satisfies assertions about its own output
 * format is being marked by itself.
 *
 * It lives in its own module because two suites need it — `csv.test.ts` for the
 * writer's rules and `formula-injection.test.ts` for the bytes a real export
 * actually hands a customer — and two hand-written readers would eventually
 * disagree about what conforming means.
 *
 * Returns `null` for an UNQUOTED empty field and `''` for a quoted one, which is
 * the distinction the writer encodes and the only way to check it survived.
 */
export type Cell = string | null;

export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let buffer = '';
  let quoted = false;
  let sawQuote = false;
  let index = 0;

  const endField = (): void => {
    row.push(!sawQuote && buffer === '' ? null : buffer);
    buffer = '';
    sawQuote = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"') {
        if (text.charAt(index + 1) === '"') {
          buffer += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      buffer += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      sawQuote = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r' && text.charAt(index + 1) === '\n') {
      endRow();
      index += 2;
      continue;
    }
    buffer += character;
    index += 1;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (buffer !== '' || sawQuote || row.length > 0) endRow();
  return rows;
}
