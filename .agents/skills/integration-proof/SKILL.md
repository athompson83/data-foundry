---
name: integration-proof
description: Use when work crosses application, service, authentication, persistence, or deployment boundaries, or when it is described as integrated, ready, deployed, or released.
---
# Integration Proof
Trace the real runtime path from actual entry point through caller, configuration, transport, callee, persistence, and user/API-visible result as applicable. Adapter existence, test imports, configuration files, and mocks do not prove integration. Classify only the highest evidenced state: **Implemented → Wired → Locally verified → Hosted verified → Released**. If a required boundary is inaccessible, stop at the highest proven state and name the missing proof.
