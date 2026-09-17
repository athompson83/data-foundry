#!/usr/bin/env python3
# VALIDATION PROTOTYPE -- not product code, not wired to anything.
# Reproduces the Phase 2 determinism measurements in
# docs/commercial-validation/tariff-api-validation-20260917.md
# Inputs: USITC reststop exportList JSON dumps in /tmp/hts/ch_*.json
"""Deterministic duty-component prototype. Validation only -- not product code.

Rules, in order of strictness:
  * A rate is emitted ONLY when it parses unambiguously.
  * Prose that cannot be represented deterministically yields an UNRESOLVED
    component carrying the source text -- never a guessed number.
  * Every component carries its source locator, the raw text and the rule id.
"""
import json, glob, re, os
from collections import Counter

def load():
    rows = []
    for f in sorted(glob.glob('/tmp/hts/ch_*.json')):
        for r in json.load(open(f)):
            r['_src'] = os.path.basename(f)
            rows.append(r)
    return rows

# ---- rate grammar -----------------------------------------------------------
RE_FREE     = re.compile(r'^\s*free\s*$', re.I)
RE_ADVAL    = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*%\s*$')
RE_SPECIFIC = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*(¢|cents?|\$)\s*(?:/|\s+per\s+|\s+)([\w ]+?)\s*$', re.I)
RE_COMPOUND = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*(¢|cents?|\$)\s*/\s*(\w+)\s*\+\s*(\d+(?:\.\d+)?)\s*%\s*$', re.I)
# Ch.99 additive form: "The duty provided in the applicable subheading plus 25%"
# The source uses BOTH "plus 25%" and "+ 25%" for the same rule.
RE_CH99_ADD = re.compile(r'duty provided in the applicable subheading(?:s)?\s*(?:\+|plus)\s*(\d+(?:\.\d+)?)\s*%', re.I)
# Bare pass-through: names the base subheading and adds nothing.
RE_CH99_PASS = re.compile(r'^\s*the duty provided in the applicable subheading(?:s)?\s*$', re.I)
RE_NO_CHANGE= re.compile(r'^\s*no change\s*$', re.I)

def parse_rate(text, locator, rule_ctx):
    """Return a component dict. kind is never invented."""
    t = (text or '').strip()
    if t == '':
        return {'kind': 'INHERIT', 'rule': 'empty-rate-inherits-from-parent',
                'source_text': '', 'locator': locator}
    if RE_FREE.match(t):
        return {'kind': 'AD_VALOREM', 'percent': 0.0, 'rule': 'free',
                'source_text': t, 'locator': locator}
    m = RE_COMPOUND.match(t)
    if m:
        return {'kind': 'COMPOUND', 'specific': float(m.group(1)), 'unit_symbol': m.group(2),
                'per': m.group(4 - 1), 'percent': float(m.group(4)),
                'rule': 'compound-specific-plus-advalorem', 'source_text': t, 'locator': locator}
    m = RE_ADVAL.match(t)
    if m:
        return {'kind': 'AD_VALOREM', 'percent': float(m.group(1)), 'rule': 'plain-ad-valorem',
                'source_text': t, 'locator': locator}
    m = RE_SPECIFIC.match(t)
    if m:
        return {'kind': 'SPECIFIC', 'amount': float(m.group(1)), 'unit_symbol': m.group(2),
                'per': m.group(3), 'rule': 'specific-rate', 'source_text': t, 'locator': locator}
    if rule_ctx == 'ch99':
        if RE_NO_CHANGE.match(t):
            return {'kind': 'NO_ADDITIONAL_DUTY', 'rule': 'ch99-no-change',
                    'source_text': t, 'locator': locator}
        if RE_CH99_PASS.match(t):
            return {'kind': 'NO_ADDITIONAL_DUTY', 'rule': 'ch99-passthrough-no-delta',
                    'source_text': t, 'locator': locator}
        m = RE_CH99_ADD.search(t)
        if m:
            return {'kind': 'ADDITIVE_AD_VALOREM', 'percent': float(m.group(1)),
                    'rule': 'ch99-applicable-subheading-plus-pct',
                    'source_text': t, 'locator': locator}
    return {'kind': 'UNRESOLVED', 'rule': 'no-deterministic-grammar-matched',
            'source_text': t, 'locator': locator}

def build_hierarchy(rows):
    """Resolve indentation. A line's effective base rate is its own, else the
    nearest ancestor (lower indent) that has one."""
    stack = {}
    out = []
    for i, r in enumerate(rows):
        try:
            ind = int(r.get('indent') or 0)
        except (TypeError, ValueError):
            ind = 0
        for k in [k for k in stack if k >= ind]:
            del stack[k]
        stack[ind] = r
        own = (r.get('general') or '').strip()
        inherited_from = None
        if own == '':
            for a in sorted([k for k in stack if k < ind], reverse=True):
                cand = (stack[a].get('general') or '').strip()
                if cand != '':
                    own = cand
                    inherited_from = stack[a].get('htsno') or f'(indent {a})'
                    break
        out.append((r, own, inherited_from, ind))
    return out

def normalize_additional_duties(r):
    """The source ships BOTH spellings. Keep provenance for whichever appeared."""
    got = {}
    for key in ('additionalDuties', 'addiitionalDuties'):
        if key in r and r.get(key) not in (None, ''):
            got[key] = r.get(key)
    if not got:
        return None
    return {'value': list(got.values())[0], 'source_field': list(got.keys())[0],
            'both_present': len(got) > 1}
