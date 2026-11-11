import { z } from 'zod'
import { sandboxVerdict } from './sandbox-verdict.ts'
import { shadownet } from '../lib/shadownet.ts'

const schema = z.object({
  rpc: z.discriminatedUnion('status', [
    z.object({ status: z.literal('verified'), proof: z.object({
      id: z.literal(shadownet.id), genesis: z.literal(shadownet.genesis),
      anchor: z.object({ level: z.number().int().positive(), hash: z.string().min(1) })
    }) }),
    z.object({ status: z.literal('failed'), kind: z.string() })
  ]),
  appOrigin: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  extensionOrigin: z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/).optional(),
  injections: z.array(z.string()),
  observed: z.array(z.object({ client: z.enum(['temple', 'dapp']), origin: z.string(), chain: z.unknown() })),
  calls: z.array(z.object({
    client: z.enum(['temple', 'dapp', 'unknown']), method: z.string(),
    path: z.string(), status: z.number().int(), kind: z.enum(['rpc', 'blocked', 'unavailable', 'canceled'])
  }))
})
export function shadownetVerdict(value: unknown) {
  const result = sandboxVerdict(value, 'network')
  const network = schema.parse(value)
  if (result.workflow === 'passed') {
    if (network.injections.length || !network.extensionOrigin || network.rpc.status !== 'verified' || network.calls.some(call => call.kind === 'blocked' || call.method !== 'GET')) {
      throw new Error('Shadownet evidence does not prove a read-only workflow')
    }
    for (const client of ['temple', 'dapp']) {
      const origin = client === 'temple' ? network.extensionOrigin : network.appOrigin
      if (!network.observed.some(event => event.client === client && event.origin === origin && event.chain === shadownet.id) ||
          !network.calls.some(call => call.client === client && call.path === '/chains/main/chain_id' && call.status === 200)) {
        throw new Error('Shadownet evidence lacks actual client network observations')
      }
    }
  }
  const rpcDegraded = network.calls.some(call => call.kind !== 'canceled' && (call.kind === 'unavailable' || call.status >= 400))
  return { ...result, network, status: result.status === 'workflow-passed' && rpcDegraded ? 'workflow-passed-with-rpc-findings' : result.status }
}
