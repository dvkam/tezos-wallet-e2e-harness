import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { deriveAddress, verifySignature } from '../lib/oracle.ts'

export const umamiSteps = Object.freeze([
  'onboarded public test account',
  'permission rejected; account remains absent',
  'permission recovery; exact independent identity',
  'authorized account survives reload',
  'signature verified; changed-payload negative control rejected',
  'disconnect clears account across reload',
  'permission recovery after disconnect; exact independent identity',
  'signing rejected; wallet revokes connection as declared',
  'permission recovery after signing rejection; exact independent identity and signature'
])
const fixture = z.object({ address: z.string(), publicKey: z.string(), payload: z.string() })
  .parse(JSON.parse(await readFile(new URL('../fixtures/account.json', import.meta.url), 'utf8')))
const identity = z.object({ address: z.string(), publicKey: z.string(), network: z.literal('mainnet') })
const side = z.object({ status: z.enum(['clean', 'failed', 'degraded']), findings: z.array(z.unknown()), canceledRequests: z.array(z.unknown()) })
export const umamiArtifactSchema = z.object({
  name: z.literal('Umami'), version: z.literal('2.3.8'),
  sourceCommit: z.literal('771e1d34ac714899a0056079f5d0e764bce427ef'),
  archiveSha256: z.literal('98c67e59a5f716cef4ea24b5039143fd72ad038dfc21028233210f5252fa5a5f'),
  extractedFileCount: z.number().int().positive(), extractedTreeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractedFilesMatchArchive: z.literal(true), executableSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
export const umamiMeasurementSchema = z.object({
  attempt: z.number().int().min(0).max(2), wallet: z.literal('umami'), picker: z.literal('p2p'),
  workflow: z.enum(['passed', 'failed']), stage: z.string(), steps: z.array(z.string()),
  artifact: umamiArtifactSchema.optional(), walletRuntimeVersion: z.string().optional(),
  consumerBrowserVersion: z.string().optional(), account: identity.optional(),
  signedRequests: z.array(z.object({ id: z.string().min(1), signature: z.string(), requestedPayload: z.string() })),
  signingTypeContract: z.object({ expected: z.literal('micheline'), observed: z.unknown() }).optional(),
  disconnectContract: z.object({ status: z.literal('passed'), accountAfterReload: z.null() }).optional(),
  signingRejectionContract: z.object({ status: z.literal('passed'), observedAccount: z.null(), code: z.literal('ABORTED_ERROR') }).optional(),
  recoveryAfterSigningRejection: z.object({ status: z.literal('passed'), account: identity, secondSignatureVerified: z.literal(true) }).optional(),
  secretScan: z.object({ status: z.enum(['passed', 'failed', 'not-run']) }).optional(),
  health: z.object({ scope: z.literal('after-CDP-attachment-including-onboarding'), dapp: side, wallet: side }).nullable()
}).passthrough()
const statistics = z.object({ expected: z.number().int().nonnegative(), unexpected: z.number().int().nonnegative(), skipped: z.literal(0), flaky: z.literal(0) })

export function umamiVerdict(values: unknown, stats: unknown) {
  const attempts = z.array(umamiMeasurementSchema).length(3).parse(values)
  const counts = statistics.parse(stats)
  if (new Set(attempts.map(attempt => attempt.attempt)).size !== 3) throw new Error('Expected three distinct Umami attempts')
  if (counts.expected + counts.unexpected !== 3) throw new Error('Umami statistics do not account for all attempts')
  for (const attempt of attempts) for (const health of attempt.health ? [attempt.health.dapp, attempt.health.wallet] : []) {
    if ((health.status === 'clean') !== (health.findings.length === 0)) throw new Error('Umami health status disagrees with evidence')
  }
  const reasons: string[] = []
  if (attempts.some(attempt => attempt.workflow !== 'passed') || counts.expected !== 3 || counts.unexpected !== 0) {
    reasons.push('One or more diagnostic workflows did not complete')
  }
  for (const attempt of attempts.filter(attempt => attempt.workflow === 'passed')) {
    if (JSON.stringify(attempt.steps) !== JSON.stringify(umamiSteps)) reasons.push('Incomplete or reordered workflow steps')
    if (!attempt.artifact || !attempt.walletRuntimeVersion || !attempt.consumerBrowserVersion || !attempt.health || attempt.secretScan?.status !== 'passed') reasons.push('Missing artifact, runtime or health evidence')
    if (deriveAddress(fixture.publicKey) !== fixture.address ||
        attempt.account?.address !== fixture.address || attempt.account.publicKey !== fixture.publicKey) reasons.push('Incorrect account identity')
    if (attempt.signedRequests.length !== 2 || new Set(attempt.signedRequests.map(request => request.id)).size !== 2 ||
        attempt.signedRequests.some(request => request.requestedPayload !== fixture.payload ||
          !verifySignature(fixture.payload, fixture.publicKey, request.signature) ||
          verifySignature(fixture.payload.slice(0, -2) + '00', fixture.publicKey, request.signature))) reasons.push('Missing or invalid independent signature evidence')
    if (!attempt.disconnectContract || !attempt.signingRejectionContract ||
        !attempt.recoveryAfterSigningRejection || attempt.recoveryAfterSigningRejection.account.address !== fixture.address ||
        attempt.recoveryAfterSigningRejection.account.publicKey !== fixture.publicKey) reasons.push('Missing rejection or disconnect recovery evidence')
  }
  const workflow = reasons.length ? 'failed' : 'passed'
  const status = workflow === 'failed' ? 'diagnostic-failed'
    : attempts.some(attempt => attempt.health?.dapp.status !== 'clean') ? 'workflow-passed-with-dapp-errors'
    : attempts.some(attempt => attempt.health?.wallet.status !== 'clean') ? 'workflow-passed-with-wallet-findings'
    : attempts.some(attempt => attempt.signingTypeContract?.observed !== 'micheline') ? 'workflow-passed-with-contract-findings'
    : 'workflow-passed'
  return { workflow, status, attempts, reasons }
}
