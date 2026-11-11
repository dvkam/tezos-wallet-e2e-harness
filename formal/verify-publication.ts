import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { lifecycleVerdict, lifecycleSteps } from '../scripts/lifecycle-verdict.ts'
import { validateGraph } from '../scripts/consumer-graph.ts'

const paths = ['scripts/lifecycle-verdict.ts', 'scripts/consumer-graph.ts']
const before = await Promise.all(paths.map(name => readFile(name, 'utf8')))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const stats = { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }
const clean = { status: 'clean', findings: [], canceledRequests: [] }
let checked = 0

// Exhaust the declared finite domain against the real production validator.
function lifecycleCounterexamples(check: typeof lifecycleVerdict) {
  let counterexamples = 0
  for (const count of [0, 1, 2, 3, 4])
  for (const duplicate of [false, true])
  for (const healthy of [true, false])
  for (const contract of [true, false])
  for (const statistics of [true, false])
  for (const complete of [true, false]) {
    const values = Array.from({ length: count }, (_, index) => ({
      attempt: duplicate ? 0 : index, workflow: 'passed',
      steps: complete ? [...lifecycleSteps] : [],
      signingTypeContract: { expected: 'micheline', observed: contract ? 'micheline' : null },
      health: {
        scope: 'post-onboarding', dapp: clean,
        wallet: healthy ? clean : { ...clean, status: 'degraded', findings: ['HTTP error'] }
      }
    }))
    const expected = count === 3 && !duplicate && healthy && contract && statistics && complete
    let passed = false
    try { passed = check(values, statistics ? stats : { ...stats, skipped: 1 }).status === 'workflow-passed' } catch {}
    if (passed !== expected) counterexamples++
    checked++
  }
  return counterexamples
}
function graphCounterexamples(check: typeof validateGraph) {
  let counterexamples = 0
  for (const version of ['4.8.5-ecad', '4.8.4-ecad'])
  for (const provenance of [true, false])
  for (const extra of [true, false])
  for (const missing of [true, false]) {
    const location = 'node_modules/@ecadlabs/beacon-dapp'
    const lock = { packages: { '': {}, [location]: {
      version: '4.8.5-ecad',
      ...(provenance ? { resolved: 'https://registry.npmjs.org/sdk.tgz', integrity: 'sha512-control' } : {})
    } } }
    const inventory = missing ? [] : [{ path: location, name: '@ecadlabs/beacon-dapp', version }]
    if (extra) inventory.push({ path: 'node_modules/extra', name: 'extra', version: '1.0.0' })
    const expected = version === '4.8.5-ecad' && provenance && !extra && !missing
    // With no package present, version and provenance don't alter the missing-package rejection.
    let accepted = false
    try { check(lock, inventory); accepted = true } catch {}
    if (accepted !== expected) counterexamples++
    checked++
  }
  return counterexamples
}
assert.equal(lifecycleCounterexamples(lifecycleVerdict), 0)
assert.equal(graphCounterexamples(validateGraph), 0)
const controls = [
  { file: 0, before: "const contractErrors = attempts.some(value => value.signingTypeContract.observed !== value.signingTypeContract.expected)", after: 'const contractErrors = false', kind: 'lifecycle', name: 'ignored signing contract' },
  { file: 0, before: "const walletErrors = attempts.some(value => value.health.wallet.status !== 'clean')", after: 'const walletErrors = false', kind: 'lifecycle', name: 'ignored wallet health' },
  { file: 0, before: 'if (!statistics.safeParse(stats).success)', after: 'if (false)', kind: 'lifecycle', name: 'ignored test statistics' },
  { file: 0, before: 'if (new Set(attempts.map(value => value.attempt)).size !== 3)', after: 'if (false)', kind: 'lifecycle', name: 'duplicate attempts accepted' },
  { file: 1, before: 'if (pkg.version !== expected.version)', after: 'if (false)', kind: 'graph', name: 'installed version mismatch accepted' },
  { file: 1, before: "if (!expected.integrity || !expected.resolved?.startsWith('https://registry.npmjs.org/'))", after: 'if (false)', kind: 'graph', name: 'missing registry provenance accepted' }
]
for (const control of controls) {
  const original = before[control.file]
  assert.ok(original?.includes(control.before), 'Mutation no longer matches current source: ' + control.name)
  const javascript = stripTypeScriptTypes(original.replace(control.before, control.after)
    .replace("'zod'", JSON.stringify(import.meta.resolve('zod'))))
  const changed = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
  const failures = control.kind === 'graph' ? graphCounterexamples(changed.validateGraph) : lifecycleCounterexamples(changed.lifecycleVerdict)
  assert.ok(failures > 0, 'Verification missed broken variant: ' + control.name)
  console.log(control.name + ': detected ' + failures + ' counterexamples')
}
const after = await Promise.all(paths.map(name => readFile(name, 'utf8')))
assert.deepEqual(after.map(hash), before.map(hash), 'Covered source changed during verification')
console.log('Bounded production-validator verification passed. Cases including mutations: ' + checked)
console.log(JSON.stringify(Object.fromEntries(paths.map((name, index) => [name, hash(before[index] ?? '')])), null, 2))
