import { MAX_FACET_FILTERS, MAX_FACET_FILTER_VALUES, type FacetFilter, type FieldMetadataRegistry } from '@data-foundry/query-model';

export const SEARCH_PAGE_SIZE = 50;
export class SearchInputError extends Error {}
export function parseSearchForm(params: URLSearchParams, fields: FieldMetadataRegistry, entityTypes: readonly string[]) {
  const q = (params.get('q') ?? '').trim();
  const type = params.get('type') ?? '';
  const pageValue = params.get('page') ?? '1';
  if (q.length > 512 || (type !== '' && !entityTypes.includes(type)) || !/^[1-9][0-9]*$/.test(pageValue) || Number(pageValue) > 201) throw new SearchInputError('Check the search text, type and page number.');
  const filters: FacetFilter[] = [];
  const properties = new Set<string>();
  for (const key of params.keys()) {
    const match = /^(filter|min|max)\.(.+)$/.exec(key);
    if (match === null) continue;
    const property = match[2]!;
    const field = fields.get(property);
    if (field === null || field.filter === null || field.filter.type === 'none') throw new SearchInputError('Choose a declared search filter.');
    if (params.getAll(key).some((value) => value.trim() !== '')) properties.add(property);
    if (match[1] === 'filter' && field.filter.type === 'range') throw new SearchInputError('Use minimum and maximum for range filters.');
    if (match[1] !== 'filter' && field.filter.type !== 'range') throw new SearchInputError('This filter does not accept a range.');
  }
  if (properties.size > MAX_FACET_FILTERS) throw new SearchInputError('Too many filters.');
  for (const property of properties) {
    const field = fields.get(property)!;
    if (field.filter?.type === 'range') {
      const min = params.get(`min.${property}`) || null;
      const max = params.get(`max.${property}`) || null;
      if ((min !== null && !Number.isFinite(Number(min))) || (max !== null && !Number.isFinite(Number(max))) || (min !== null && max !== null && Number(min) > Number(max))) throw new SearchInputError('Enter a valid minimum and maximum.');
      if (min !== null || max !== null) filters.push({ property, op: 'range', min: min === null ? null : Number(min), max: max === null ? null : Number(max) });
    } else {
      const raw = params.getAll(`filter.${property}`).filter((value) => value !== '');
      if (raw.length > MAX_FACET_FILTER_VALUES || raw.some((value) => value.length > 200)) throw new SearchInputError('Too many filter values or a value is too long.');
      const values = raw.map((value) => {
        if (field.value_type === 'boolean') {
          if (value !== 'true' && value !== 'false') throw new SearchInputError('Choose true or false.');
          return value === 'true';
        }
        if (['number', 'integer', 'quantity'].includes(field.value_type)) {
          if (!Number.isFinite(Number(value))) throw new SearchInputError('Enter a numeric filter value.');
          return Number(value);
        }
        return value;
      });
      if (values.length > 0) filters.push({ property, op: 'in', values });
    }
  }
  return { q, type, page: Number(pageValue), filters };
}
