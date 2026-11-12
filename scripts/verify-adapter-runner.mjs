import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sha256 } from './consumer-workspace.mjs'

const lock = sha256(await readFile('package-lock.json'))
const sentinel = await mkdtemp(path.join(tmpdir(), 'adapter-unrelated-'))
await writeFile(path.join(sentinel, 'keep'), 'unrelated')
async function execute(env, interrupt) {
  let output = ''
  const child = spawn(process.execPath, ['scripts/run-adapter.mjs', 'kukai', '--lane', 'candidate'],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  try {
    if (interrupt) {
      const deadline = Date.now() + 40_000
      let ready = false
      while (Date.now() < deadline && child.exitCode === null) {
        const directory = /^Report directory: (.+)$/m.exec(output)?.[1]
        if (directory) {
          try {
            ready = JSON.parse(await readFile(path.join(directory, 'progress.json'), 'utf8')).stage === 'install'
          } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        if (ready) break
        await pause(25)
      }
      assert.ok(ready, 'Actual runner did not reach installation: ' + output)
      child.kill('SIGTERM')
    }
    const result = await Promise.race([closed, pause(20_000, undefined, { ref: false }).then(() => { throw new Error('Runner cleanup timeout') })])
    assert.equal(result.code, 1)
    const directory = /^Report directory: (.+)$/m.exec(output)?.[1]
    assert.ok(directory)
    const report = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'))
    assert.equal(report.status, interrupt ? 'interrupted' : 'failed')
    if (report.temporaryWorkspace) await assert.rejects(stat(report.temporaryWorkspace), { code: 'ENOENT' })
    await assert.rejects(stat(path.join(directory, 'profiles')), { code: 'ENOENT' })
    console.log((interrupt ? 'Actual interruption' : 'Actual artifact setup failure') + ': ' + directory)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}
try {
  await execute({ WALLET_ARTIFACT_ROOT: path.join(sentinel, 'missing') }, false)
  await execute({}, true)
  assert.equal(await readFile(path.join(sentinel, 'keep'), 'utf8'), 'unrelated')
  assert.equal(sha256(await readFile('package-lock.json')), lock)
} finally { await rm(sentinel, { recursive: true, force: true }) }
