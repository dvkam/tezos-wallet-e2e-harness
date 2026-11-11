import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { proveShadownet } from '../lib/shadownet.ts'

type ChainProof = Awaited<ReturnType<typeof proveShadownet>>
interface GatewayCall {
  client: 'temple' | 'dapp' | 'unknown'
  method: string
  path: string
  status: number
  kind: 'rpc' | 'blocked' | 'unavailable' | 'canceled'
}
export async function startReadOnlyGateway(proof: ChainProof, forward: typeof fetch = fetch) {
  const calls: GatewayCall[] = []
  const active = new Set<AbortController>()
  const pending = new Set<Promise<void>>()
  let closing = false
  let closed: Promise<void> | undefined
  const rpc = proof.providers[0].rpc
  async function serve(incoming: IncomingMessage, outgoing: ServerResponse) {
    const method = incoming.method ?? 'GET'
    const route = /^\/(temple|dapp)(\/chains\/[A-Za-z0-9_~/-]+)$/.exec(incoming.url ?? '')
    const client = route?.[1] === 'temple' ? 'temple' : route?.[1] === 'dapp' ? 'dapp' : 'unknown'
    outgoing.setHeader('Access-Control-Allow-Origin', '*')
    outgoing.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    outgoing.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (method === 'OPTIONS') { outgoing.writeHead(204).end(); return }
    if (method !== 'GET' || !route || closing) {
      calls.push({ client, method, path: 'blocked', status: 403, kind: 'blocked' })
      outgoing.writeHead(403).end('This Shadownet command is read-only')
      return
    }
    const path = route[2]
    const controller = new AbortController()
    active.add(controller)
    try {
      const response = await forward(rpc + path, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), redirect: 'error'
      })
      const body = Buffer.from(await response.arrayBuffer())
      calls.push({ client, method, path, status: response.status, kind: 'rpc' })
      if (!outgoing.destroyed) outgoing.writeHead(response.status, { 'Content-Type': 'application/json' }).end(body)
    } catch {
      const canceled = controller.signal.aborted
      calls.push({ client, method, path, status: canceled ? 499 : 502, kind: canceled ? 'canceled' : 'unavailable' })
      if (!outgoing.destroyed) outgoing.writeHead(canceled ? 499 : 502).end(canceled ? 'Gateway closed' : 'Shadownet RPC unavailable')
    } finally { active.delete(controller) }
  }
  const server = createServer((incoming, outgoing) => {
    const task = serve(incoming, outgoing)
    pending.add(task)
    void task.finally(() => pending.delete(task)).catch(() => outgoing.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Read-only gateway has no loopback address')
  const origin = 'http://127.0.0.1:' + address.port
  return {
    origin,
    endpoints: { temple: origin + '/temple', dapp: origin + '/dapp' },
    calls,
    close: () => {
      if (!closed) {
        closing = true
        const serverClosed = new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
          server.closeAllConnections()
        })
        for (const controller of active) controller.abort()
        closed = Promise.all([serverClosed, ...pending]).then(() => undefined)
      }
      return closed
    }
  }
}
