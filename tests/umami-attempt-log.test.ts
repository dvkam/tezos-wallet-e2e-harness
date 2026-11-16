import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAttemptLog } from '../e2e/umami/attempt-log.ts'

test('a finding keeps its workflow phase and the wallet action that was running', async () => {
  let clock = 1000
  const log = createAttemptLog(() => clock)
  log.enter('signing-rejection')
  clock = 1250
  log.record('wallet', { kind: 'pageerror', message: 'No matching request found!' })
  log.enter('recovery-after-signing-rejection')
  await log.during('permission-popup', async () => {
    clock = 4000
    log.record('wallet', { kind: 'http', url: 'https://api.example/v1', status: 400 })
  })

  assert.deepEqual(log.health('wallet'), {
    status: 'degraded',
    findings: [
      { kind: 'pageerror', message: 'No matching request found!', source: 'wallet', atMs: 250, stage: 'signing-rejection', action: null },
      { kind: 'http', url: 'https://api.example/v1', status: 400, source: 'wallet', atMs: 3000, stage: 'recovery-after-signing-rejection', action: 'permission-popup' }
    ],
    canceledRequests: []
  })
  log.enter('completed')
  assert.deepEqual(log.position(), { stage: 'completed', action: null })
})

test('a finding after a wallet action has finished is not attributed to it', async () => {
  const log = createAttemptLog(() => 0)
  log.enter('permission-rejection')
  const result = await log.during('permission-popup', async () => 'rejected')
  log.record('wallet', { kind: 'console', message: 'late error' })

  assert.equal(result, 'rejected')
  assert.deepEqual(log.position(), { stage: 'permission-rejection', action: null })
  assert.equal(log.health('wallet').findings[0]?.action, null)
})

test('a wallet action that fails stays the position where the attempt ended', async () => {
  const log = createAttemptLog(() => 0)
  log.enter('signing-approval')
  await assert.rejects(log.during('signing-unlock', async () => { throw new Error('unlock failed') }), /unlock failed/)

  assert.deepEqual(log.position(), { stage: 'signing-approval', action: 'signing-unlock' })
})

test('a canceled navigation request stays visible without degrading either side', () => {
  const log = createAttemptLog(() => 0)
  log.record('consumer', { kind: 'network', url: 'https://relay.example/sync', error: 'net::ERR_ABORTED' })
  log.record('wallet', { kind: 'network', url: 'https://rpc.example/head', error: 'net::ERR_NAME_NOT_RESOLVED' })

  const consumer = log.health('consumer')
  assert.equal(consumer.status, 'clean')
  assert.equal(consumer.findings.length, 0)
  assert.equal(consumer.canceledRequests.length, 1)
  const wallet = log.health('wallet')
  assert.equal(wallet.status, 'degraded')
  assert.equal(wallet.findings.length, 1)
  assert.equal(wallet.canceledRequests.length, 0)
})
