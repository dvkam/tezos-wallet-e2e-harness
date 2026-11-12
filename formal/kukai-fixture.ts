import fixture from '../fixtures/account.json' with { type: 'json' }
import { kukaiSteps } from '../scripts/kukai-verdict.ts'
export function cleanKukaiAttempts() {
  return [0, 1, 2].map(attempt => ({
    attempt, workflow: 'passed', steps: [...kukaiSteps],
    artifact: { verified: true, sourceCommit: '1b79adc438dd4b54f1526c489fcd154e1302f802',
      manifestSha256: '7333391553533f6c524f22ff7fc0e8aa432093528fbe34c2f734fe80ced90b76' },
    browserVersion: '149.0.7827.55',
    account: { address: fixture.address, publicKey: fixture.publicKey, network: 'mainnet' },
    signed: { requestedPayload: fixture.payload,
      response: { signature: 'edsigu4QgRjMBRfXuoMVfXDpM8uoQcBaNnjRzeAwpbNCAsKjBKkMrFu6WLud8dATuCmffABZJdT8VvnNbUFWtR2bVuty9mSPN7k', signingType: 'micheline' } },
    health: { scope: 'wallet-startup-and-post-onboarding',
      dapp: { status: 'clean', findings: [] as { kind: string; detail: string }[], canceledRequests: [] },
      wallet: { status: 'clean', findings: [] as { kind: string; detail: string }[], canceledRequests: [] } },
    secretScan: { status: 'passed' }
  }))
}
export const completeStats = { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }

