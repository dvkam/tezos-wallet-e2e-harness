import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { proveShadownet, shadownet, NetworkProofError } from '../lib/shadownet.ts'

const directory = 'reports/shadownet-preflight-' + randomUUID()
await mkdir(directory, { recursive: true })
try {
  const proof = await proveShadownet({
    primaryRpc: process.env.SHADOWNET_PRIMARY_RPC ?? shadownet.primaryRpc,
    observerRpc: process.env.SHADOWNET_OBSERVER_RPC ?? shadownet.observerRpc
  })
  await writeFile(directory + '/result.json', JSON.stringify({ status: 'rpc-preflight-passed', scope: 'RPC only; no wallet or injection', proof }, null, 2) + '\n')
  console.log('RPC preflight passed. ' + directory + '/result.json')
} catch (error: unknown) {
  const kind = error instanceof NetworkProofError ? error.kind : 'failed'
  await writeFile(directory + '/result.json', JSON.stringify({ status: 'failed', kind }, null, 2) + '\n')
  console.error('RPC preflight failed: ' + kind + '. ' + directory + '/result.json')
  process.exitCode = 1
}
