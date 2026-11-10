# Tezos wallet end-to-end tests

This repository tests real wallet interactions through Beacon and Taquito. See [the proposal](proposal.md) for scope and the findings from the local POC.

## Run the Temple lifecycle test

Use Linux or WSL with Node 24.22.1, npm, Python 3, Xvfb, and Playwright's Chromium system libraries.

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run wallet:acquire
xvfb-run -a npm run temple:lifecycle
```

The runner installs the locked consumer, verifies the official Temple 2.0.34 archive and extracted files, and builds the test dApp. It runs three fresh profiles with zero retries. The unpacked extension pairs through Beacon's public custom picker. The test uses a public fixture account and makes no transfers.

The published Beacon dependency in this lockfile hangs at disconnect after restoring the account. Expect a nonzero exit and check the failed step in the report. The separate missing `signingType` measurement remains visible even when the signature verifies.

Run one invocation at a time per checkout. The install and build share local files.

The runner closes its preview server and removes its browser profiles on exit. Each invocation prints its directory under `reports/`. It contains the tested lockfile, Playwright JSON, measurements, and post-onboarding traces with named steps. Failed runs also save PNGs of the dApp and any open wallet confirmation after onboarding. Open a trace with `npx playwright show-trace path/to/trace.zip`.

Run `npm test` for the fixture, signature, and artifact checks. Run `npm run build` for TypeScript and the dApp build.

## Run the Tezbox checks

Start Docker in the same Linux or WSL environment you use for Playwright. Pull the pinned image once. Leave several GiB free for the image, browser, and reports.

```sh
docker info
docker pull ghcr.io/tez-capital/tezbox:tezos-v25.2@sha256:02896feb500cd5383bb9985d6812db579aebf13bace2f78a5f97a8866efe3caf
xvfb-run -a npm run temple:network
xvfb-run -a npm run temple:transfer
```

The network check approves a custom Tezbox network in Temple and verifies chain-ID responses from the dApp and the extension. It sends no operation. The transfer repeats those checks, funds the public fixture from the sandbox's Alice account, and uses Temple to approve a 0.1 tez transfer. The test verifies one Temple injection, an applied receipt with the same hash Taquito returned, and the recipient's balance increase.

Each command starts its own loopback-only container, preview server, and browser profile. The runner cleans them up when it exits. The sandbox result includes the image, chain, browser, RPC calls, and receipt when available. Find it under the printed report directory at `artifacts/*/sandbox.json`. The report keeps transfer verification, dApp errors, and wallet health separate. A confirmed transfer stays confirmed even if an error or degraded wallet health makes the command exit nonzero. Canceled browser requests are excluded from health. For a failure, check `result.json`, the Playwright report, and the post-onboarding trace in that directory.
