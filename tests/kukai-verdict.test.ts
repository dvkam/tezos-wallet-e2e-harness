import { test } from 'node:test'
import assert from 'node:assert/strict'
import fixture from '../fixtures/account.json' with { type: 'json' }
import { kukaiVerdict, kukaiSteps } from '../scripts/kukai-verdict.ts'

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

test('requires complete independent exact-byte evidence, not just three passing tests', () => {
  assert.equal(kukaiVerdict(cleanKukaiAttempts(), completeStats).status, 'workflow-passed')
  for (const damage of [
    (v: ReturnType<typeof cleanKukaiAttempts>) => { v[1].attempt = 0 },
    (v: ReturnType<typeof cleanKukaiAttempts>) => { v[0].signed.requestedPayload += '00' },
    (v: ReturnType<typeof cleanKukaiAttempts>) => { v[0].signed.response.signature = 'invalid' },
    (v: ReturnType<typeof cleanKukaiAttempts>) => { v[0].account.address = 'wrong' },
    (v: ReturnType<typeof cleanKukaiAttempts>) => { v[0].steps.pop() }
  ]) {
    const values = cleanKukaiAttempts(); damage(values)
    assert.equal(kukaiVerdict(values, completeStats).status, 'diagnostic-failed')
  }
  assert.equal(kukaiVerdict(cleanKukaiAttempts().slice(0, 2), completeStats).status, 'diagnostic-failed')
  assert.equal(kukaiVerdict(cleanKukaiAttempts(), { ...completeStats, flaky: 1 }).status, 'diagnostic-failed')
})
test('preserves wallet failures and signing metadata findings as non-green results', () => {
  const wallet = cleanKukaiAttempts()
  wallet[0].health.wallet.status = 'degraded'
  wallet[0].health.wallet.findings.push({ kind: 'console-error', detail: 'undefined type' })
  assert.equal(kukaiVerdict(wallet, completeStats).status, 'workflow-passed-with-wallet-findings')
  const contract = cleanKukaiAttempts()
  contract[0].signed.response.signingType = 'raw'
  assert.equal(kukaiVerdict(contract, completeStats).status, 'workflow-passed-with-contract-findings')
  wallet[0].health.wallet.status = 'clean'
  assert.equal(kukaiVerdict(wallet, completeStats).status, 'diagnostic-failed')
})
