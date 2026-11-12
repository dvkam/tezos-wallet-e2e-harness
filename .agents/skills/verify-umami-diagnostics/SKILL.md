---
name: verify-umami-diagnostics
description: Check the Umami diagnostic verdict without treating incomplete wallet runs as acceptance.
---
Run `node formal/verify-umami.ts` after changing the Umami verdict or evidence schema.
It executes the actual verdict over 256 combinations of incomplete workflow, wrong identity, invalid signature, duplicate response ID, failed secret scan, changed payload and missing signing metadata. A deliberately weakened signature-check mutant must produce a false green before the control succeeds.
The command records the source SHA-256. It is a bounded executable check, not proof of wallet behavior, cleanup, network liveness or confidentiality.
Run the Python artifact and evidence tests, TypeScript checks and the three-attempt real desktop scenario separately. Keep failures visible. Never substitute the older local POC model for verification of this port.

Sync commit: 5e90788. Metadata preservation changed the evidence schema; the bound increased from 128 to 256 combinations. The verifier imports current production code directly.
