---
name: test-impact
description: Use before selecting verification for a change, especially when deciding whether focused checks are sufficient or broader checks are required.
---
# Test Impact
Map changed files/symbols to callers and affected boundaries. Start with the cheapest check that can falsify intended behavior, then broaden for shared code, contracts, schema/persistence, auth/tenancy, security, dependencies, deployment, or release behavior. Classify skipped, unavailable, and not-applicable checks explicitly; never convert missing required evidence into success. Record the exact checks and results supporting completion claims.
