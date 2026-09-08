"""Python 3.10+: python examples/hvac_lookup.py MODEL_NUMBER (standard library only)."""
import json
import os
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler


class LookupError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a credential to a redirected destination.


def lookup_equipment(model, env=None):
    env = os.environ if env is None else env
    if not model.strip() or len(model) > 512:
        raise LookupError("Provide a model number up to 512 characters.")
    base = env.get("DATA_FOUNDRY_API_BASE_URL", "")
    parsed = urlsplit(base)
    local = parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
    if (not local and parsed.scheme != "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise LookupError("Configure a verified HTTPS API origin without credentials, a path, or query parameters.")
    mode = env.get("DATA_FOUNDRY_AUTH_MODE", "direct")
    headers = {"Accept": "application/json"}
    if mode == "rapidapi":
        key = env.get("RAPIDAPI_KEY", "")
        if parsed.hostname != env.get("RAPIDAPI_HOST") or not parsed.hostname.endswith(".p.rapidapi.com"):
            raise LookupError("RapidAPI host must match the verified marketplace origin.")
        headers.update({"X-RapidAPI-Key": key, "X-RapidAPI-Host": parsed.hostname})
    elif mode == "direct":
        if parsed.hostname.endswith(".p.rapidapi.com"):
            raise LookupError("Use rapidapi authentication for a marketplace host.")
        key = env.get("DATA_FOUNDRY_API_KEY", "")
        headers["Authorization"] = "Bearer " + key
    else:
        raise LookupError("Choose direct or rapidapi authentication.")
    if not key or "\r" in key or "\n" in key:
        raise LookupError("Configure the key for the selected authentication mode.")
    opener = build_opener(NoRedirect())

    def get(path):
        try:
            with opener.open(Request(base.rstrip("/") + path, headers=headers), timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            hint = " Request or quota limit reached; respect Retry-After." if error.code == 429 else ""
            raise LookupError(f"API request refused (HTTP {error.code}).{hint}") from None

    search = get("/v1/search?" + urlencode({"q": model, "type": "equipment_model", "limit": 100}))
    exact = [hit for hit in search["data"] if hit["matchKind"] == "EXACT_IDENTIFIER"]
    if len(exact) != 1 or search["match"]["exactCount"] != 1:
        raise LookupError("No unique exact model match. Confirm manufacturer, model variant and coverage before requesting specifications.")
    selected = exact[0]
    facts = []
    offset = 0
    while True:
        page = get(f"/v1/entities/{quote(selected['entity']['id'], safe='')}/facts?limit=100&offset={offset}")
        facts.extend(page["data"])
        if not page["page"]["hasMore"]:
            break
        next_offset = page["page"]["offset"] + page["page"]["limit"]
        if next_offset <= offset or next_offset > 10000:
            raise LookupError("Fact pagination exceeded the documented bound.")
        offset = next_offset
    keys = ("property", "value", "valueType", "unit", "factId", "confidence", "rule", "reason", "unresolvedConflict", "editoriallyCorrected", "editorialCorrectionReason", "selectionWarnings", "evidence")
    return {"entity": selected["entity"], "matchKind": selected["matchKind"], "specifications": [{key: fact.get(key) for key in keys} for fact in facts]}


if __name__ == "__main__":
    try:
        output = json.dumps(lookup_equipment(sys.argv[1] if len(sys.argv) > 1 else ""), indent=2)
        for name in ("DATA_FOUNDRY_API_KEY", "RAPIDAPI_KEY"):
            if os.environ.get(name):
                output = output.replace(os.environ[name], "[redacted]")
        print(output)
    except LookupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Lookup could not complete. Check the verified origin and service availability.", file=sys.stderr)
        sys.exit(1)
