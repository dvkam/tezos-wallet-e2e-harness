# Adapter verification

The adapter checks cover two properties.

1. A Kukai run needs three distinct, complete workflows, exact fixture identity, a signature of the original bytes, consistent health evidence and passing secret scans. Wallet errors or signing metadata gaps prevent a clean result.
2. A signal received before publication prevents a clean result, including a signal received while asynchronous cleanup runs.

Run the executable checks with Node 24.22.1.

```sh
npm run verify:adapters
npm run verify:adapter-runner
```

The first command exhausts 64 combinations of six evidence failures against the production validator, then executes six publication cases. Four validator mutations and one publication mutation must expose false acceptance. The command records source hashes and rejects a source change during verification.

The second command runs the actual adapter runner. It checks a missing artifact and interruption during installation. Both must exit nonzero, remove owned profiles and temporary workspaces, and preserve unrelated files and the checkout lockfile. A separate Node regression starts two live process groups and checks that cleanup stops the authorized browser group even when its leader exits before a child that ignores SIGTERM. An unrelated process must survive.

## Model checking

Use Java 21 and TLC 2.19. Set JAVA and TLA_JAR to the verified executables on your machine.

```sh
"$JAVA" -cp "$TLA_JAR" tlc2.TLC -workers 1 -metadir /tmp/adapter-tlc-good \
  -config formal/AdapterPublication.cfg formal/AdapterPublication.tla
"$JAVA" -cp "$TLA_JAR" tlc2.TLC -workers 1 -metadir /tmp/adapter-tlc-mutant \
  -config formal/AdapterPublication-mutant.cfg formal/AdapterPublication.tla
```

The first command must pass both invariants. The second must fail with a counterexample. Use separate empty metadata directories for each invocation.

The model has four independent Boolean inputs for complete evidence, unchanged artifacts, successful cleanup and clean health. Signals can arrive before each modeled asynchronous phase completes. Publication is atomic because the production function checks interruption and writes synchronously, with no await between them. The correct model explores 128 distinct states. The executable mutation also calls the actual publisher with its guard removed and observes a false clean result.

This is bounded verification. It does not prove the wallet, cryptographic libraries, external services, browser internals, arbitrary process scheduling or cleanup after SIGKILL of the top-level runner. The local real-wallet run and failure reports remain separate evidence. The scoped verification skill records the source correspondence and rerun rules for future changes.
