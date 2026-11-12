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
import {completeAttempts,passedStats} from './umami-fixture.ts'
test('completed evidence passes only with independent signatures and exact identity',()=>{
  assert.equal(umamiVerdict(completeAttempts(),passedStats).status,'workflow-passed')
  const changed=completeAttempts()
  changed[0]!.signedRequests[1]!.requestedPayload+='00'
  assert.equal(umamiVerdict(changed,passedStats).status,'diagnostic-failed')
})
test('reported success cannot replace missing or stale public signature evidence',()=>{
  const attempts=completeAttempts()
  attempts[1]!.signedRequests[1]!.id='first'
  assert.equal(umamiVerdict(attempts,passedStats).status,'diagnostic-failed')
})
test('valid cryptography remains visible while metadata and wallet health keep acceptance non-green',()=>{
  const attempts=completeAttempts()
  attempts[0]!.signingTypeContract.observed='missing'
  const metadata=umamiVerdict(attempts,passedStats)
  assert.equal(metadata.workflow,'passed')
  assert.equal(metadata.status,'workflow-passed-with-contract-findings')
  const health=completeAttempts()
  const findings=health.map(attempt=>({...attempt,health:{...attempt.health,wallet:{status:'degraded',findings:['DNS failure'],canceledRequests:[]}}}))
  assert.equal(umamiVerdict(findings,passedStats).status,'workflow-passed-with-wallet-findings')
})
