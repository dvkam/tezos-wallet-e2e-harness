import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kukaiVerdict } from '../scripts/kukai-verdict.ts'
import { cleanKukaiAttempts, completeStats } from '../formal/kukai-fixture.ts'

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
