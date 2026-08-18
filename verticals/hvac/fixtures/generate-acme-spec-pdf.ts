/**
 * Generates `acme-spec.pdf` — the PDF fixture for the `acme-spec-sheets` source.
 *
 * SYNTHETIC TEST DATA. Acme Climate Systems is a fictional company invented for
 * this factory proof. This script authors an original document; it does not
 * copy, download or derive from any real manufacturer's spec sheet, and it
 * makes no network calls. See verticals/hvac/RIGHTS.md.
 *
 * WHY A SCRIPT AND A COMMITTED OUTPUT
 * A PDF cannot be reviewed in a diff, so the script is the reviewable artifact:
 * it states exactly what the fixture claims. The committed `acme-spec.pdf` is
 * what the test suite reads, so tests need no build step and no pdf-lib at
 * runtime. Both are committed on purpose — regenerating must be possible, but
 * running the tests must not require it.
 *
 * The values below are the source of truth for the PDF's contribution to
 * fixtures/golden/. Two of them are load-bearing:
 *
 *   - Capacity appears BOTH as tons and as BTU/h ("36,000"), so the
 *     12000 BTU/h = 1 ton conversion is validated against a published pair
 *     rather than assumed.
 *   - 24ACC648A003 is published at 72 dB here and listed at 69 dB by
 *     coolsupply-distributor. That conflict is deliberate: the spec sheet wins
 *     on authority (90 vs 45) and the distributor's claim is retained, not
 *     discarded.
 *
 * Numbers are written the way a real sheet writes them — thousands separators,
 * unit suffixes, a combined electrical notation — so extraction and Layer 1/2
 * normalization are genuinely exercised.
 *
 * Regenerate:
 *   npx tsx verticals/hvac/fixtures/generate-acme-spec-pdf.ts
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, 'acme-spec.pdf');

interface SpecSheet {
  readonly model: string;
  readonly series: string;
  readonly productType: string;
  readonly nominalTons: string;
  readonly coolingCapacity: string;
  readonly refrigerant: string;
  readonly electrical: string;
  readonly stages: string;
  readonly soundLevel: string;
  readonly netWeight: string;
}

/** One page per model, matching how spec sheets are actually published. */
const SHEETS: readonly SpecSheet[] = [
  {
    model: '24ACC636A003',
    series: 'Comfort 16',
    productType: 'Split System Air Conditioner',
    nominalTons: '3.0 Tons',
    coolingCapacity: '36,000 BTU/h',
    refrigerant: 'R-454B',
    electrical: '208/230-1-60',
    stages: '1',
    soundLevel: '72 dB',
    netWeight: '187 lb',
  },
  {
    model: '24ACC648A003',
    series: 'Comfort 16',
    productType: 'Split System Air Conditioner',
    nominalTons: '4.0 Tons',
    coolingCapacity: '48,000 BTU/h',
    refrigerant: 'R-454B',
    electrical: '208/230-1-60',
    stages: '1',
    // Deliberate conflict with coolsupply-distributor's 69 dB listing.
    soundLevel: '72 dB',
    netWeight: '205 lb',
  },
  {
    model: '24ACC660A003',
    series: 'Comfort 16',
    productType: 'Split System Air Conditioner',
    nominalTons: '5.0 Tons',
    coolingCapacity: '60,000 BTU/h',
    refrigerant: 'R-454B',
    electrical: '208/230-1-60',
    stages: '2',
    soundLevel: '74 dB',
    netWeight: '232 lb',
  },
];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const LABEL_X = MARGIN;
const VALUE_X = MARGIN + 210;

async function main(): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Acme Climate Systems — Product Specifications (SYNTHETIC TEST DATA)');
  pdf.setAuthor('Acme Climate Systems (fictional publisher; synthetic test data)');
  pdf.setSubject('Outdoor unit specifications');
  pdf.setProducer('Data Foundry fixture generator');
  pdf.setCreationDate(new Date('2026-07-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-07-01T00:00:00Z'));

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.44, 0.48);
  const rule = rgb(0.78, 0.8, 0.84);

  for (const sheet of SHEETS) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    page.drawText('ACME CLIMATE SYSTEMS', { x: MARGIN, y, size: 16, font: bold, color: ink });
    y -= 18;
    page.drawText('Product Specification Sheet', { x: MARGIN, y, size: 11, font: body, color: muted });

    y -= 14;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1,
      color: rule,
    });

    y -= 34;
    page.drawText(sheet.model, { x: MARGIN, y, size: 22, font: bold, color: ink });
    y -= 18;
    page.drawText(`${sheet.series} — ${sheet.productType}`, {
      x: MARGIN,
      y,
      size: 11,
      font: body,
      color: muted,
    });

    y -= 36;
    page.drawText('PERFORMANCE', { x: MARGIN, y, size: 10, font: bold, color: muted });
    y -= 20;

    const rows: readonly (readonly [string, string])[] = [
      ['Nominal Capacity', sheet.nominalTons],
      ['Cooling Capacity', sheet.coolingCapacity],
      ['Refrigerant', sheet.refrigerant],
      ['Electrical (V-Ph-Hz)', sheet.electrical],
      ['Compressor Stages', sheet.stages],
      ['Sound Level', sheet.soundLevel],
      ['Net Weight', sheet.netWeight],
    ];

    for (const [label, value] of rows) {
      page.drawText(label, { x: LABEL_X, y, size: 11, font: body, color: muted });
      page.drawText(value, { x: VALUE_X, y, size: 11, font: bold, color: ink });
      y -= 22;
    }

    y -= 20;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.5,
      color: rule,
    });
    y -= 18;
    page.drawText(
      'Certified ratings are published by the ratings directory and may differ from',
      { x: MARGIN, y, size: 8.5, font: body, color: muted },
    );
    y -= 12;
    page.drawText('nominal values shown here.', {
      x: MARGIN,
      y,
      size: 8.5,
      font: body,
      color: muted,
    });

    page.drawText(
      'SYNTHETIC TEST DATA — fictional publisher, generated fixture, not a real document.',
      { x: MARGIN, y: MARGIN - 18, size: 7.5, font: body, color: muted },
    );
  }

  await writeFile(OUTPUT, await pdf.save());
  console.log(`Wrote ${OUTPUT} (${SHEETS.length} pages)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
