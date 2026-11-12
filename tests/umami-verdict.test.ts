import assert from 'node:assert/strict'
import { test } from 'node:test'
import { umamiVerdict } from '../scripts/umami-verdict.ts'

test('three incomplete Umami attempts remain diagnostic failures with their stages', () => {
  const attempts = [0, 1, 2].map(attempt => ({
    attempt, wallet: 'umami', picker: 'p2p', workflow: 'failed',
    stage: attempt === 0 ? 'permission-popup' : 'recovery-after-signing-rejection',
    steps: ['onboarded public test account'], signedRequests: [], health: null
  }))
  const result = umamiVerdict(attempts, { expected: 0, unexpected: 3, skipped: 0, flaky: 0 })
  assert.equal(result.status, 'diagnostic-failed')
  assert.equal(result.attempts.length, 3)
  assert.equal(result.attempts[1].stage, 'recovery-after-signing-rejection')
})
