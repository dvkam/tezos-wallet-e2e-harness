# Umami desktop diagnostics

This lane diagnoses the released Linux Umami 2.3.8 wallet. It is not a release acceptance baseline. The older local POC completed zero of three full workflows. Failures remain visible here.

Use Linux or WSL with a working graphical display, Node 24.22.1, Python 3 and the Linux libraries listed in the contributor guide. Install the pinned consumer browser with `npx playwright install --with-deps chromium`. The browser install may need elevated system-package permissions.

Run these commands from the repository root:

```sh
npm ci
python3 scripts/umami_artifact.py --acquire
node scripts/umami-artifact.mjs
node scripts/run-adapter.mjs umami --lane stable
```

Use `xvfb-run -a` before the final command on a machine without an interactive display. The runner prints its report directory. It builds the local dApp against the selected package lock, verifies the installed graph and uses a fresh consumer context and fresh Umami user/XDG directories for each of three attempts. Retries are zero. No transfer is submitted.

## What is checked

The public, unfunded account in `fixtures/account.json` is imported through the wallet UI. The workflow rejects permission, grants permission, reloads the dApp, signs the exact fixture bytes, disconnects, re-pairs, rejects a signature and tries to re-pair and sign again. Umami 2.3.8 revokes the connection when its signing dialog is closed. Recovery therefore needs another permission approval.

The independent Node crypto oracle verifies the account and both signatures. It also rejects each signature for a changed payload. Completed public dApp operations must match their expected operation and sequence. Actual response IDs must differ across the two signatures. The public wallet UI does not expose its incoming request ID, so this does not prove internal request-ID correlation.

Missing signing metadata stays a separate contract finding. It does not invalidate a verified signature or turn a run green. Wallet page errors, HTTP failures and DNS failures remain separate from dApp health and workflow completion. Browser cancellation during intentional navigation is recorded separately.

## Evidence and limits

Read `result.json`, `installed-graph.json` and each attempt's `measurement.json`. A command succeeds only when all attempts complete and every reported contract and health check is clean. A partial workflow exits nonzero. Do not use this diagnostic lane as a release gate until the recovery failures are understood.

Open any retained trace with `npx playwright show-trace /absolute/path/to/wallet-trace-0.zip`. Trace segments and screenshots exclude onboarding and every password-entry interval. A failure during an unlock leaves capture disabled. Process and measurement logs redact the generated password and public mnemonic. A final scan checks literal text and ZIP contents; it does not prove that images contain no secret. Review artifacts locally before sharing them.

The consumer browser is the pinned Playwright Chromium. Umami runs its own Electron Chromium and reports that runtime separately. Changing the dApp Beacon version does not change the SDK embedded in the wallet. The pinned Umami source lock resolves `@airgap/beacon-wallet@4.5.0`; this is source provenance, not independent attestation of the archive's bundled JavaScript.

Archive SHA-256 is checked before extraction. Every extracted file is compared with the unchanged archive before and after the run. The runner removes owned profiles and stops only process groups verified against the exact executable and unique profile. Cleanup failures also keep the result non-green.

## Local verification

```sh
npm run build
node --test tests/*.test.ts
python3 -m unittest discover -s scripts -p 'test_umami*.py'
node formal/verify-umami.ts
xvfb-run -a node scripts/verify-umami-cleanup.ts
```

The bounded verifier executes the actual verdict over 128 evidence combinations and checks a deliberately weakened signature-validation mutant. It does not prove desktop, network or cleanup liveness. The cleanup control separately starts the real wallet, kills its worker, runs the ledger fallback and checks an injected ledger-write setup failure.
