import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { cleanupOwnedBrowsers } from '../scripts/adapter-cleanup.mjs'

test('reaps only the exact executable with this run-owned profile, leaving unrelated processes alive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adapter-cleanup-'))
  const profile = path.join(root, 'owned')
  await mkdir(profile)
  const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},1000)`
  const start = (directory: string, withChild = false) => spawn(process.execPath,
    ['-e', withChild ? code : 'setInterval(()=>{},1000)', '--', '--user-data-dir=' + directory],
    { detached: true, stdio: ['ignore','pipe','ignore'] })
  const owned = start(profile, true)
  const descendant = await new Promise<number>(resolve => owned.stdout!.once('data', data => resolve(Number(String(data).trim()))))
  // Let the descendant install its TERM handler before exercising cleanup.
  await pause(150)
  const unrelated = start(tmpdir())
  try {
    assert.deepEqual(await cleanupOwnedBrowsers(root, process.execPath), [owned.pid])
    await assert.rejects(readFile('/proc/' + descendant + '/cmdline').then(bytes => { if (bytes.length === 0) throw Object.assign(new Error('zombie'), {code:'ENOENT'}); return bytes }), { code: 'ENOENT' })
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0))
  } finally {
    for (const child of [owned, unrelated]) {
      try { process.kill(-child.pid!, 'SIGKILL') } catch {}
    }
    await rm(root, { recursive: true, force: true })
  }
})
