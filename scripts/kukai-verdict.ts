import { z } from 'zod'
import fixture from '../fixtures/account.json' with { type: 'json' }
import { deriveAddress, verifySignature } from '../lib/oracle.ts'
import { lifecycleSteps } from './lifecycle-verdict.ts'

export const kukaiSteps = lifecycleSteps
const side = z.object({
  status: z.enum(['clean', 'failed', 'degraded']),
  findings: z.array(z.object({ kind: z.string(), detail: z.string(), endpoint: z.string().optional() })),
  canceledRequests: z.array(z.unknown())
})
export const kukaiMeasurement = z.object({
  attempt: z.number().int().min(0).max(2),
  workflow: z.literal('passed'),
  steps: z.array(z.string()).refine(steps => JSON.stringify(steps) === JSON.stringify(kukaiSteps)),
  artifact: z.object({
    verified: z.literal(true),
    sourceCommit: z.literal('1b79adc438dd4b54f1526c489fcd154e1302f802'),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  browserVersion: z.string().min(1),
  account: z.object({
    address: z.literal(fixture.address), publicKey: z.literal(fixture.publicKey), network: z.literal('mainnet')
  }),
  signed: z.object({
    requestedPayload: z.literal(fixture.payload),
    response: z.object({ signature: z.string(), signingType: z.unknown().optional() })
  }),
  health: z.object({
    scope: z.literal('wallet-startup-and-post-onboarding'), dapp: side, wallet: side
  }),
  secretScan: z.object({ status: z.literal('passed') })
})
const statistics = z.object({ expected: z.literal(3), unexpected: z.literal(0), skipped: z.literal(0), flaky: z.literal(0) })

export function kukaiVerdict(values: unknown, stats: unknown) {
  const reasons: string[] = []
  const parsed = z.array(kukaiMeasurement).length(3).safeParse(values)
  if (!statistics.safeParse(stats).success) reasons.push('Require three passes with zero skips or retries')
  if (!parsed.success) {
    reasons.push('Missing or invalid complete Kukai evidence: ' + parsed.error.message)
    return { workflow: 'failed', status: 'diagnostic-failed', attempts: values, reasons }
  }
  const attempts = parsed.data
  if (new Set(attempts.map(value => value.attempt)).size !== 3) reasons.push('Require three distinct attempt IDs')
  for (const attempt of attempts) {
    if (deriveAddress(attempt.account.publicKey) !== attempt.account.address ||
        !verifySignature(fixture.payload, attempt.account.publicKey, attempt.signed.response.signature) ||
        verifySignature(fixture.payload.slice(0, -2) + '00', attempt.account.publicKey, attempt.signed.response.signature)) {
      reasons.push('Independent exact-byte signature or identity verification failed')
    }
    for (const health of [attempt.health.dapp, attempt.health.wallet]) {
      if ((health.status === 'clean') !== (health.findings.length === 0)) reasons.push('Health status disagrees with findings')
    }
  }
  if (reasons.length) return { workflow: 'failed', status: 'diagnostic-failed', attempts, reasons }
  const status = attempts.some(value => value.health.dapp.status !== 'clean') ? 'workflow-passed-with-dapp-errors'
    : attempts.some(value => value.health.wallet.status !== 'clean') ? 'workflow-passed-with-wallet-findings'
    : attempts.some(value => value.signed.response.signingType !== 'micheline') ? 'workflow-passed-with-contract-findings'
    : 'workflow-passed'
  return { workflow: 'passed', status, attempts, reasons }
}
