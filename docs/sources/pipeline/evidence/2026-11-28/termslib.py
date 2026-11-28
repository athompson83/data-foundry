"""Terms helper for the round 35 (2026-11-28) scout scripts: fetch a terms page with the declared User-Agent and
report whether a quote appears verbatim in its visible text (whitespace normalised). Stdlib only."""
import html, re, urllib.error
from scoutlib import get


def visible(markup):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", markup, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


def check(name, url, quotes, keywords=()):
    """Return {url, http_status, bytes, quotes: {quote: found}, keyword_sentences} for one terms page."""
    try:
        body = get(name, url, timeout=90)
    except urllib.error.HTTPError as e:
        return {"url": url, "http_status": e.code}
    except Exception as e:  # a reset or timeout is recorded, not hidden
        return {"url": url, "error": type(e).__name__}
    text = visible(body.decode("utf-8", "replace"))
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text)]
    hits = [s for s in sentences if any(k.lower() in s.lower() for k in keywords) and 40 <= len(s) <= 400][:6]
    return {"url": url, "http_status": 200, "bytes": len(body),
            "quotes": {q: (re.sub(r"\s+", " ", q) in text) for q in quotes}, "keyword_sentences": hits}
