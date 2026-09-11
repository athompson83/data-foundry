# Agentic Engineering Harness

This repository uses a lean evidence-gated harness for Codex and Claude Code. It supplements, and does not replace, `AGENTS.md`, `APP_PROJECT_CONTROL_STANDARD.md`, `PROJECT_CHECKLIST.md`, `PROGRESS.md`, repository-specific release controls, or current Product Owner instructions.

## Operating model
1. Rehydrate only enough context to act correctly.
2. Locate symbols/files before reading broad sections of the repository.
3. Implement the smallest acceptance-bearing increment.
4. Run the cheapest check capable of falsifying the change, then broaden based on impact.
5. Prove actual runtime wiring for cross-boundary work.
6. Record evidence-backed state once near a meaningful checkpoint or handoff.

## Evidence states
Never collapse **Implemented → Wired → Locally verified → Hosted verified → Released**. A lower state must never be described as a higher one; mocks prove only the mocked contract unless acceptance explicitly calls for a mock.

## Context economy
Use task-specific symbol/path search and bounded reads before broad scans. Do not reread evidence unless it may be stale. Summarize repetitive successful output while preserving exit status, failures, warnings, skips, security findings, and a route to raw evidence. Retrieve external docs only when material and version-align them when practical. Avoid default subagent fan-out; parallelize only genuinely independent work.

## Durable shared memory
Git-tracked state is authoritative across agents and machines; native model memory is supplementary. Use `PROGRESS.md`, `PROJECT_CHECKLIST.md`, and existing decision/lesson locations rather than competing status documents. Material claims should carry scope, evidence, and invalidation conditions. Mark contradictions stale or superseded. Never store secrets, production customer data, or transcript dumps as memory.

## Verification economy
Choose checks by impact. Start focused, then broaden for shared contracts, schema/persistence, auth/tenant/security, dependencies/toolchain, and integration/release boundaries. Skipped or unavailable required evidence is **unverified**, not passed. Do not use hosted CI as the first debugger when a deterministic local check can answer the question, and do not rerun failed CI without a diagnosed transient reason.

## Authority and containment
Instructions are not security controls. Continue to rely on repository/platform permissions, sandboxing, protected credentials, branch/release gates, and target-specific migration/deployment authority. Repository write authority does not imply authority to create new infrastructure, expose secrets, weaken security controls, or perform irreversible Production actions outside the standing control standard.

## Progressive skills
Canonical procedures live under `.agents/skills/` with Claude discovery shims under `.claude/skills/`: `repo-rehydrate`, `context-economy`, `memory-curator`, `test-impact`, and `integration-proof`. Load a skill only when its trigger applies.
