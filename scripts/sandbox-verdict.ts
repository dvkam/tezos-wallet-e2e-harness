import { z } from 'zod'

const evidence = z.object({
  workflow: z.enum(['passed', 'failed']),
  transfer: z.enum(['passed', 'failed', 'not-run']),
  health: z.object({
    scope: z.literal('post-onboarding'),
    dapp: z.object({
      status: z.enum(['clean', 'failed']), findings: z.array(z.unknown()), canceledRequests: z.array(z.unknown())
    }),
    wallet: z.object({
      status: z.enum(['clean', 'degraded']), findings: z.array(z.unknown()), canceledRequests: z.array(z.unknown())
    })
  }).nullable()
})

export function sandboxVerdict(value: unknown, mode: 'network' | 'transfer') {
  const result = evidence.parse(value)
  if (result.health && [result.health.dapp, result.health.wallet].some(
    ({ status, findings }) => (status === 'clean') !== (findings.length === 0)
  )) throw new Error('Sandbox health status disagrees with its findings')
  if (result.workflow === 'passed' && (!result.health || result.transfer !== (mode === 'transfer' ? 'passed' : 'not-run'))) {
    throw new Error('Sandbox evidence does not prove the requested workflow')
  }
  const status = result.workflow === 'failed' ? 'failed'
    : result.health?.dapp.status === 'failed' ? 'workflow-passed-with-dapp-errors'
    : result.health?.wallet.status === 'degraded' ? 'workflow-passed-with-wallet-findings'
    : 'workflow-passed'
  return { ...result, status }
}
