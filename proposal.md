# Tezos wallet end-to-end tests

Run Beacon and Taquito through real Temple, Kukai, and Umami approval screens. Start with local runs so maintainers can reproduce a failure before we decide what belongs in CI.

## What the POC found

The Temple test restored a connected account after reload, then hung at disconnect. With the same wallet, browser, test, and locked dependencies, the base Matrix package hung in three fresh profiles. A local Matrix fix passed all three and kept the account cleared after another reload. Temple still omitted `signingType` even though its signatures verified.

The pinned Kukai source build completed all three protocol runs. Its console still reported an undefined-type error and requests to retired endpoints. The packaged Umami release completed zero of three full runs. One failed before permission approval and two stalled while reconnecting after signing rejection. These are recorded findings for the tested artifacts. Hosted Kukai and the Chrome Store Temple picker need separate checks.

## Two suites

| Suite | What it proves |
| --- | --- |
| Wallet lifecycle | Real pairing, permission rejection and recovery, exact account identity, persistence after reload, exact-byte signature verification, and disconnect that stays cleared after reload. Each wallet declares its rejection contract. Temple and Kukai preserve the account after signing rejection. Umami revokes it, so the test must prove re-pairing and signing recovery. |
| Sandbox transaction | Taquito sends an operation through a real wallet approval. Tezbox returns the receipt for that exact operation and shows the expected state change. |

The lifecycle suite needs no funded account. For transactions, start with one Temple transfer on a fresh Tezbox chain. Tezbox controls chain state. Kukai and Umami pairing still need a Beacon relay.

## Start with Temple

1. Reuse the small POC dApp and the existing Temple lifecycle scenario. Keep a fresh persistent Chromium profile per attempt. Pair through Beacon's public custom-picker event using the unpacked extension's runtime ID. Keep a separate default-picker check for a Chrome Store installation.
2. Verify the custom network without sending an operation. Start a pinned Tezbox image on loopback. Read the chain identity from that container and prove the dApp and Temple each reached it. Check the approved account, network name, and RPC URL. Temple echoes the requested network in its permission response, so verify the wallet's RPC traffic too.
3. Add one Taquito transfer with a dedicated sandbox-funded account. Verify the chain before signing. Require a real wallet approval, an applied receipt for the returned hash, and the expected sender, recipient, amount, and recipient balance delta. Run one worker until each worker can own its chain and ports.

Share Temple setup between the two tests. Add a common driver interface when a second wallet needs it. Use role, label, or wallet test-ID locators and wait for the specific prompt or result.

## Add the other wallets

- **Kukai.** Use a pinned production-source build for repeatable runs and test the hosted wallet separately. Keep relay and console failures visible even when protocol checks pass.
- **Umami.** Launch the pinned desktop binary and attach to its renderer over CDP. Umami 2.3.8 disables the inspector fuse used by Playwright's Electron launcher. Track pairing and recovery failures before adding transaction coverage.

## Evidence and release comparison

Pin the consumer lockfile, wallet artifact, browser, and sandbox image. Keep expected behavior in assertions. Save the actual chain ID, request or operation identity, and receipts in the run report before normalizing any volatile fields for comparison.

Compare exact stable and candidate packages in fresh installs with the same workflow and wallet artifacts. For a local patch, record the tarball hash and verify the intended dependency change. Keep protocol results, response-contract failures, wallet health, and unavailable prerequisites separate. A timeout leaves the check unresolved or failed, depending on where it occurs.

Run acceptance checks with zero retries or skips. Keep the first attempt's trace, starting after seed and password entry, plus structured results and failure screenshots. Leave service workers enabled. Close owned processes and profiles even when setup fails. Keep wallet archives, profiles, traces, and local package tarballs out of Git.

## References

- [Taquito Wallet API](https://taquito.io/docs/25.1.0/wallet_API/)
- [Temple 2.0.34 permission handling](https://github.com/madfish-solutions/templewallet-extension/blob/639883b6b8931cbe49de4d756bfa59c02b5d7f20/src/lib/temple/back/actions.ts#L887-L903)
- [Tezbox setup and configuration](https://github.com/tez-capital/tezbox)
- [Playwright Chrome extension setup](https://playwright.dev/docs/chrome-extensions)
- [Playwright Electron support](https://playwright.dev/docs/api/class-electron)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)
