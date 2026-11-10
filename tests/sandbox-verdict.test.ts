import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consoleOrigin } from '../e2e/sandbox-health.ts'
import { sandboxVerdict } from '../scripts/sandbox-verdict.ts'

test('retains a confirmed transfer alongside dApp and wallet health findings', () => {
  const transfer = {
    workflow: 'passed', transfer: 'passed',
    health: { scope: 'post-onboarding', dapp: { status: 'clean', findings: [], canceledRequests: [] }, wallet: { status: 'degraded', findings: [{ detail: '429' }], canceledRequests: [] } }
  }
  const result = sandboxVerdict(transfer, 'transfer')
  assert.equal(result.status, 'workflow-passed-with-wallet-findings')
  assert.equal(result.transfer, 'passed')
  assert.deepEqual(result.health, transfer.health)
  const withDappError = { ...transfer, health: { ...transfer.health, dapp: { status: 'failed', findings: ['error'], canceledRequests: [] } } }
  assert.equal(sandboxVerdict(withDappError, 'transfer').status, 'workflow-passed-with-dapp-errors')
})

test('requires health evidence and the requested operation outcome for a workflow pass', () => {
  const result = { workflow: 'passed', transfer: 'not-run', health: null }
  assert.throws(() => sandboxVerdict(result, 'network'), /does not prove/)
  assert.throws(() => sandboxVerdict(result, 'transfer'), /does not prove/)
  assert.equal(sandboxVerdict({ ...result, workflow: 'failed' }, 'network').status, 'failed')
})

test('cannot report clean health alongside recorded errors', () => {
  assert.throws(() => sandboxVerdict({
    workflow: 'passed', transfer: 'not-run',
    health: { scope: 'post-onboarding', dapp: { status: 'clean', findings: [{ detail: 'error' }], canceledRequests: [] }, wallet: { status: 'clean', findings: [], canceledRequests: [] } }
  }, 'network'), /status disagrees/)
})

test('keeps a cancellation visible without counting it as a health failure', () => {
  const canceledRequests = [{ detail: 'net::ERR_ABORTED' }]
  const result = sandboxVerdict({
    workflow: 'passed', transfer: 'not-run',
    health: {
      scope: 'post-onboarding',
      dapp: { status: 'clean', findings: [], canceledRequests: [] },
      wallet: { status: 'clean', findings: [], canceledRequests }
    }
  }, 'network')
  assert.equal(result.status, 'workflow-passed')
  assert.deepEqual(result.health?.wallet.canceledRequests, canceledRequests)
})

test('attributes Temple content-script errors to the wallet on a dApp page', () => {
  const wallet = 'chrome-extension://' + 'a'.repeat(32)
  const dapp = 'http://127.0.0.1:19000'
  assert.equal(consoleOrigin(wallet, { page: dapp, source: wallet + '/scripts/main.js' }), wallet)
  assert.equal(consoleOrigin(wallet, { page: dapp, source: 'https://example.org/script.js' }), dapp)
  assert.equal(consoleOrigin(wallet, { worker: wallet + '/worker.js', source: '' }), wallet)
})
