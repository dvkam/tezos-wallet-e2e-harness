# Verify the Temple workflows

## Prerequisites

Use Ubuntu 24.04 on Linux or WSL, Node 24.22.1, npm, Git, Python 3, and Xvfb. The commands run in the Linux shell. With WSL, keep several GiB free on both the Linux filesystem and the Windows drive that backs it.

The network and transfer checks need a running Linux Docker engine. Run `docker info` in the same shell that runs Playwright. With Docker Desktop, enable integration for your WSL distro.

On a machine without Chromium's system libraries, install them after `npm ci` with `npx playwright install-deps chromium`. This may require administrator access. Install `xvfb` and `xauth` through your distro if `xvfb-run` is missing. See the [Playwright browser setup](https://playwright.dev/docs/browsers#install-system-dependencies).

## Start from a fresh checkout

```sh
git clone https://github.com/dvkam/tezos-wallet-e2e-harness.git
cd tezos-wallet-e2e-harness
git rev-parse HEAD
node --version
npm --version
python3 --version
npm ci --ignore-scripts
npx playwright install chromium
npm run wallet:acquire
npm run wallet:verify
npm test
npm run build
```

`wallet:acquire` downloads the official Temple 2.0.34 Chrome archive. `wallet:verify` checks its SHA-256 and verifies the extracted files against the archive. If verification fails, inspect the files before trying again. The browser uses a new profile and the suite's public test account. Keep personal wallet profiles and funds out of the run.

## Run the checks

Run comparison commands sequentially to reduce interference from shared public wallet services. Each command installs the selected consumer lockfile and rebuilds the test dApp in an owned temporary workspace. It does not replace checkout dependencies. The runner prints its report directory at startup.

Commands default to `stable`. Add `-- --lane candidate` for the beta or `-- --lane historical` for the older reproducer. See [the comparison guide](published-comparison.md) for exact versions and a complete pair of runs. For example:

```sh
xvfb-run -a npm run temple:lifecycle -- --lane stable
xvfb-run -a npm run temple:lifecycle -- --lane candidate
```

For the sandbox checks, pull the pinned image once.

```sh
docker info
docker pull ghcr.io/tez-capital/tezbox:tezos-v25.2@sha256:02896feb500cd5383bb9985d6812db579aebf13bace2f78a5f97a8866efe3caf
xvfb-run -a npm run temple:network
xvfb-run -a npm run temple:transfer
```

| Command | What to verify |
| --- | --- |
| `temple:lifecycle` | Check all three fresh-profile attempts, including restoration after reload and disconnect. Recorded stable and historical runs hung on disconnect; candidate completed the protocol but retained wallet-health and missing-`signingType` findings. Those observations do not predetermine a new run. Verify its actual steps and separate signature verification from response metadata. |
| `temple:network` | The dApp and Temple extension each read chain ID `NetXtJqPyJGB6Pc` from the sandbox. The run records zero wallet injections and `transfer: "not-run"`. |
| `temple:transfer` | Temple injects one operation. The hash Taquito returns matches the applied receipt, and the recipient gains exactly 100,000 mutez. |

Real-wallet commands exit zero only for a clean `workflow-passed` result. Missing signing metadata, dApp errors, degraded wallet health, interruption or cleanup failure prevent acceptance even when the protocol completes. The sandbox command also exits nonzero if dApp errors or degraded wallet health accompany a passing workflow. For example, a transfer can produce `sandbox.transfer: "passed"`, `sandbox.health.dapp.status: "clean"`, and `sandbox.health.wallet.status: "degraded"` when Temple's background balance endpoint returns HTTP 429. The top-level result is then `workflow-passed-with-wallet-findings`. Check both outcomes before classifying the run.

## Inspect the evidence

- Open `result.json` for the lane, overall outcome and failed stage, if any. A Docker, install, or artifact failure leaves the wallet behavior unverified.
- Check `installed-graph.json`, the saved consumer `package-lock.json` and `source-files.json` for the exact installed versions and copied source. The [comparison guide](published-comparison.md#read-the-evidence) explains the provenance limits.
- Read `playwright.json` for individual test results. Open `artifacts/*/measurement.json` for lifecycle steps and the signature contract. Open `artifacts/*/sandbox.json` for the chain reads, RPC calls, health findings, and applied receipt.
- Open a recorded trace with `npx playwright show-trace path/to/trace.zip`. Select a named step and use the screenshot filmstrip, DOM snapshots, and network view to inspect the wallet and dApp. Recording starts after seed and password entry. A failure after onboarding can also leave a standalone `failure-*.png` for the dApp or an open confirmation.

On a machine without a graphical display, run `npx playwright show-trace --host 127.0.0.1 --port 0 path/to/trace.zip` and open the printed loopback URL in a browser on that machine. You can also open the ZIP in [Playwright's browser-based Trace Viewer](https://trace.playwright.dev/).

When reporting a result, include the Git commit, Node and npm versions, the command and exit code, and the run directory name. Inspect artifacts before sharing them.

## What makes runs repeatable

Each lane's lockfile pins its installed consumer and Playwright version. The checkout lock is the historical graph; the runner selects the stable or candidate lock before installation. Playwright selects its matching Chromium build. The Temple archive checksum and Tezbox image digest pin the wallet and chain software. The runner uses fresh browser profiles, a fresh loopback-only chain per sandbox run, a fixed test account and transfer amount, one worker, and zero retries. Run commands use the unpacked Temple extension and Beacon's custom picker. The Chrome Store default picker needs its own check.

Compare the same chain identity, signed bytes or receipt fields, and balance change across runs. Operation hashes, timestamps, ports, and browser profile IDs can vary. Public wallet services can also vary. The report records their observed post-onboarding health separately, so an external HTTP error remains visible alongside the chain result.


## Validation limits

The guide has been exercised from a fresh clone with empty package and browser caches on the same Ubuntu WSL host. That reused its system libraries and Docker. A contributor run on another machine remains pending.

For fast checks without wallet approvals or Docker, run `npm run consumer:check -- --lane stable` and `npm run consumer:check -- --lane candidate`. Actions runs the same graph checks and an interruption/cleanup control. Passing those jobs verifies the harness, not wallet release readiness.


## Shadownet

Use [the Shadownet guide](shadownet.md) for RPC preflight and a real Temple network-permission check. These commands send no operation. The dedicated funded-account TODO and live-transfer acceptance gates are tracked separately.
