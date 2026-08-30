import {
  sourceArtifactId,
  sourceId,
  type AcquisitionMethod,
  type SourceArtifact,
} from '@data-foundry/canonical-schema';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { ExtractionArtifact } from '../src/index.js';
import { parseExtractionSchema, type ExtractionSchema } from '../src/index.js';

/**
 * Golden fixtures for the four extractors.
 *
 * Every timestamp, id and hash is fixed. Extraction must be deterministic: the
 * same artifact and the same mapping config must always produce the same
 * records, or golden tests are worthless and reprocessing an artifact silently
 * changes published facts.
 */

const FIXED_SOURCE_ID = sourceId('11111111-1111-4111-8111-111111111111');
const FIXED_RETRIEVED_AT = '2026-01-15T09:30:00Z';
const FIXED_CREATED_AT = '2026-01-15T09:30:05Z';

export function artifactFixture(overrides: {
  readonly id: string;
  readonly mime_type: string;
  readonly url: string;
  readonly body: string | Uint8Array;
  readonly acquisition_route: AcquisitionMethod;
  readonly extractor_version?: string;
}): ExtractionArtifact {
  const artifact: SourceArtifact = {
    id: sourceArtifactId(overrides.id),
    source_id: FIXED_SOURCE_ID,
    url: overrides.url,
    retrieved_at: FIXED_RETRIEVED_AT,
    content_hash: 'a'.repeat(64),
    mime_type: overrides.mime_type,
    r2_uri: `r2://data-foundry-raw/hvac/${overrides.id}`,
    http_status: 200,
    extractor_version: overrides.extractor_version ?? 'fixture@1.0.0',
    policy_snapshot_id: null,
    byte_size: typeof overrides.body === 'string' ? overrides.body.length : overrides.body.length,
    acquisition_provider: 'http',
    acquisition_route: overrides.acquisition_route,
    account_or_product_plan: null,
    acquisition_jurisdiction: null,
    created_at: FIXED_CREATED_AT,
  };
  return { artifact, body: overrides.body };
}

// ---------------------------------------------------------------------------
// JSON — an API feed
// ---------------------------------------------------------------------------

export const JSON_BODY = JSON.stringify(
  {
    meta: { publisher: 'acme-hvac', feed_version: '2026-01' },
    data: {
      models: [
        {
          modelNumber: '24ACC636A003',
          series: 'Infinity 16',
          productType: 'air_conditioner',
          specs: {
            coolingCapacityBtu: 36000,
            seer2: 15.2,
            eer2: 12.5,
            hspf2: null,
            refrigerant: 'R-410A',
            soundLevelDb: 72,
            stageCount: 1,
          },
          electrical: { voltage: '208/230', phase: 1 },
          weightLb: 189.5,
          certifications: [{ type: 'ahri', reference: '202584720' }],
        },
        {
          modelNumber: '24ACC648A003',
          series: 'Infinity 16',
          productType: 'air_conditioner',
          specs: { coolingCapacityBtu: 48000, seer2: 14.8, refrigerant: 'R-410A' },
          electrical: { voltage: '208/230', phase: 1 },
          certifications: [
            { type: 'ahri', reference: '202584721' },
            { type: 'ahri', reference: '202584722' },
          ],
        },
      ],
    },
  },
  null,
  2,
);

export const JSON_SCHEMA: ExtractionSchema = parseExtractionSchema({
  schema_id: 'acme-hvac.models.json',
  format: 'json',
  entity_type: 'equipment_model',
  record: { kind: 'json_pointer', pointer: '/data/models' },
  record_key: { fields: ['model_number'] },
  fields: [
    { field: 'model_number', required: true, locate: { kind: 'json_pointer', pointer: '/modelNumber' } },
    { field: 'series_name', locate: { kind: 'json_pointer', pointer: '/series' } },
    { field: 'product_type', locate: { kind: 'json_pointer', pointer: '/productType' } },
    {
      field: 'cooling_capacity_btu',
      required: true,
      locate: { kind: 'json_pointer', pointer: '/specs/coolingCapacityBtu' },
    },
    { field: 'seer2', locate: { kind: 'json_pointer', pointer: '/specs/seer2' } },
    { field: 'eer2', locate: { kind: 'json_pointer', pointer: '/specs/eer2' } },
    { field: 'refrigerant', locate: { kind: 'json_pointer', pointer: '/specs/refrigerant' } },
    { field: 'sound_level_db', locate: { kind: 'json_pointer', pointer: '/specs/soundLevelDb' } },
    { field: 'stage_count', locate: { kind: 'json_pointer', pointer: '/specs/stageCount' } },
    { field: 'voltage', locate: { kind: 'json_pointer', pointer: '/electrical/voltage' } },
    { field: 'phase', locate: { kind: 'json_pointer', pointer: '/electrical/phase' } },
    { field: 'weight_lb', locate: { kind: 'json_pointer', pointer: '/weightLb' } },
    {
      field: 'ahri_ref',
      locate: { kind: 'json_path', path: ['certifications', '*', 'reference'] },
      on_multiple: 'first',
    },
  ],
});

export const jsonArtifact = (): ExtractionArtifact =>
  artifactFixture({
    id: '22222222-2222-4222-8222-222222222222',
    mime_type: 'application/json',
    url: 'https://api.acme-hvac.example/v1/models',
    body: JSON_BODY,
    acquisition_route: 'VENDOR_API',
    extractor_version: 'json-extractor@1.0.0',
  });

// ---------------------------------------------------------------------------
// CSV — a bulk spec download
// ---------------------------------------------------------------------------

export const CSV_BODY = [
  'Model,Series,Cooling Capacity (BTU/h),SEER2,Refrigerant,Voltage,Weight (lb)',
  '24ACC636A003,Infinity 16,"36,000",15.2,R-410A,208/230,189.5',
  '24ACC648A003,Infinity 16,"48,000",14.8,R-410A,208/230,215',
  ',Infinity 16,"60,000",14.3,R-410A,208/230,240',
  '',
].join('\n');

export const CSV_SCHEMA: ExtractionSchema = parseExtractionSchema({
  schema_id: 'acme-hvac.models.csv',
  format: 'csv',
  entity_type: 'equipment_model',
  record: { kind: 'csv_rows', header: true, skip_empty_lines: true },
  record_key: { fields: ['model_number'] },
  fields: [
    { field: 'model_number', required: true, locate: { kind: 'csv_column', column: 'Model' } },
    { field: 'series_name', locate: { kind: 'csv_column', column: 'Series' } },
    {
      field: 'cooling_capacity_btu',
      required: true,
      locate: { kind: 'csv_column', column: 'Cooling Capacity (BTU/h)' },
    },
    { field: 'seer2', locate: { kind: 'csv_column', column: 'SEER2' } },
    { field: 'refrigerant', locate: { kind: 'csv_column', column: 'Refrigerant' } },
    { field: 'voltage', locate: { kind: 'csv_column', column: 'Voltage' } },
    { field: 'weight_lb', locate: { kind: 'csv_column', column: 'Weight (lb)' } },
    // Deliberately absent from the header: proves a missing column surfaces as
    // UNKNOWN_COLUMN rather than a silently null field.
    { field: 'ahri_ref', locate: { kind: 'csv_column', column: 'AHRI Reference' } },
  ],
});

export const csvArtifact = (): ExtractionArtifact =>
  artifactFixture({
    id: '33333333-3333-4333-8333-333333333333',
    mime_type: 'text/csv',
    url: 'https://acme-hvac.example/downloads/models.csv',
    body: CSV_BODY,
    acquisition_route: 'BULK_FILE',
    extractor_version: 'csv-extractor@1.0.0',
  });

// ---------------------------------------------------------------------------
// HTML — a product page with a spec table and a definition list
// ---------------------------------------------------------------------------

export const HTML_BODY = `<!doctype html>
<html>
  <body>
    <main>
      <article class="product">
        <h1 class="model" data-model="24ACC636A003">24ACC636A003</h1>
        <table class="specs">
          <tbody>
            <tr><th>Cooling Capacity</th><td>36,000 BTU/h</td></tr>
            <tr><th>SEER2</th><td>15.2</td></tr>
            <tr><th>Sound Level</th><td>72 dB</td></tr>
            <tr><th>Weight</th><td>189.5 lb</td></tr>
          </tbody>
        </table>
        <dl class="attributes">
          <dt>Refrigerant</dt><dd>R-410A</dd>
          <dt>Voltage</dt><dd>208/230 V</dd>
          <dt>Series</dt><dd>Infinity 16</dd>
        </dl>
      </article>
      <article class="product">
        <h1 class="model" data-model="24ACC648A003">24ACC648A003</h1>
        <table class="specs">
          <tbody>
            <tr><th>Cooling Capacity</th><td>48,000 BTU/h</td></tr>
            <tr><th>SEER2</th><td>14.8</td></tr>
          </tbody>
        </table>
        <dl class="attributes">
          <dt>Refrigerant</dt><dd>R-410A</dd>
          <dt>Series</dt><dd>Infinity 16</dd>
        </dl>
      </article>
    </main>
  </body>
</html>`;

export const HTML_SCHEMA: ExtractionSchema = parseExtractionSchema({
  schema_id: 'acme-hvac.models.html',
  format: 'html',
  entity_type: 'equipment_model',
  record: { kind: 'css', selector: 'article.product' },
  record_key: { fields: ['model_number'] },
  fields: [
    {
      field: 'model_number',
      required: true,
      locate: { kind: 'css', selector: 'h1.model', attribute: 'data-model' },
    },
    {
      field: 'cooling_capacity_btu',
      required: true,
      locate: { kind: 'html_table_label', label: 'Cooling Capacity' },
    },
    { field: 'seer2', locate: { kind: 'html_table_label', label: 'SEER2' } },
    { field: 'sound_level_db', locate: { kind: 'html_table_label', label: 'Sound Level' } },
    { field: 'weight_lb', locate: { kind: 'html_table_label', label: 'Weight' } },
    { field: 'refrigerant', locate: { kind: 'html_definition_list', term: 'Refrigerant' } },
    { field: 'voltage', locate: { kind: 'html_definition_list', term: 'Voltage' } },
    { field: 'series_name', locate: { kind: 'html_definition_list', term: 'Series' } },
  ],
});

export const htmlArtifact = (): ExtractionArtifact =>
  artifactFixture({
    id: '44444444-4444-4444-8444-444444444444',
    mime_type: 'text/html',
    url: 'https://acme-hvac.example/products/24acc6',
    body: HTML_BODY,
    acquisition_route: 'DIRECT_HTTP',
    extractor_version: 'html-extractor@1.0.0',
  });

// ---------------------------------------------------------------------------
// PDF — a submittal sheet, built at test time so no binary blob is committed
// ---------------------------------------------------------------------------

export const PDF_PAGE_LINES: readonly (readonly string[])[] = [
  [
    'ACME HVAC SUBMITTAL SHEET',
    'Model Number: 24ACC636A003',
    'Cooling Capacity: 36,000 BTU/h',
    'SEER2: 15.2',
    'Refrigerant: R-410A',
    'AHRI Reference: 202584720',
  ],
  [
    'ACME HVAC SUBMITTAL SHEET',
    'Model Number: 24ACC648A003',
    'Cooling Capacity: 48,000 BTU/h',
    'SEER2: 14.8',
    'Refrigerant: R-410A',
    'AHRI Reference: 202584721',
  ],
];

export async function buildPdfBytes(
  pages: readonly (readonly string[])[] = PDF_PAGE_LINES,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = document.addPage([612, 792]);
    page.setFont(font);
    page.setFontSize(12);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 50, y: 720 - index * 20 });
    });
  }
  return document.save();
}

export const PDF_SCHEMA: ExtractionSchema = parseExtractionSchema({
  schema_id: 'acme-hvac.submittal.pdf',
  format: 'pdf',
  entity_type: 'equipment_model',
  record: { kind: 'pdf_pages' },
  record_key: { fields: ['model_number'] },
  fields: [
    { field: 'model_number', required: true, locate: { kind: 'pdf_label', label: 'Model Number' } },
    {
      field: 'cooling_capacity_btu',
      required: true,
      locate: { kind: 'pdf_label', label: 'Cooling Capacity' },
    },
    { field: 'seer2', locate: { kind: 'pdf_label', label: 'SEER2' } },
    { field: 'refrigerant', locate: { kind: 'pdf_label', label: 'Refrigerant' } },
    { field: 'ahri_ref', locate: { kind: 'pdf_label', label: 'AHRI Reference' } },
    {
      field: 'nominal_tonnage',
      locate: { kind: 'pdf_regex', pattern: '([0-9.]+)\\s*(?:ton|tons)\\b', flags: 'i' },
    },
  ],
});

export const pdfArtifact = async (): Promise<ExtractionArtifact> =>
  artifactFixture({
    id: '55555555-5555-4555-8555-555555555555',
    mime_type: 'application/pdf',
    url: 'https://acme-hvac.example/docs/24acc6-submittal.pdf',
    body: await buildPdfBytes(),
    acquisition_route: 'DIRECT_HTTP',
    extractor_version: 'pdf-extractor@1.0.0',
  });
