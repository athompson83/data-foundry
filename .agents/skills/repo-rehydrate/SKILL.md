---
name: repo-rehydrate
description: Use when starting a new session, task, worktree, context reset, or when recorded repository state may be stale.
---
# Repository Rehydrate
Read the startup files required by `AGENTS.md`, then reconcile them against current Git/PR/runtime evidence relevant to the task. Treat handoff prose as a lead, not proof. Build a compact state with objective, candidate revision, verified facts and scope, unknowns, constraints, and next smallest valid action. Stop loading history once you can act safely; do not bulk-read unrelated issues, deployments, or services.
