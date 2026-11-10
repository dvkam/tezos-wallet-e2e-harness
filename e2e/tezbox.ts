import { execFile } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import { z } from 'zod'
import { sandboxChain } from '../src/sandbox-chain'

const docker = (...args: string[]) => promisify(execFile)('docker', args, { timeout: 30_000 })
const image = 'ghcr.io/tez-capital/tezbox:tezos-v25.2@sha256:02896feb500cd5383bb9985d6812db579aebf13bace2f78a5f97a8866efe3caf'
const chainIdPath = '/chains/main/chain_id'
const genesisPath = '/chains/main/blocks/0/hash'
const injectionPath = '/injection/operation'

type RpcCall = {
  client: 'temple' | 'dapp'
  method: string
  path: string
  status: number
}

export async function startTezbox() {
  await docker('info', '--format', '{{.ServerVersion}}').catch(error => {
    throw new Error('Start Docker before running the Temple sandbox tests', { cause: error })
  })
  const runId = process.env.TEMPLE_SANDBOX_RUN_ID
  if (!runId || !/^[0-9a-f-]{36}$/.test(runId)) throw new Error('Run the sandbox through its npm command')
  await docker('image', 'inspect', image).catch(error => {
    throw new Error('Pull the pinned Tezbox image first. See the README.', { cause: error })
  })
  const name = 'temple-e2e-' + runId
  const label = 'tezos-wallet-e2e.run=' + runId
  const calls: RpcCall[] = []
  let upstreamPort: number
  let injectionAllowed = false
  const proxy = createServer((incoming, outgoing) => {
    const route = /^\/(temple|dapp)(\/(?:chains\/[^?]*|injection\/operation)(?:\?.*)?)$/.exec(incoming.url ?? '')
    const client = route?.[1]
    if (!route || (client !== 'temple' && client !== 'dapp')) {
      outgoing.writeHead(404).end()
      return
    }
    const rpcPath = route[2]
    const path = rpcPath.split('?')[0]
    const method = incoming.method ?? 'GET'
    outgoing.setHeader('Access-Control-Allow-Origin', '*')
    outgoing.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    outgoing.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (method === 'OPTIONS') {
      outgoing.writeHead(204).end()
      return
    }
    if (path === injectionPath) {
      if (method !== 'POST' || client !== 'temple' || !injectionAllowed) {
        calls.push({ client, method, path, status: 403 })
        outgoing.writeHead(403).end('The sandbox allows one approved Temple injection')
        return
      }
      injectionAllowed = false
    } else if (!/^\/chains\/[A-Za-z0-9_~/-]+$/.test(path) || !(
      method === 'GET' || (method === 'POST' && /\/helpers\/(scripts\/(run_operation|simulate_operation)|preapply\/operations|forge\/operations)$/.test(path))
    )) {
      outgoing.writeHead(403).end('RPC method or path is outside the sandbox test')
      return
    }
    const forward = httpRequest({
      hostname: '127.0.0.1', port: upstreamPort, method, path: rpcPath,
      headers: { 'content-type': incoming.headers['content-type'] ?? 'application/json' }
    }, response => {
      const status = response.statusCode ?? 502
      calls.push({ client, method, path, status })
      if (status >= 300 && status < 400) {
        response.resume()
        outgoing.writeHead(502).end('Tezbox returned an unexpected redirect')
        return
      }
      outgoing.writeHead(status, { 'Content-Type': response.headers['content-type'] ?? 'application/json' })
      response.pipe(outgoing)
    })
    forward.setTimeout(10_000, () => forward.destroy(new Error('Tezbox RPC timed out')))
    forward.on('error', () => {
      calls.push({ client, method, path, status: 502 })
      if (outgoing.headersSent) outgoing.destroy()
      else outgoing.writeHead(502).end('Tezbox RPC unavailable')
    })
    incoming.on('aborted', () => forward.destroy())
    incoming.pipe(forward)
  })
  let container: string | undefined
  async function close() {
    try {
      if (proxy.listening) await new Promise<void>((resolve, reject) => {
        proxy.close(error => error ? reject(error) : resolve())
        proxy.closeAllConnections()
      })
    } finally {
      const { stdout } = await docker('ps', '-aq', '--filter', 'name=^/' + name + '$', '--filter', 'label=' + label)
      const ownedId = stdout.trim()
      if (ownedId) await docker('rm', '-f', ownedId)
    }
  }
  try {
    const started = await docker('run', '--detach', '--rm', '--pull=never', '--name', name,
      '--label', label, '--publish', '127.0.0.1::8732', image, '--timeout=480s', 'U')
    const ownedContainer = started.stdout.trim()
    container = ownedContainer
    const mapping = (await docker('port', container, '8732/tcp')).stdout.trim()
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping)
    if (!match) throw new Error('Expected a loopback Tezbox port, got ' + mapping)
    upstreamPort = Number(match[1])
    const base = 'http://127.0.0.1:' + upstreamPort
    async function rpc(path: string) {
      const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(4000) })
      if (!response.ok) throw new Error('Tezbox RPC ' + response.status + ' at ' + path)
      const body: unknown = await response.json()
      return body
    }
    let readyError: unknown
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        if (await rpc(chainIdPath) !== sandboxChain.id || await rpc(genesisPath) !== sandboxChain.genesis) {
          throw new Error('Tezbox chain identity does not match the pinned sandbox')
        }
        // Tezbox funds Alice and Bob through block 4, then restarts the node and bakers.
        const head = z.object({ level: z.number().int() }).parse(await rpc('/chains/main/blocks/head/header'))
        if (head.level < 5) throw new Error('Tezbox has not baked a block after its bootstrap restart')
        const balance = await rpc('/chains/main/blocks/head/context/contracts/' + sandboxChain.recipient + '/balance')
        if (balance !== '50000000000') throw new Error('Tezbox bootstrap recipient balance differs from the pinned fixture')
        readyError = undefined
        break
      } catch (error) {
        readyError = error
        await setTimeout(500)
      }
    }
    if (readyError) throw new Error('Tezbox did not start on the pinned chain', { cause: readyError })
    for (const [path, expected] of [[chainIdPath, sandboxChain.id], [genesisPath, sandboxChain.genesis]]) {
      const verified = await docker('exec', container, 'octez-client', '--endpoint', 'http://127.0.0.1:8732', 'rpc', 'get', path)
      if (JSON.parse(verified.stdout) !== expected) throw new Error('Container and published RPC disagree at ' + path)
    }
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject)
      proxy.listen(0, '127.0.0.1', resolve)
    })
    const address = proxy.address()
    if (!address || typeof address === 'string') throw new Error('Tezbox proxy has no TCP address')
    const origin = 'http://127.0.0.1:' + address.port
    async function fund(address: string) {
      await docker('exec', ownedContainer, 'octez-client', '--endpoint', 'http://127.0.0.1:8732',
        '--wait', 'none', 'transfer', '5', 'from', 'alice', 'to', address, '--burn-cap', '1')
    }
    return {
      origin, calls, rpc, close, fund, image,
      async logs() {
        const { stdout, stderr } = await docker('logs', '--tail', '120', ownedContainer)
        return stdout + stderr
      },
      allowWalletInjection() { injectionAllowed = true }
    }
  } catch (error) {
    if (container) {
      await docker('logs', '--tail', '30', container).then(
        logs => console.error(logs.stdout + logs.stderr),
        cause => console.error('Could not read Tezbox logs:', cause.message)
      )
    }
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Tezbox startup and cleanup failed')
    }
    throw error
  }
}
