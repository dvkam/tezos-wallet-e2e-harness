# Bounded verification of WP01 acceptance

The check exercises the production graph and lifecycle validators. It asks whether incomplete evidence or a bad package graph can be accepted in a declared finite input domain.

Run with Node 24.22.1 after installing the locked development dependencies:

```sh
npm run verify:publication
```

The tool enumerates 160 lifecycle combinations. It varies attempt count from zero through four, distinct versus repeated attempt IDs, wallet health, signing metadata, statistics and complete versus empty step lists. In this domain, a clean result is possible only with three distinct complete attempts, clean health, correct metadata and zero failures, skips or retries.

It also enumerates 16 package-graph combinations. These vary the installed SDK version, registry provenance, an extra dependency and a missing required dependency. The production validator must accept only the matching, fully recorded installation.

Six in-memory mutations remove version, provenance, attempt-identity, statistics, wallet-health or signing-contract checks. Each mutation must produce counterexamples. The command checks 848 cases including those controls, then rehashes the covered source to reject concurrent edits. It never changes the checkout.

For example, removing the signing-contract condition permits a workflow with three valid signatures but missing signing metadata to return a clean result. The control detects that forbidden acceptance. Removing the version condition permits an older installed SDK under a newer selected lock; that control also fails.

The covered functions are `validateGraph` in `scripts/consumer-graph.ts` and `lifecycleVerdict` in `scripts/lifecycle-verdict.ts`. Ordinary tests additionally check mismatched browser versions and inconsistent health findings.

This is exhaustive checking over the stated finite domain, not an unbounded proof. It does not prove filesystem integrity, every JSON input, the outer runner's signal scheduling, browser behavior, cryptography, wallet correctness or public service availability. Run `npm run verify:runner` for the separate actual runner control. It interrupts installation, checks a nonzero result and removal of the owned workspace and profiles, and checks that the checkout lock and an unrelated file survive. It does not exhaust signal scheduling. Real wallet behavior still needs the local suite.

See the project-local verification skill for the coverage record and maintenance instructions.
