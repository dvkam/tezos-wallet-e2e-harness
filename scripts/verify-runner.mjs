import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sha256 } from './consumer-workspace.mjs'

const rootLock = sha256(await readFile('package-lock.json'))
const sentinel = await mkdtemp(path.join(tmpdir(), 'wp01-unrelated-'))
await writeFile(path.join(sentinel, 'keep'), 'not owned by the runner')
let output = ''
const child = spawn(process.execPath, ['scripts/run-temple.mjs', 'check', '--lane', 'stable'], { stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', data => { output += data })
child.stderr.on('data', data => { output += data })
const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
child.on('error', error => { throw error })
const deadline = Date.now() + 30_000
try {
  let directory
  let installing = false
  while (Date.now() < deadline) {
    directory = /^Report directory: (.+)$/m.exec(output)?.[1]
    if (directory) {
      try {
        const progress = JSON.parse(await readFile(path.join(directory, 'progress.json'), 'utf8'))
        if (progress.stage === 'install') { installing = true; break }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    if (child.exitCode !== null) throw new Error('Runner exited before interruption: ' + output)
    await pause(25)
  }
  assert.ok(directory && installing, 'Runner did not reach installation')
  child.kill('SIGTERM')
  const result = await Promise.race([closed, pause(15_000, undefined, { ref: false }).then(() => { throw new Error('Runner did not finish interruption cleanup') })])
  assert.equal(result.code, 1)
  const report = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'))
  assert.equal(report.status, 'interrupted')
  await assert.rejects(stat(report.temporaryWorkspace), { code: 'ENOENT' })
  await assert.rejects(stat(path.join(directory, 'profiles')), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(sentinel, 'keep'), 'utf8'), 'not owned by the runner')
  assert.equal(sha256(await readFile('package-lock.json')), rootLock)
  console.log('Actual runner interruption rejected success, removed owned workspace and profiles, and preserved the checkout and unrelated files.')
  console.log('Report: ' + directory)
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  await rm(sentinel, { recursive: true, force: true })
}
