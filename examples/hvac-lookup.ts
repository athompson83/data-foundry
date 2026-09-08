/** Run with Node 22.18+ (type stripping): node examples/hvac-lookup.ts MODEL_NUMBER */
import { pathToFileURL } from 'node:url';

type Entity = { id: string; canonicalName: string; entityType: string };
type Hit = { entity: Entity; matchKind: string };
type Page<T> = { data: T[]; page: { limit: number; offset: number; total: number; hasMore: boolean } };
type Fact = { property: string; value: unknown; valueType: string | null; unit: string | null; factId: string;
  confidence: number | null; rule: string; reason: string; unresolvedConflict: boolean;
  editoriallyCorrected: boolean; editorialCorrectionReason: string | null; selectionWarnings: string[]; evidence?: unknown };
class LookupError extends Error {}

export async function lookupEquipment(model: string, env: NodeJS.ProcessEnv = process.env) {
  if (!model.trim() || model.length > 512) throw new LookupError('Provide a model number up to 512 characters.');
  let base: URL;
  try { base = new URL(env.DATA_FOUNDRY_API_BASE_URL ?? ''); } catch { throw new LookupError('Configure the verified API origin in DATA_FOUNDRY_API_BASE_URL.'); }
  const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
  if ((!local && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new LookupError('Use an HTTPS API origin without credentials, a path, or query parameters.');
  const mode = env.DATA_FOUNDRY_AUTH_MODE ?? 'direct';
  const headers: Record<string, string> = { accept: 'application/json' };
  let key: string;
  if (mode === 'rapidapi') {
    key = env.RAPIDAPI_KEY ?? '';
    if (base.hostname !== env.RAPIDAPI_HOST || !base.hostname.endsWith('.p.rapidapi.com')) throw new LookupError('RapidAPI host must match the verified marketplace origin.');
    headers['x-rapidapi-key'] = key;
    headers['x-rapidapi-host'] = base.hostname;
  } else if (mode === 'direct') {
    if (base.hostname.endsWith('.p.rapidapi.com')) throw new LookupError('Use rapidapi authentication for a marketplace host.');
    key = env.DATA_FOUNDRY_API_KEY ?? '';
    headers.authorization = `Bearer ${key}`;
  } else throw new LookupError('Choose direct or rapidapi authentication.');
  if (!key || /[\r\n]/.test(key)) throw new LookupError('Configure the key for the selected authentication mode.');

  async function get<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const hint = response.status === 429 ? ' Request or quota limit reached; respect Retry-After.' : '';
      // Error bodies and headers can contain sensitive input. Never echo them.
      throw new LookupError(`API request refused (HTTP ${response.status}).${hint}`);
    }
    return response.json() as Promise<T>;
  }
  const query = new URLSearchParams({ q: model, type: 'equipment_model', limit: '100' });
  const search = await get<Page<Hit> & { match: { exactCount: number } }>(`/v1/search?${query}`);
  const exact = search.data.filter((hit) => hit.matchKind === 'EXACT_IDENTIFIER');
  if (exact.length !== 1 || search.match.exactCount !== 1) throw new LookupError('No unique exact model match. Confirm manufacturer, model variant and coverage before requesting specifications.');
  const selected = exact[0]!;
  const facts: Fact[] = [];
  let offset = 0;
  for (;;) {
    const page = await get<Page<Fact>>(`/v1/entities/${encodeURIComponent(selected.entity.id)}/facts?limit=100&offset=${offset}`);
    facts.push(...page.data);
    if (!page.page.hasMore) break;
    const next = page.page.offset + page.page.limit;
    if (next <= offset || next > 10_000) throw new LookupError('Fact pagination exceeded the documented bound.');
    offset = next;
  }
  // Missing facts stay absent; never coerce them to zero or infer compatibility.
  return { entity: selected.entity, matchKind: selected.matchKind, specifications: facts.map((fact) => ({
    property: fact.property, value: fact.value, valueType: fact.valueType, unit: fact.unit,
    factId: fact.factId, confidence: fact.confidence, rule: fact.rule, reason: fact.reason,
    unresolvedConflict: fact.unresolvedConflict, editoriallyCorrected: fact.editoriallyCorrected,
    editorialCorrectionReason: fact.editorialCorrectionReason, selectionWarnings: fact.selectionWarnings, evidence: fact.evidence ?? null,
  })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await lookupEquipment(process.argv[2] ?? '');
    let output = JSON.stringify(result, null, 2);
    for (const key of [process.env.DATA_FOUNDRY_API_KEY, process.env.RAPIDAPI_KEY]) if (key) output = output.replaceAll(key, '[redacted]');
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof LookupError ? error.message : 'Lookup could not complete. Check the verified origin and service availability.'}\n`);
    process.exitCode = 1;
  }
}
