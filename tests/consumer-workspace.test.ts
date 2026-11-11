import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prepareWorkspace, parseRunArgs, sha256 } from '../scripts/consumer-workspace.mjs'

test('prepares selected dependencies without modifying the checkout or copying wallet state', async () => {
  const sourceRoot = process.cwd()
  const reportDirectory = await mkdtemp(path.join(tmpdir(), 'consumer-preparation-test-'))
  const original = await readFile('package-lock.json')
  let workspace: string | undefined
  try {
    const prepared = await prepareWorkspace({ sourceRoot, lane: 'stable', reportDirectory })
    workspace = prepared.workspace
    assert.notEqual(workspace, sourceRoot)
    assert.deepEqual(await readFile(path.join(workspace, 'package-lock.json')), await readFile('consumers/stable/package-lock.json'))
    assert.equal(sha256(await readFile('package-lock.json')), sha256(original))
    await assert.rejects(readFile(path.join(workspace, '.artifacts/temple/chrome.zip')), { code: 'ENOENT' })
    assert.equal(parseRunArgs(['transfer', '--lane', 'candidate']).lane, 'candidate')
    assert.throws(() => parseRunArgs(['transfer', '--lane', '../main']), /Unknown/)
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true })
    await rm(reportDirectory, { recursive: true, force: true })
  }
})
