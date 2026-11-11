import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proveShadownet, shadownet, NetworkProofError } from '../lib/shadownet.ts'

const rpcs = { primaryRpc: 'https://primary.example', observerRpc: 'https://observer.example' }
const now = Date.parse('2026-11-11T12:00:05Z')
const anchor = 'BL7aN4FRNydwCVRo4KB16FibBmu6LdzuTC4hxGqyziCVRhkdFBp'
const read = async (_rpc: string, path: string): Promise<unknown> => {
  if (path.endsWith('/chain_id')) return shadownet.id
  if (path.endsWith('/blocks/0/hash')) return shadownet.genesis
  if (path.endsWith('/head/header')) return { level: 100, timestamp: '2026-11-11T12:00:00Z' }
  if (path.endsWith('/hash')) return anchor
  return { level: 98, timestamp: '2026-11-11T11:59:56Z' }
}

test('proves the pinned chain and common historical block despite different heads', async () => {
  const proof = await proveShadownet(rpcs, async (rpc, path) =>
    rpc === rpcs.observerRpc && path.endsWith('/head/header')
      ? { level: 101, timestamp: '2026-11-11T12:00:02Z' } : read(rpc, path), now)
  assert.equal(proof.id, 'NetXsqzbfFenSTS')
  assert.equal(proof.anchor.level, 98)
  assert.equal(proof.anchor.hash, anchor)
  assert.equal(proof.providers.length, 2)
})

test('stops on wrong chain, observer disagreement or unavailable RPC', async () => {
  for (const kind of ['chain-mismatch', 'provider-disagreement', 'rpc-unavailable', 'stale-head']) {
    await assert.rejects(proveShadownet(rpcs, async (rpc, path) => {
      if (kind === 'stale-head' && path.endsWith('/head/header')) return { level: 100, timestamp: '2026-11-10T12:00:00Z' }
      if (kind === 'rpc-unavailable') throw new Error('offline')
      if (kind === 'chain-mismatch' && path.endsWith('/chain_id')) return 'NetXdQprcVkpaWU'
      if (kind === 'provider-disagreement' && rpc === rpcs.observerRpc && path.includes('/98/hash')) return shadownet.genesis
      return read(rpc, path)
    }, now), error => error instanceof NetworkProofError && error.kind === kind)
  }
})

test('rejects credential-bearing RPC URLs and a shared provider hostname', async () => {
  for (const value of [
    { ...rpcs, primaryRpc: 'https://user:secret@primary.example' },
    { ...rpcs, primaryRpc: 'https://primary.example?token=secret' },
    { ...rpcs, primaryRpc: 'https://primary.example/secret' },
    { ...rpcs, observerRpc: 'https://primary.example' }
  ]) await assert.rejects(proveShadownet(value, read, now), error => error instanceof NetworkProofError && error.kind === 'invalid-config')
})

test('gateway forwards read responses but never forwards an injection or other mutation', async () => {
  const { startReadOnlyGateway } = await import('../e2e/shadownet-gateway.ts')
  const proof = await proveShadownet(rpcs, read, now)
  const upstream: string[] = []
  const gateway = await startReadOnlyGateway(proof, async input => {
    upstream.push(String(input))
    return Response.json('NetXsqzbfFenSTS')
  })
  try {
    assert.equal(await (await fetch(gateway.endpoints.temple + '/chains/main/chain_id')).json(), shadownet.id)
    assert.deepEqual(upstream, ['https://primary.example/chains/main/chain_id'])
    const options = await fetch(gateway.endpoints.dapp + '/chains/main/chain_id', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'content-type' } })
    assert.equal(options.headers.get('access-control-allow-headers'), 'content-type')
    for (const [method, route] of [
      ['POST', '/temple/injection/operation'],
      ['POST', '/dapp/chains/main/blocks/head/helpers/scripts/run_operation'],
      ['GET', '/temple/chains/main/chain_id?token=hidden']
    ]) assert.equal((await fetch(gateway.origin + route, { method })).status, 403)
    assert.equal(upstream.length, 1)
    assert.equal(gateway.calls.filter(call => call.kind === 'blocked').length, 3)
    assert.equal(JSON.stringify(gateway.calls).includes('hidden'), false)
  } finally { await gateway.close() }
})

test('verdict requires both actual client observations and rejects blocked attempts', async () => {
  const { shadownetVerdict } = await import('../scripts/shadownet-verdict.ts')
  const appOrigin = 'http://127.0.0.1:1234'
  const extensionOrigin = 'chrome-extension://' + 'a'.repeat(32)
  const evidence = {
    workflow: 'passed', transfer: 'not-run',
    health: { scope: 'post-onboarding', dapp: { status: 'clean', findings: [], canceledRequests: [] }, wallet: { status: 'clean', findings: [], canceledRequests: [] } },
    rpc: { status: 'verified', proof: await proveShadownet(rpcs, read, now) },
    appOrigin, extensionOrigin, injections: [],
    observed: [{ client: 'temple', origin: extensionOrigin, chain: shadownet.id }, { client: 'dapp', origin: appOrigin, chain: shadownet.id }],
    calls: ['temple', 'dapp'].map(client => ({ client, method: 'GET', path: '/chains/main/chain_id', status: 200, kind: 'rpc' }))
  }
  assert.equal(shadownetVerdict(evidence).status, 'workflow-passed')
  assert.equal(shadownetVerdict({ ...evidence, calls: [...evidence.calls, { client: 'temple', method: 'GET', path: '/chains/main/blocks/head/header', status: 429, kind: 'rpc' }] }).status, 'workflow-passed-with-rpc-findings')
  assert.throws(() => shadownetVerdict({ ...evidence, injections: ['https://other.example/injection/operation'] }), /read-only/)
  assert.throws(() => shadownetVerdict({ ...evidence, observed: evidence.observed.slice(0, 1) }), /actual client/)
  assert.throws(() => shadownetVerdict({ ...evidence, calls: [...evidence.calls, { client: 'unknown', method: 'POST', path: 'blocked', status: 403, kind: 'blocked' }] }), /read-only/)
  assert.equal(shadownetVerdict({ ...evidence, health: { ...evidence.health, wallet: { status: 'degraded', findings: ['429'], canceledRequests: [] } } }).status, 'workflow-passed-with-wallet-findings')
})

test('closing the gateway settles owned reads before evidence is finalized', async () => {
  const { startReadOnlyGateway } = await import('../e2e/shadownet-gateway.ts')
  const proof = await proveShadownet(rpcs, read, now)
  let entered = () => {}
  const started = new Promise<void>(resolve => { entered = resolve })
  const gateway = await startReadOnlyGateway(proof, async (_input, init) => {
    entered()
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('closed')), { once: true })
    })
  })
  const request = fetch(gateway.endpoints.temple + '/chains/main/chain_id').catch(() => undefined)
  await started
  await gateway.close()
  await request
  assert.equal(gateway.calls.length, 1)
  assert.equal(gateway.calls[0].kind, 'canceled')
  const final = JSON.stringify(gateway.calls)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(JSON.stringify(gateway.calls), final)
  await gateway.close()
})
