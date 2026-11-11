# Compare published packages with Temple

This suite runs the same public wallet workflows against two complete Beacon and Taquito installations. It keeps the small dApp on localhost. No deployed dApp, funded account or public-chain operation is needed.

## Package selections

| Lane | Beacon packages | Taquito and Beacon wallet |
| --- | --- | --- |
| `stable` | `4.8.5-ecad` | `25.1.1` |
| `candidate` | `4.9.0-ecad-beta.0` | `25.2.0-beta1` |
| `historical` | `4.8.4-ecad` | `25.1.0` |

Each directory under `consumers/` contains its manifest and npm lockfile. Commands default to stable. Tags such as latest and beta are not resolved during a run. The historical lock preserves the older dependency graph and disconnect reproducer. Its workflow failures remain failures.

The comparison changes both Beacon and Taquito. It establishes the behavior of those integrations, not which individual package caused a difference. The candidate includes [Beacon's Matrix disconnect fix](https://github.com/ecadlabs/beacon-sdk-taquito-patches/pull/119).

## Setup

Use a Linux or WSL checkout with Node `24.22.1`, npm, Python 3, Xvfb and Chromium's system libraries. Start Docker in that environment for the network and transfer commands. The README lists the pinned Tezbox image.

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run wallet:acquire
npm run wallet:verify
docker info
```

Use the same verified Temple artifact and browser for both lanes. Do not fund the public fixture account on any public chain.

## Run the comparison

Run these commands sequentially. Lifecycle performs three fresh-profile attempts. Each network or transfer command performs one attempt, with zero retries and a fresh Tezbox chain.

```sh
xvfb-run -a npm run temple:lifecycle -- --lane stable
xvfb-run -a npm run temple:network -- --lane stable
xvfb-run -a npm run temple:transfer -- --lane stable

xvfb-run -a npm run temple:lifecycle -- --lane candidate
xvfb-run -a npm run temple:network -- --lane candidate
xvfb-run -a npm run temple:transfer -- --lane candidate
```

A nonzero command does not prevent manually running the next diagnostic command. Preserve its report. Do not add shell retries or change assertions to obtain a pass.

To reproduce the older disconnect behavior separately:

```sh
xvfb-run -a npm run temple:lifecycle -- --lane historical
```

The root package lock remains the development and bootstrap installation. The runner never installs a selected lane over that checkout. It copies the runnable source and selected lock to an owned temporary directory, installs there, verifies the actual graph, builds there and removes that workspace after cleanup. Temple's artifact remains outside it and receives before-and-after verification.

## Read the evidence

Every command prints a report directory under `reports/`.

| File | Meaning |
| --- | --- |
| `result.json` | Lane, harness revision, dirty-source indicator, source hash, stage, workflow and health verdicts, cleanup errors |
| `installed-graph.json` | Actual package names, versions and installation paths, registry integrity and resolved URLs, optional omissions and duplicates, Node and npm versions, browser metadata |
| `package.json`, `package-lock.json` | Exact consumer inputs |
| `source-files.json` | Hashes of the source files copied into this run |
| `playwright.json` | Test statistics and errors, including retries and skips |
| `artifacts/*/measurement.json` | Lifecycle attempt, completed steps, signature, response metadata and separate wallet and dApp health |
| `artifacts/*/sandbox.json` | Sandbox network proof, transfer receipt and health findings |
| `artifacts/*/trace.zip` | Post-onboarding trace with screenshots, DOM snapshots and named steps |
| `artifacts/*/failure-*.png` | Failure screenshots when a dApp or confirmation page remains available |

Open one trace with:

```sh
npx playwright show-trace reports/temple-lifecycle-EXAMPLE/artifacts/ATTEMPT/trace.zip
```

Replace the example path with the file printed by your run. Start at the failed named step and compare the dApp result with the wallet prompt and network activity.

Registry integrity values describe the locked tarballs verified by npm during installation. They are not a fresh hash of every installed file. Chromium's actual version must match Playwright's pinned version. The report records that version and the expected browser revision; it does not independently attest a maliciously replaced browser executable.

## Interpret outcomes

A lifecycle pass requires three distinct complete attempts, correct Playwright statistics, exact signing verification, complete cleanup and the verified wallet artifact. HTTP or console failures from the wallet produce `workflow-passed-with-wallet-findings` if the protocol otherwise completes. Missing or incorrect signing-type metadata produces `workflow-passed-with-contract-findings` when no higher-priority health finding applies. Each attempt retains all findings even when the overall status names only one category.

A failed disconnect remains a protocol failure. A valid signature does not erase a response-contract failure. A real applied transfer remains recorded as applied when wallet health makes the overall command fail. Canceled requests are recorded separately from request failures.

All statuses except a clean `workflow-passed` exit nonzero for real-wallet commands. Interruption or cleanup failure also prevents success. Stable is not expected to fail merely because the historical version failed. See [the observed results](wp01-results.md) for remaining blockers.

The commands are repeatable in their selected packages, wallet archive, browser revision, fixture and local chain. Public wallet APIs can change or rate-limit requests, so complete end-to-end outcomes are not deterministic. Those failures remain visible. Operation hashes, ports, profile names and timestamps can vary.

## Deterministic checks in Actions

```sh
npm run consumer:check -- --lane stable
npm run consumer:check -- --lane candidate
```

These commands install and attest each graph, typecheck, build, run deterministic tests and check the bounded verdict properties. They need no wallet archive, browser installation, Docker or display. Their successful status is `harness-checks-passed`, not a real-wallet result.

The Actions workflow runs these commands and the actual runner interruption control on Node 24.22.1 and Ubuntu 24.04. Each job has a 15-minute limit, read-only repository permissions and seven-day diagnostic retention. Its npm download cache uses the selected lockfile. It needs no browser or Docker setup. Real extension approval, disconnect, live wallet services and the Tezbox transfer still require the local commands above.

## Updating a lane

Change its exact package pins, regenerate its lock with npm, review the resolved Beacon closure, and run `consumer:check` followed by all three real commands for that lane. Update the expected versions in `scripts/consumer-workspace.mjs` together with the manifest. Never edit a successful report to describe a new graph.
