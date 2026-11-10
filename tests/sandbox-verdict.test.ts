import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sandboxVerdict } from '../scripts/sandbox-verdict.ts'

test('retains a confirmed transfer alongside dApp and wallet health findings', () => {
  const transfer = {
    workflow: 'passed', transfer: 'passed',
    health: { dapp: { status: 'clean', findings: [] }, wallet: { status: 'degraded', findings: [{ detail: '429' }] } }
  }
  const result = sandboxVerdict(transfer, 'transfer')
  assert.equal(result.status, 'workflow-passed-with-wallet-findings')
  assert.equal(result.transfer, 'passed')
  assert.deepEqual(result.health, transfer.health)
  const withDappError = { ...transfer, health: { ...transfer.health, dapp: { status: 'failed', findings: ['error'] } } }
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
    health: { dapp: { status: 'clean', findings: [{ detail: 'error' }] }, wallet: { status: 'clean', findings: [] } }
  }, 'network'), /status disagrees/)
})
