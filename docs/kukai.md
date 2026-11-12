# Kukai lifecycle

This local diagnostic runs the official Kukai source at commit 1b79adc438dd4b54f1526c489fcd154e1302f802. It keeps Kukai's embedded Beacon 4.8.0 SDK unchanged. The selected Beacon and Taquito graph belongs to the separate dApp under test.

## Setup

Install the Linux or WSL prerequisites in verification.md, including Node 24.22.1, a display or Xvfb, and Playwright Chromium. Kukai's upstream production build separately requires Node 22.23.4. Install that exact version, then return to Node 24.22.1 for the harness.

```sh
nvm install 22.23.4
nvm use 24.22.1
npm ci --ignore-scripts
npx playwright install chromium
npm run kukai:acquire
npm run kukai:verify
xvfb-run -a npm run kukai:lifecycle -- --lane candidate
```

If Node 22.23.4 is outside nvm's default location, set KUKAI_BUILD_NODE to its absolute executable path before acquisition. The preparation command clones official source, checks the commit and clean tree, installs the source lock without lifecycle scripts, then runs Kukai's own patch.js and build-prod. It records every tracked source hash, the build command and Node version, and every distribution file hash. Preparation failures never publish a completed manifest.

The default artifact directory is .artifacts/kukai. To reuse a verified local artifact, set WALLET_ARTIFACT_ROOT to the absolute directory that contains kukai. KUKAI_ARTIFACT_ROOT can select the Kukai directory directly. Acquisition needs network access and at least 3 GiB free space.

## What the run checks

Each of three attempts uses a fresh browser profile and zero retries. The runner imports only the public, unfunded fixture through Kukai's UI and pairs through its public TZIP-10 link. It rejects permission, approves a new pairing, verifies the exact account and reload persistence, approves signing of the fixed Micheline bytes, rejects signing without losing the account, and disconnects across reload. No operation is submitted.

The browser and report validator independently verify the signature against the original payload and reject a changed-payload control. The installed graph report records the exact dApp package closure and actual pinned Chromium version. The wallet manifest records the separate source build and its dependencies. Before/after artifact verification rejects a changed wallet.

Onboarding is not traced. The runner stops tracing before signing password entry and starts a new trace afterward. It scans trace resources and evidence for the generated password and full fixture mnemonic. Keep all reports private until that scan passes. This byte scan cannot prove that an image contains no secret.

## Results and traces

The command prints its reports/kukai-lifecycle-* directory. result.json separates protocol completion, test statistics and wallet/dApp findings. Attempt measurement.json files retain incomplete steps, the last phase, exact account/signature evidence and startup/runtime health. Canceled requests remain visible separately. Failed protocol steps produce a nonzero exit, as do degraded health, a signing metadata gap, changed artifacts, interruption or cleanup failure.

Open an attempt's trace-before-unlock.zip or trace.zip with npx playwright show-trace. The two traces intentionally have a gap for password entry. Failure screenshots cover the dApp, not secret-entry forms. Do not upload wallet profiles, downloaded keystores or private evidence.

The first port batch failed during onboarding in all three attempts. Its error redaction initially removed the useful cause, so that batch remains an unresolved diagnostic. After safer error messages were added, a separate candidate batch completed all three workflows. That run still exited nonzero with wallet findings, including undefined-type console errors and failed wallet service requests. This does not establish a clean release baseline or resolve the initial onboarding instability.

This command covers a pinned local source build. Hosted Kukai, deployed dApp compatibility and transfers remain separate work.
