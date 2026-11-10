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

Each invocation prints its directory under `reports/`. It contains the tested lockfile, Playwright JSON, measurements, and post-onboarding traces. Open a trace with `npx playwright show-trace path/to/trace.zip`.

Run `npm test` for the fixture, signature, and artifact checks. Run `npm run build` for TypeScript and the dApp build.
