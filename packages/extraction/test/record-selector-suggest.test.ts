import { describe, expect, it } from 'vitest';
import { createHtmlExtractor, parseExtractionSchema, suggestHtmlRecordSelectors } from '../src/index.js';
import { artifactFixture } from './fixtures.js';

/** A typical agency search-results page: navigation, one results table, a footer. */
const LISTING = `<!doctype html>
<html><head><title>Recalls</title><script>var x = 1;</script></head>
<body>
  <nav><ul class="menu">
    <li class="item"><a href="/">Home</a></li>
    <li class="item"><a href="/recalls">Recalls</a></li>
    <li class="item"><a href="/about">About</a></li>
    <li class="item"><a href="/contact">Contact</a></li>
  </ul></nav>
  <main>
    <table class="results">
      <thead><tr><th>Date</th><th>Product</th><th>Model</th><th>Hazard</th></tr></thead>
      <tbody>
        <tr class="row"><td>2026-09-01</td><td>Space heater</td><td>SH-100</td><td>Fire</td></tr>
        <tr class="row"><td>2026-09-03</td><td>Toaster</td><td>TX-2</td><td>Burn</td></tr>
        <tr class="row"><td>2026-09-07</td><td>Stroller</td><td>ST-9</td><td>Fall</td></tr>
        <tr class="row"><td>2026-09-12</td><td>Charger</td><td>CH-44</td><td>Shock</td></tr>
        <tr class="row"><td>2026-09-15</td><td>Kettle</td><td>KT-1</td><td>Burn</td></tr>
      </tbody>
    </table>
  </main>
  <footer><p>A</p><p>B</p></footer>
</body></html>`;

describe('suggestHtmlRecordSelectors', () => {
  it('ranks the result rows above navigation and verifies each selector matches exactly its group', () => {
    const suggestions = suggestHtmlRecordSelectors(LISTING);
    const [best] = suggestions;

    expect(best).toMatchObject({
      selector: 'html > body > main > table > tbody > tr.row',
      count: 5,
      consistency: 1,
      fieldCount: 4,
      samples: ['2026-09-01 Space heater SH-100 Fire', '2026-09-03 Toaster TX-2 Burn'],
    });
    const nav = suggestions.find((s) => s.selector.endsWith('li.item'));
    expect(nav?.count).toBe(4);
    expect(nav?.score ?? Infinity).toBeLessThan(best?.score ?? 0);
    // Two footer paragraphs are below the default repeat threshold.
    expect(suggestions.some((s) => s.selector.includes('footer'))).toBe(false);
    // Cells inside each row are fields of a record, not record lists of their own.
    expect(suggestions.some((s) => / > td$/.test(s.selector))).toBe(false);
  });

  it('produces a selector the HTML extractor accepts as a css record selector', async () => {
    const [best] = suggestHtmlRecordSelectors(LISTING);
    const schema = parseExtractionSchema({
      schema_id: 'example.recalls.listing',
      format: 'html',
      entity_type: 'product_recall',
      record: { kind: 'css', selector: best?.selector },
      record_key: { fields: ['model'] },
      fields: [
        { field: 'model', required: true, locate: { kind: 'css', selector: 'td:nth-of-type(3)' } },
        { field: 'hazard', locate: { kind: 'css', selector: 'td:nth-of-type(4)' } },
      ],
    });
    const records = await createHtmlExtractor().extract(
      artifactFixture({
        id: '55555555-5555-4555-8555-555555555555',
        mime_type: 'text/html',
        url: 'https://recalls.example.gov/search',
        body: LISTING,
        acquisition_route: 'DIRECT_HTTP',
      }),
      schema,
    );
    expect(records.map((record) => record.raw_payload['model'])).toEqual(['SH-100', 'TX-2', 'ST-9', 'CH-44', 'KT-1']);
  });

  it('returns nothing for a page without repeated content', () => {
    expect(suggestHtmlRecordSelectors('<html><body><h1>Notice</h1><p>One paragraph.</p></body></html>')).toEqual([]);
  });

  it('ignores groups whose members carry no text', () => {
    const html = `<html><body><div class="icons"><i class="x"></i><i class="x"></i><i class="x"></i></div></body></html>`;
    expect(suggestHtmlRecordSelectors(html)).toEqual([]);
  });
});
