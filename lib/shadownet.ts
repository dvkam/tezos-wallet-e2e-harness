import { z } from 'zod'

export const shadownet = Object.freeze({
  id: 'NetXsqzbfFenSTS',
  genesis: 'BMJTFWBgqGUzsvW4JLS1XuCYnpH18pBsLb5UvPCv2eiNC5vUeps',
  primaryRpc: 'https://rpc.shadownet.teztnets.com',
  observerRpc: 'https://tezos-shadownet.octez.io'
})
const configSchema = z.object({ primaryRpc: z.string(), observerRpc: z.string() })
const headerSchema = z.object({ level: z.number().int().nonnegative(), timestamp: z.iso.datetime() })
const hashSchema = z.string().regex(/^B[1-9A-HJ-NP-Za-km-z]+$/)
type ProofFailure = 'invalid-config' | 'rpc-unavailable' | 'rpc-invalid-response' | 'chain-mismatch' | 'provider-disagreement' | 'stale-head'
export class NetworkProofError extends Error {
  readonly kind: ProofFailure
  constructor(kind: ProofFailure) { super(kind); this.name = 'NetworkProofError'; this.kind = kind }
}
export function parseShadownetRpcs(value: unknown) {
  try {
    const parsed = configSchema.parse(value)
    const normalize = (input: string) => {
      const url = new URL(input)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
      return url.href.replace(/\/$/, '')
    }
    const result = { primaryRpc: normalize(parsed.primaryRpc), observerRpc: normalize(parsed.observerRpc) }
    if (new URL(result.primaryRpc).hostname === new URL(result.observerRpc).hostname) throw new Error()
    return result
  } catch { throw new NetworkProofError('invalid-config') }
}
export type RpcRead = (rpc: string, path: string) => Promise<unknown>
export const readRpc: RpcRead = async (rpc, path) => {
  try {
    const response = await fetch(rpc + path, { signal: AbortSignal.timeout(10_000), redirect: 'error' })
    if (!response.ok) throw new Error()
    return await response.json()
  } catch { throw new NetworkProofError('rpc-unavailable') }
}
export async function proveShadownet(value: unknown, get: RpcRead = readRpc, now = Date.now()) {
  const config = parseShadownetRpcs(value)
  const providers = [config.primaryRpc, config.observerRpc]
  const checked: RpcRead = async (rpc, path) => {
    try { return await get(rpc, path) }
    catch { throw new NetworkProofError('rpc-unavailable') }
  }
  try {
    const heads = await Promise.all(providers.map(async rpc => {
      const [id, genesis, header] = await Promise.all([
        checked(rpc, '/chains/main/chain_id'),
        checked(rpc, '/chains/main/blocks/0/hash'),
        checked(rpc, '/chains/main/blocks/head/header')
      ])
      if (id !== shadownet.id || genesis !== shadownet.genesis) throw new NetworkProofError('chain-mismatch')
      const parsed = headerSchema.parse(header)
      const age = now - Date.parse(parsed.timestamp)
      if (age > 600_000 || age < -60_000) throw new NetworkProofError('stale-head')
      return { rpc, ...parsed }
    }))
    const level = Math.min(...heads.map(head => head.level)) - 2
    if (level < 1) throw new NetworkProofError('rpc-invalid-response')
    const hashes = await Promise.all(providers.map(async rpc =>
      hashSchema.parse(await checked(rpc, '/chains/main/blocks/' + level + '/hash'))))
    if (hashes[0] !== hashes[1]) throw new NetworkProofError('provider-disagreement')
    const hash = hashes[0]
    const headers = await Promise.all(providers.map(async rpc =>
      headerSchema.parse(await checked(rpc, '/chains/main/blocks/' + hash + '/header'))))
    if (headers.some(header => header.level !== level || header.timestamp !== headers[0].timestamp)) {
      throw new NetworkProofError('provider-disagreement')
    }
    return { id: shadownet.id, genesis: shadownet.genesis, providers: heads, anchor: { level, hash, timestamp: headers[0].timestamp } }
  } catch (error: unknown) {
    if (error instanceof NetworkProofError) throw error
    throw new NetworkProofError('rpc-invalid-response')
  }
}
