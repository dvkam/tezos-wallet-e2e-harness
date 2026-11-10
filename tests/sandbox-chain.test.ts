import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sandboxRpc } from '../src/sandbox-chain.ts'

test('sandbox RPC endpoints are confined to one explicit loopback port', () => {
  assert.deepEqual(sandboxRpc('http://127.0.0.1:19000'), {
    temple: 'http://127.0.0.1:19000/temple',
    dapp: 'http://127.0.0.1:19000/dapp'
  })
  for (const origin of [
    null, 'https://127.0.0.1:19000', 'http://localhost:19000', 'http://127.0.0.1:19000/',
    'http://127.0.0.1:19000@tezos.example', 'http://127.0.0.1:80', 'http://127.0.0.1:65536'
  ]) assert.throws(() => sandboxRpc(origin))
})
