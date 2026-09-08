/** Display-only reference. Query parameters have no reviewed public allowlist. */
export function publicArtifactUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash ||
        url.search !== '') return null;
    // Do not strip a query and manufacture a different evidence location.
    // Immutable artifact identity/hash still explains an omitted URL.
    return url.href;
  } catch { return null; }
}

