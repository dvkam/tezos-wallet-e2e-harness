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

Read `result.json`, `installed-graph.json` and each attempt's `measurement.json`. Each health finding records `atMs`, the milliseconds since the attempt started, plus the workflow `stage` and the wallet `action` that was running. Between wallet interactions `action` is `null`. The measurement's own `stage` and `action` give the position where the attempt ended, and a failed wallet interaction stays as that action. A failed attempt tries to save `wallet-failure.png` and `consumer-failure.png`. It skips them when the failure happens before tracing starts, which covers wallet startup, consumer startup and onboarding, or inside a password-entry interval. A screenshot that fails to save is not reported. A command succeeds only when all attempts complete and every reported contract and health check is clean. A partial workflow exits nonzero. Do not use this diagnostic lane as a release gate while the two wallet errors described below remain.

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

The bounded verifier executes the actual verdict over 256 evidence combinations and checks a deliberately weakened signature-validation mutant. It does not prove desktop, network or cleanup liveness. The cleanup control separately starts the real wallet, kills its worker, runs the ledger fallback and checks an injected ledger-write setup failure.

## Recorded diagnostic

The local stable run at harness commit `734357b203d2473e96a1194be884d7c4892c5e7f` completed zero of three full workflows with zero retries. All attempts verified the first exact signature. Two reached eight of nine steps and failed while waiting for permission recovery after signing rejection. The third reached seven steps and failed during signing rejection, where the rejected sign request stayed `pending` for 45 seconds until the driver's wait ended. The fourth run below shows the same symptom on a permission rejection. Its cause is unknown. The wallet reported `No matching request found!` and an undefined `type` error. DApp health was clean; wallet health was degraded. Retired relay and RPC DNS failures and TzKT HTTP errors remain in the reports.

That run used wallet Electron Chromium `130.0.6723.137` and consumer Chromium `156.0.8078.4`. Every attempt passed its literal evidence scan and owned cleanup. No profile or Umami process remained.

A second stable run at harness commit `e7e7a75904d2f10850cda594b35fdd20b3d338f3` also completed zero of three workflows with zero retries. All three attempts reached eight of nine steps and failed at stage `recovery-after-signing-rejection`, action `permission-popup`. The dApp published a new pairing, the deep link was handed over, and no permission dialog appeared within 90 seconds. Each attempt kept both failure screenshots.

The timed findings place the wallet's request errors before the failing stage. `No matching request found!` occurred once during the first permission approval and once during re-pairing after disconnect. The undefined `type` error occurred during disconnect. All three belong to stages that completed, and none occurred during signing rejection or the failed recovery. They are therefore not sufficient to explain the stall.

The failure screenshots of that run show the cause. All three consumer screenshots show the dApp's `rate limit reached` error. The Beacon dApp SDK rejects a third request within five seconds, and it checks this after pairing has finished. The driver sent re-pairing, signing and re-pairing inside that window. The last permission request never left the dApp, and the driver waited 90 seconds for a wallet dialog. The first run has no screenshot, so the same cause is likely there and not shown.

The driver now spaces requests below that limit and stops waiting once the dApp reports that a request ended. `e2e/umami/pacing.ts` names the SDK's limit of two requests in five seconds and has unit tests. A third stable run at harness commit `57ef4730be92faafef52f76c8129cd5649170f04` completed all nine steps in each of three attempts, in about 40 seconds each, with both signatures verified and `micheline` signing metadata. The command still exits nonzero. Each attempt fails the final check that wallet request errors are fatal: `No matching request found!` after every permission approval and the undefined `type` error on disconnect.

A fourth stable run at harness commit `37fbdcd`, after the review fixes, completed all nine steps in two of three attempts. Both ended at stage `final-checks` with no action and failed only on the two wallet errors. The other attempt failed at stage `permission-rejection`, action `permission-popup`. Umami showed the permission dialog and closed it when the driver clicked Close, but the dApp's request stayed `pending` for 45 seconds. In that attempt's wallet trace, the Close came about 1.8 seconds before the wallet's first Matrix message in the pairing room. In the completed attempts the wallet had sent three messages in that room before the Close. This timing difference is the only one found so far, and it does not establish the cause.

The first error has a source-level explanation at the pinned Umami commit. `PermissionRequestModal` closes the dialog with `.finally(onClose)` after a grant. The `onClose` from `useHandleBeaconMessage` then answers the same request with `NOT_GRANTED_ERROR`. Beacon has already removed the request and throws. The throw also skips the `removePeer` call that follows it.

The second error comes from the Beacon wallet client bundled in Umami. `@airgap/beacon-wallet` 4.5.0 treats every message labelled version 3 as an envelope and reads `message.message.type`. The dApp sends its disconnect as a flat message labelled with the peer's version, `'3'`, and with no `message` field. The read throws and the wallet skips the disconnect.

Both errors now have upstream reports:

- [trilitech/umami-v2#2534](https://github.com/trilitech/umami-v2/pull/2534) closes the permission modal with `goBack` instead of `onClose`. It is a draft.
- [ecadlabs/beacon-sdk-taquito-patches#234](https://github.com/ecadlabs/beacon-sdk-taquito-patches/pull/234) labels the flat disconnect `'2'`, which the airgap wallet reads through its flat branch. The maintainers merged it on 2026-11-16, after `4.9.0-ecad-beta.3`, so no pinned lane contains it yet. Against Kukai, which bundles airgap Beacon 4.8.0, the wallet's disconnect error appeared in three of three attempts with a build of that branch with the one-line change reverted, and in none of three with the change (`292bb7c8`). These runs used harness commit `c2190d9` on the candidate lane, with a local hook that replaced the installed `@ecadlabs` dist folders with the two builds. They skipped the strict type check, because the newer types make `account.network` optional. The reports `kukai-lifecycle-QBayhD` and `kukai-lifecycle-xpyLyh` are kept locally. The harness has not run the change against Umami.
- [trilitech/octez.connect#65](https://github.com/trilitech/octez.connect/issues/65) reports the same read in the octez.connect wallet client.

Until a lane pins a dApp release with that change, the Umami lane keeps reporting the disconnect error.

Each desktop run above is evidence for its recorded harness commit, not for lines added after it.

The local source-lock provenance is available in [Umami's pinned source lock](https://github.com/trilitech/umami-v2/blob/771e1d34ac714899a0056079f5d0e764bce427ef/pnpm-lock.yaml).
