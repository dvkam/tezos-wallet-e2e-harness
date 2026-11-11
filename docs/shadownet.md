# Check Shadownet before a live transfer

This is WP03, the read-only prerequisite for [the live transfer](https://github.com/dvkam/tezos-wallet-e2e-harness/issues/10). It requests wallet permissions and verifies the actual network responses. It sends no operation. Tezbox remains the quick local transfer check.

## Run the RPC preflight

After the [standard setup](verification.md#start-from-a-fresh-checkout), run:

```sh
npm run shadownet:preflight
```

The command checks the pinned Shadownet chain ID `NetXsqzbfFenSTS` and genesis `BMJTFWBgqGUzsvW4JLS1XuCYnpH18pBsLb5UvPCv2eiNC5vUeps`. Both RPC endpoints must report a recent head and agree on a common block two levels behind the lower head. It compares block hashes and the header fetched by that hash. Different head levels are allowed.

The defaults are `https://rpc.shadownet.teztnets.com` and `https://tezos-shadownet.octez.io`. These are two distinct public RPC hostnames. That does not establish independent infrastructure ownership. The [Tezos node documentation](https://docs.tezos.com/architecture/nodes) lists public endpoints.

Override them with `SHADOWNET_PRIMARY_RPC` and `SHADOWNET_OBSERVER_RPC` if needed. This slice accepts public HTTPS origins only, with different hostnames and no userinfo, query, fragment or path. Never include an API key. RPC requests have ten-second deadlines. Shadownet UI assertions have a twenty-second budget, within a 180-second scenario limit. All attempts have zero retries. Redirects, chain resets, stale heads and conflicting anchors fail the check. A reset needs investigation and a reviewed pin update, not an automatic fallback.

The printed directory contains `result.json`. `rpc-preflight-passed` means only that RPC identity checks passed. It does not test a wallet, approve a transaction or qualify a release.

## Run the Temple network proof

Use the verified official wallet archive and the standard browser prerequisites:

```sh
xvfb-run -a npm run temple:shadownet:network -- --lane stable
xvfb-run -a npm run temple:shadownet:network -- --lane candidate
```

Run them sequentially. Each command verifies its locked installed package graph, builds the localhost dApp, uses a fresh browser profile and requests custom-network permission from Temple. It observes actual chain-ID responses from the dApp page and extension origin. A permission response echoing the requested network is insufficient.

Both clients use separate paths through an owned loopback gateway. The gateway forwards constrained GET requests to the selected primary RPC. It has no injection-enabling method. Other RPC methods are rejected and recorded; a mutation attempt fails the workflow even when nothing was forwarded. The browser also records injection requests outside the gateway. The observer RPC participates in the identity proof, not wallet submission.

This strictly read-only command uses the public unfunded fixture. Never fund that account on a public chain.

## Inspect the result and trace

The run prints a directory under `reports/temple-shadownet-network-*`.

- `result.json` contains the selected lane, provenance, workflow outcome and separate health results.
- `installed-graph.json` and the saved lock describe the installed consumer. See the [comparison guide](published-comparison.md#read-the-evidence) for provenance limits.
- `artifacts/*/shadownet.json` contains both RPC observations, the common anchor, client-origin evidence, gateway calls and injection attempts. RPC failure kinds distinguish unavailable services, identity mismatches and provider disagreement.
- `artifacts/*/trace.zip` contains named steps, screenshots and DOM snapshots after onboarding. Open it with `npx playwright show-trace path/to/trace.zip`. Failure screenshots are retained when eligible pages remain open.

A clean workflow requires actual network evidence from both clients, no mutation attempts, complete cleanup and clean health. Recorded RPC 4xx/5xx responses prevent a clean result. Reads canceled by gateway shutdown are retained as cancellations, not remote outages. Evidence is written after browser closure and after owned gateway reads have settled.

The corrected candidate and stable runs each completed the network workflow with zero injections and zero retries. Temple returned background HTTP 429s in both lanes, so each overall status was `workflow-passed-with-wallet-findings` and each command exited nonzero. That is a network proof with unresolved wallet health, not a release pass. Earlier implementation runs failed on a missing gateway CORS header and stable's five-second confirmation-render deadline. Both artifacts remain retained locally. The Shadownet assertion budget is now explicitly twenty seconds, longer than one allowed RPC request; the report records time from the permission trigger to the required wallet content. This timing adjustment does not establish an SDK defect.

## Priority TODO for David

[The live-transfer issue](https://github.com/dvkam/tezos-wallet-e2e-harness/issues/10) tracks the next stage.

Create a new dedicated Shadownet test wallet and fund only its public address through the [Shadownet faucet](https://faucet.shadownet.teztnets.com/). Keep its seed or private key in a protected local file outside this checkout. Do not paste it into an issue, PR, report or chat. Provide only the file path when the credential adapter is ready. Reserve a fresh recipient for each attempt.

WP04 still needs the protected credential adapter, explicit live opt-in, bounded amount/fees/storage burn, a one-shot submission journal, uncertain-submission reconciliation, and a shared independent receipt and historical-balance oracle. No live transfer command is exposed by this PR. Signing metadata and wallet HTTP findings remain visible.

## Hosted compatibility coverage

The [deployed Taquito Playground tests](https://shadownet.dapp.taquito.io/tests) cover more than Sapling. Its [scenario registry](https://github.com/ecadlabs/taquito-test-dapp-vue/blob/14e7d2d737454eaed660d9a9c757e3ec40d12310/src/modules/tests/tests.ts) includes transfers, signing, contracts, batching, delegation, staking, metadata, FA2, events, bridges and Sapling.

Add ordinary transfer/signing compatibility before Sapling's shield, private transfer and unshield cycle. The hosted app is a separate deployment that can change independently. Record its observed build and network identity; it cannot attest our locally selected stable/candidate package graph. Keep localhost for those controlled comparisons.
