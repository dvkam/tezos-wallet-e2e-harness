# Tezos wallet end-to-end tests

Run real Temple wallet flows against Beacon and Taquito on Linux or WSL. Install the [prerequisites](docs/verification.md#prerequisites) first.

```sh
git clone https://github.com/dvkam/tezos-wallet-e2e-harness.git
cd tezos-wallet-e2e-harness
npm ci --ignore-scripts
npx playwright install chromium
npm run wallet:acquire
xvfb-run -a npm run temple:lifecycle
```

Commands default to the locked stable graph. Add `-- --lane candidate` to test the beta. Each run installs and builds in an isolated temporary workspace and uses fresh browser profiles with zero retries.

The [verification guide](docs/verification.md) covers setup, Tezbox transfers, reports and screenshot traces. The [comparison guide](docs/published-comparison.md) lists exact package versions and commands for each lane. Current observations include a stable disconnect hang and candidate wallet-health and signing-metadata findings. They do not establish a clean release baseline.

## Deterministic checks

```sh
npm run consumer:check -- --lane stable
npm run consumer:check -- --lane candidate
```

These are also the Actions matrix commands. They verify the harness without a browser or Docker; they do not simulate wallet approvals. See [the verification scope](docs/verification-properties.md).

The [Kukai lifecycle diagnostic](docs/kukai.md) runs a pinned source build through real P2P approvals. It retains wallet service failures and does not establish a clean release baseline.

The [Umami diagnostics](docs/umami.md) run the unchanged desktop wallet through public pairing and approval flows. The recorded run completed zero of three workflows. Recovery failures remain visible; this is diagnostic coverage.

The [proposal](proposal.md) describes other wallets and planned coverage.
