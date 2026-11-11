# WP01 local results

Observed on 11 November 2026 in Ubuntu 24.04 under WSL, with Node 24.22.1, Playwright 1.64.1 and the verified Temple 2.0.34 artifact. These are local development results, not a qualified release baseline.

## Real wallet comparison

| Graph | Workflow | Protocol or operation result | Overall command |
| --- | --- | --- | --- |
| Stable | Lifecycle | All three reached signing and rejection recovery, then disconnect remained pending | Failed |
| Historical | Lifecycle | All three reached signing and rejection recovery, then disconnect remained pending | Failed |
| Candidate | Lifecycle | Three complete passes, including disconnect and account absence after reload | Nonzero, wallet health and signing metadata findings |
| Stable | Tezbox network | Passed, with dApp and extension chain evidence and no injection | Passed on the completed invocation |
| Candidate | Tezbox network | Passed, with no injection | Nonzero, wallet health findings |
| Stable | Tezbox transfer | One 0.1 tez transfer applied; receipt and recipient balance delta verified | Nonzero, wallet health findings |
| Candidate | Tezbox transfer | One 0.1 tez transfer applied; receipt and recipient balance delta verified | Nonzero, wallet health findings |

The stable lifecycle does not contain the candidate's disconnect repair. The comparison preserves that failure rather than requiring or suppressing it. The candidate result is consistent with the shipped Matrix fix, but these two lanes also change Taquito and other dependencies, so this run alone does not establish isolated package causality.

Temple reported HTTP 400 and 429 responses after onboarding. Lifecycle signing produced independently valid signatures while the response omitted the required `signingType` field. The prior harness recorded that contract failure without making it fail acceptance. The new verdict prevents a clean result. The response field is required by Beacon's published `SignPayloadResponse` type.

One earlier stable network invocation failed during Tezbox startup before wallet interaction. The auto-removed container had already disappeared, so its exit cause could not be recovered. An independently started instance of the exact image reached the expected chain. A fresh network invocation subsequently passed. The failed invocation remains recorded and does not become an automatic retry or a pass. Containers now remain available for startup log collection until the existing owned cleanup removes them.

## Local evidence

Reports remain local and are not bundled into this repository. They contain the selected locks, source snapshot hashes, installed graph and raw Playwright evidence where the corresponding stage was reached. An installation interruption has no browser evidence. Test runs made during implementation record their dirty-source state. Use those snapshots rather than assuming every run used the final PR commit.

| Observation | Report directory under `reports/` |
| --- | --- |
| Initial stable lifecycle | `temple-lifecycle-WNyKij` |
| Stable lifecycle after final reporting changes | `temple-lifecycle-IbN0mA` |
| Candidate lifecycle | `temple-lifecycle-HEbrGt` |
| Historical negative control | `temple-lifecycle-14ae2D` |
| Failed sandbox startup | `temple-network-DWlAN2` |
| Completed stable network check | `temple-network-er4jNd` |
| Stable applied transfer | `temple-transfer-nj50rP` |
| Candidate network check | `temple-network-doYAlt` |
| Candidate applied transfer | `temple-transfer-vlaT3M` |
| Actual runner interruption control | `temple-check-khsVwL` |

The same commands can produce different HTTP findings as public wallet APIs change. Preserve all attempts and their exit codes. No Shadownet operation was submitted.

## Deterministic checks

Both exact package graphs passed isolated installation, graph verification, TypeScript, build, 19 Node tests and seven Python artifact tests. The bounded production-validator check passed its 176 original combinations and detected all six in-memory broken variants, for 848 cases including controls.

The actual runner interruption control interrupted installation, returned nonzero, removed its own workspace and profiles, and preserved the checkout lock and an unrelated file. The final review also found and fixed a progress-report race by replacing direct publication with a temporary file and atomic rename.

## Remaining qualification work

Neither integration has a clean full lifecycle baseline in this environment. Stable still has the disconnect failure; the candidate completes the workflow but retains wallet health and response-contract findings. Investigate those findings with the owning wallet or service. Do not filter them out for acceptance.

The independent contributor walkthrough, Store-installed Temple through the default picker, Shadownet transfers and WalletConnect qualification remain separate work. Deterministic CI can validate the harness implementation while these real-wallet results remain non-green.
