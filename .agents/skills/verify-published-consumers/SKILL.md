---
name: verify-published-consumers
description: Verify package-graph and Temple lifecycle acceptance when consumer-graph.ts, lifecycle-verdict.ts, or their callers change.
---

# Verify published consumer acceptance

Use Node 24.22.1. Run `npm ci --ignore-scripts`, `npm test` and `npm run verify:publication` from the repository root. A successful bounded check must detect all six broken variants as well as accept the unchanged validators.

The property is that incomplete lifecycle evidence, degraded wallet health, missing signing metadata or an installed graph inconsistent with its lock cannot produce clean qualification. False success would let a release appear tested when it was not.

Read `docs/verification-properties.md` for bounds and exclusions. Covered production functions are `scripts/consumer-graph.ts:validateGraph` and `scripts/lifecycle-verdict.ts:lifecycleVerdict`. The executable verifier is `formal/verify-publication.ts`. Inspect all three when their interfaces change.

The verifier prints SHA-256 values of the covered files and compares them before and after its checks. The committed coverage record is `formal/coverage.json`. Check its source revision and hashes before relying on an earlier result. When covered behavior changes, update the verification domain and mutation controls as needed, confirm that broken variants still fail, then refresh the record. Move the revision forward only after reviewing its correspondence to production code.

An assertion failure against unchanged production code is a finding. Preserve its input and report it. Do not weaken the property to obtain a pass. A failed mutation control means the verification missed a break or its source pattern no longer matches. Inspect the real changed code before updating the control.

Actual process cleanup, browser execution and public services remain outside this bounded check. Run the affected real Temple commands and `npm run verify:runner` when changing `scripts/run-temple.mjs`. Their failures stay visible even if this verification passes.
