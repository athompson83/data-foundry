# Equipment lookup examples

These examples call the published REST contract: search by model, require one exact identifier match, page through selected specifications, and retain selected-claim evidence. They do not infer equipment compatibility or turn missing values into zero. The search response exactCount verifies uniqueness even when additional fuzzy results are paginated. Zero or multiple exact matches stop the run for scope confirmation.

Supply credentials through your environment or secret manager; never put them in the command, source file or support transcript. Both clients refuse redirects and never print request headers, keys, error bodies or raw network exceptions. HTTPS is required except a loopback fixture server for local validation.

For direct access, set `DATA_FOUNDRY_API_BASE_URL` to your verified API **origin**, `DATA_FOUNDRY_AUTH_MODE=direct`, and `DATA_FOUNDRY_API_KEY`. For marketplace access, use `DATA_FOUNDRY_AUTH_MODE=rapidapi`, your subscribed `https://…p.rapidapi.com` origin, `RAPIDAPI_HOST` matching that hostname, and `RAPIDAPI_KEY`. A website origin is not an API origin. There is no configured live listing in this candidate.

```sh
# Credentials are already provided through the environment.
node examples/hvac-lookup.ts YOUR_MODEL_NUMBER
python examples/hvac_lookup.py YOUR_MODEL_NUMBER
```

TypeScript requires Node 22.18+ with built-in type stripping, or the repository's `pnpm exec tsx examples/hvac-lookup.ts YOUR_MODEL_NUMBER`. Python requires 3.10+ and only its standard library.

Output includes entity scope, specifications, units, conflict/correction state and evidence with immutable artifact ID/hash, source URL, locator and capture/observation timestamps. `sourceValue` can be null when quoting is not granted. URLs containing credentials, fragments or any query parameters are suppressed as null; the immutable artifact ID/hash remains available. Evidence is additive: an older API may omit it, which the examples represent as null; a null value is not provenance proof. Each fact request counts toward your request allowance. A 429 stops rather than silently consuming retries; inspect the response's Retry-After securely in your application. A 401/403 is an authentication or access issue, not missing data.
