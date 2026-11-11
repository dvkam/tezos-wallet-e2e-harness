import { z } from 'zod'

export const lifecycleSteps = [
  'onboarded public test account',
  'permission rejected; account remains absent',
  'permission recovery; exact independent identity',
  'authorized account survives reload',
  'signature verified; changed-payload negative control rejected',
  'signing rejected; account preserved',
  'disconnect clears account across reload'
] as const

const healthSide = z.object({
  status: z.enum(['clean', 'failed', 'degraded']),
  findings: z.array(z.unknown()), canceledRequests: z.array(z.unknown())
})
const measurement = z.object({
  attempt: z.number().int().min(0).max(2),
  workflow: z.literal('passed'),
  steps: z.array(z.string()).refine(value => JSON.stringify(value) === JSON.stringify(lifecycleSteps), 'Incomplete lifecycle steps'),
  signingTypeContract: z.object({ expected: z.literal('micheline'), observed: z.string().nullable() }),
  health: z.object({ scope: z.literal('post-onboarding'), dapp: healthSide, wallet: healthSide })
})
const statistics = z.object({ expected: z.literal(3), unexpected: z.literal(0), skipped: z.literal(0), flaky: z.literal(0) })

export function lifecycleVerdict(values: unknown, stats: unknown) {
  if (!statistics.safeParse(stats).success) throw new Error('Lifecycle statistics require three passes with zero skips or retries')
  const attempts = z.array(measurement).length(3, 'Expected three lifecycle measurements').parse(values)
  if (new Set(attempts.map(value => value.attempt)).size !== 3) throw new Error('Expected three distinct attempt IDs')
  for (const { health } of attempts) {
    for (const side of [health.dapp, health.wallet]) {
      if ((side.status === 'clean') !== (side.findings.length === 0)) throw new Error('Health status disagrees with findings')
    }
  }
  const dappErrors = attempts.some(value => value.health.dapp.status !== 'clean')
  const walletErrors = attempts.some(value => value.health.wallet.status !== 'clean')
  const contractErrors = attempts.some(value => value.signingTypeContract.observed !== value.signingTypeContract.expected)
  const status = dappErrors ? 'workflow-passed-with-dapp-errors'
    : walletErrors ? 'workflow-passed-with-wallet-findings'
    : contractErrors ? 'workflow-passed-with-contract-findings'
    : 'workflow-passed'
  return { workflow: 'passed', status, attempts }
}
