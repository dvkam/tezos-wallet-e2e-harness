---
name: verify-adapter-publication
description: Check Kukai evidence acceptance and interrupted adapter-run publication when changing the adapter runner, validator or evidence capture.
---

# Verify adapter publication

Read docs/kukai.md and docs/adapter-verification.md. Use Node 24.22.1. Run npm test, npm run build, npm run verify:adapters and npm run verify:publication. The adapter check must accept unchanged production code and expose all five broken variants. Do not weaken the properties to accept a failed diagnostic run.

The covered functions are scripts/kukai-verdict.ts:kukaiVerdict and scripts/adapter-publication.mjs:publishAdapterResult. The finite validator domain has 64 combinations of duplicate attempts, invalid signatures, incomplete steps, wrong signing metadata, wallet errors and skipped tests. Six additional cases execute the production publisher. A removed interruption guard must publish a false clean result in the mutation control.

formal/AdapterPublication.tla models workflow validation, artifact verification, asynchronous cleanup, signal arrival and synchronous publication. Run both TLC configurations with a pinned Java and TLC installation. The correct model must satisfy both invariants; the mutant must produce a counterexample. Record exact tool hashes and model source hashes. This model has four independent Boolean inputs. It does not model browser internals, service availability or arbitrary operating-system scheduling.

Run npm run verify:adapter-runner against a prepared Kukai artifact. It exercises actual artifact setup failure and interruption during installation, checks owned workspace/profile removal, and preserves unrelated files and the checkout lock. The process-cleanup regression uses the real cleanup function and two live process groups. These controls do not prove cleanup under SIGKILL of the top-level runner.

The executable checker hashes covered sources before and after validation. Compare its hashes to formal/adapter-coverage.json and the recorded source revision before relying on old results. After behavior changes, review source/model correspondence, update bounds and broken variants as needed, then refresh the record. An unchanged-source failure is a finding; retain it.

After reviewing changes to the driver or runner, run three fresh Kukai attempts with zero retries. Keep every earlier failed batch. A successful protocol workflow with wallet or dApp findings must still exit nonzero. Do not replace the wallet's embedded SDK or remove failing endpoints to produce a green report.
