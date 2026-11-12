import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { publishAdapterResult } from '../scripts/adapter-publication.mjs'
import { createHash } from 'node:crypto'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { kukaiVerdict } from '../scripts/kukai-verdict.ts'
import { cleanKukaiAttempts, completeStats } from './kukai-fixture.ts'

const files = ['scripts/kukai-verdict.ts', 'scripts/run-adapter.mjs', 'e2e/kukai.spec.ts',
  'formal/AdapterPublication.tla', 'scripts/adapter-publication.mjs', 'scripts/adapter-cleanup.mjs']
const before = await Promise.all(files.map(file => readFile(file, 'utf8')))
let cases = 0
// Exhaust every subset of these six independent evidence failures against the real validator.
for (let mask = 0; mask < 64; mask++) {
  const attempts = cleanKukaiAttempts()
  if (mask & 1) attempts[1].attempt = 0
  if (mask & 2) attempts[0].signed.response.signature = 'invalid'
  if (mask & 4) attempts[0].steps.pop()
  if (mask & 8) attempts[0].signed.response.signingType = 'raw'
  if (mask & 16) {
    attempts[0].health.wallet.status = 'degraded'
    attempts[0].health.wallet.findings.push({ kind: 'console-error', detail: 'control' })
  }
  const stats = mask & 32 ? { ...completeStats, skipped: 1 } : completeStats
  assert.equal(kukaiVerdict(attempts, stats).status === 'workflow-passed', mask === 0)
  cases++
}
const controls = [
  ["if (!statistics.safeParse(stats).success)", 'if (false)', 'statistics',
    () => [cleanKukaiAttempts(), { ...completeStats, skipped: 1 }]],
  ["if (new Set(attempts.map(value => value.attempt)).size !== 3)", 'if (false)', 'duplicate attempt',
    () => { const v = cleanKukaiAttempts(); v[1].attempt = 0; return [v, completeStats] }],
  ["!verifySignature(fixture.payload, attempt.account.publicKey, attempt.signed.response.signature)", 'false', 'signature',
    () => { const v = cleanKukaiAttempts(); v[0].signed.response.signature = 'invalid'; return [v, completeStats] }],
  ["attempts.some(value => value.health.wallet.status !== 'clean')", 'false', 'wallet health',
    () => { const v = cleanKukaiAttempts(); v[0].health.wallet.status = 'degraded'; v[0].health.wallet.findings.push({kind:'console-error',detail:'control'}); return [v,completeStats] }]
] as const
for (const [needle, replacement, name, data] of controls) {
  assert.ok(before[0].includes(needle), 'Mutation source drift: ' + name)
  // Resolve local imports while evaluating the actual validator with one guard removed.
  const require = createRequire(import.meta.url)
  const source = before[0].replace(needle, replacement)
    .replace("from 'zod'", 'from ' + JSON.stringify(pathToFileURL(require.resolve('zod')).href))
    .replace("import fixture from '../fixtures/account.json' with { type: 'json' }",
      'const fixture = ' + JSON.stringify(cleanKukaiAttempts()[0].account).replace(/}$/, ',"payload":' + JSON.stringify(cleanKukaiAttempts()[0].signed.requestedPayload) + '}'))
    .replace("from '../lib/oracle.ts'", "from " + JSON.stringify(new URL('../lib/oracle.ts', import.meta.url).href))
    .replace("from './lifecycle-verdict.ts'", "from " + JSON.stringify(new URL('../scripts/lifecycle-verdict.ts', import.meta.url).href))
  const module = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  const [values, stats] = data()
  assert.equal(module.kukaiVerdict(values, stats).status, 'workflow-passed', 'Mutation did not produce false acceptance: ' + name)
}
const directory = await mkdtemp(path.join(tmpdir(), 'adapter-publication-control-'))
try {
  const destination = path.join(directory, 'result.json')
  for (const interrupted of [false, true])
  for (const status of ['workflow-passed', 'failed', 'workflow-passed-with-wallet-findings']) {
    const report = { status }
    assert.equal(publishAdapterResult(report, interrupted, destination),
      !interrupted && status === 'workflow-passed' ? 0 : 1)
    assert.equal(JSON.parse(await readFile(destination, 'utf8')).status, interrupted ? 'interrupted' : status)
    cases++
  }
  const source = before[4].replace("if (interrupted) report.status = 'interrupted'", 'if (false) report.status = "interrupted"')
    .replace("from 'node:fs'", "from 'node:fs'")
  assert.notEqual(source, before[4], 'Publication mutation source drift')
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  assert.equal(module.publishAdapterResult({ status: 'workflow-passed' }, true, destination), 0,
    'Removed guard must reproduce a false clean publication')
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).status, 'workflow-passed')
} finally { await rm(directory, { recursive: true, force: true }) }
assert.ok(before[1].includes("process.exitCode = publishAdapterResult(report, interrupted, path.join(directory, 'result.json'))"),
  'Runner must call the verified synchronous publisher')
assert.deepEqual(await Promise.all(files.map(file => readFile(file, 'utf8'))), before, 'Source changed during verification')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
console.log(JSON.stringify({ cases, killedMutants: controls.length + 1,
  sourceSha256: Object.fromEntries(files.map((name, i) => [name, hash(before[i])])) }, null, 2))
