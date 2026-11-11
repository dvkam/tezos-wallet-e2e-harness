import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lifecycleVerdict, lifecycleSteps } from '../scripts/lifecycle-verdict.ts'

const clean = { status: 'clean', findings: [], canceledRequests: [] }
export function attempt(index: number) {
  return {
    attempt: index, workflow: 'passed', steps: [...lifecycleSteps],
    signingTypeContract: { expected: 'micheline', observed: 'micheline' },
    health: { scope: 'post-onboarding', dapp: clean, wallet: clean }
  }
}
const stats = { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }
test('requires three distinct complete attempts rather than trusting summary statistics', () => {
  const all = [attempt(0), attempt(1), attempt(2)]
  assert.equal(lifecycleVerdict(all, stats).status, 'workflow-passed')
  assert.throws(() => lifecycleVerdict(all.slice(0, 2), stats), /three/)
  assert.throws(() => lifecycleVerdict([all[0], all[0], all[2]], stats), /distinct/)
  assert.throws(() => lifecycleVerdict([{ ...all[0], steps: [] }, ...all.slice(1)], stats), /steps/)
  assert.throws(() => lifecycleVerdict(all, { ...stats, skipped: 1 }), /statistics/)
})
test('retains protocol success but cannot accept wallet health or response-contract failures', () => {
  const first = attempt(0)
  const walletFailure = { ...first, health: { ...first.health, wallet: { ...clean, status: 'degraded', findings: [{ detail: 'HTTP 429' }] } } }
  const result = lifecycleVerdict([walletFailure, attempt(1), attempt(2)], stats)
  assert.equal(result.workflow, 'passed')
  assert.equal(result.status, 'workflow-passed-with-wallet-findings')
  const contract = { ...first, signingTypeContract: { expected: 'micheline', observed: null } }
  assert.equal(lifecycleVerdict([contract, attempt(1), attempt(2)], stats).status, 'workflow-passed-with-contract-findings')
  assert.throws(() => lifecycleVerdict([{ ...walletFailure, health: { ...walletFailure.health, wallet: { ...walletFailure.health.wallet, status: 'clean' } } }, attempt(1), attempt(2)], stats), /disagrees/)
})
