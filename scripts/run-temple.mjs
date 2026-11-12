import { execFile, fork, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync, renameSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import { parseRunArgs, prepareWorkspace, sha256 } from './consumer-workspace.mjs'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.chdir(sourceRoot)
const { mode, lane } = parseRunArgs(process.argv.slice(2))
const sandboxRun = mode === 'network' || mode === 'transfer' ? randomUUID() : undefined
let workspace
let sandboxAttempted = false
const repeats = mode === 'lifecycle' ? 3 : 1
const playwrightArgs = mode === 'lifecycle' ? ['test'] : ['test', '--config=playwright.sandbox.config.ts']

await mkdir('reports', { recursive: true })
const directory = await mkdtemp(path.resolve('reports', 'temple-' + mode + '-'))
const profiles = path.join(directory, 'profiles')
const report = { status: 'running', stage: 'install', scope: 'Temple ' + mode, lane, node: process.version, os: { type: os.type(), release: os.release(), architecture: os.arch() } }
console.log('Report directory: ' + directory)

let child
let previewProcess
let previewClosed
let interrupted = false
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
function interrupt() {
  interrupted = true
  if (child?.pid) {
    const pid = child.pid
    signalGroup(pid, 'SIGTERM')
    setTimeout(() => {
      if (child?.pid === pid) signalGroup(pid, 'SIGKILL')
    }, 5000).unref()
  }
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

async function startPreview() {
  previewProcess = fork('scripts/temple-preview.mjs', [], {
    detached: true,
    cwd: workspace,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })
  previewClosed = new Promise(resolve => previewProcess.once('close', resolve))
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start within 15 seconds')), 15_000)
    previewProcess.once('message', message => {
      clearTimeout(timer)
      if (typeof message === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message)) resolve(message)
      else reject(new Error('Preview did not report a loopback address'))
    })
    previewProcess.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    previewProcess.once('close', code => {
      clearTimeout(timer)
      reject(new Error('Preview exited before it was ready (' + code + ')'))
    })
  })
  return origin
}

async function stopPreview() {
  if (!previewProcess?.pid) return
  const pid = previewProcess.pid
  if (previewProcess.exitCode === null && previewProcess.signalCode === null) {
    signalGroup(pid, 'SIGTERM')
    const timeout = setTimeout(() => signalGroup(pid, 'SIGKILL'), 5000)
    try { await previewClosed }
    finally { clearTimeout(timeout) }
  } else {
    await previewClosed
  }
}

async function run(stage, command, args) {
  if (interrupted) throw new Error('Run interrupted')
  report.stage = stage
  writeFileSync(path.join(directory, 'progress.json.tmp'), JSON.stringify(report, null, 2) + '\n')
  renameSync(path.join(directory, 'progress.json.tmp'), path.join(directory, 'progress.json'))
  await new Promise((resolve, reject) => {
    const sandboxEnv = sandboxRun ? { TEMPLE_SANDBOX_RUN_ID: sandboxRun } : {}
    const workflowEnv = {
      TEMPLE_REPORT_DIR: directory,
      TEMPLE_PROFILE_ROOT: profiles,
      TEMPLE_REPEATS: String(repeats),
      TEMPLE_PICKER: 'custom',
      TEMPLE_SANDBOX_MODE: mode,
      TEMPLE_APP_ORIGIN: report.appOrigin ?? '',
      TEMPLE_EXTENSION_DIR: path.resolve(sourceRoot, report.wallet.directory)
    }
    child = spawn(command, args, {
      detached: true,
      cwd: workspace,
      stdio: 'inherit',
      env: { ...process.env, ...sandboxEnv, ...workflowEnv }
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      child = undefined
      if (code === 0 && !interrupted) resolve()
      else reject(new Error(stage + ' failed (' + (signal ?? code) + ')'))
    })
  })
}

async function verifyArtifact(stage) {
  for (const name of ['baseline.json', 'scripts/temple_artifact.py']) {
    const original = await readFile(path.join(sourceRoot, name))
    const selected = await readFile(path.join(workspace, name))
    if (sha256(original) !== sha256(selected)) throw new Error('Artifact verification input changed: ' + name)
  }
  await run(stage, 'python3', [path.join(sourceRoot, 'scripts/temple_artifact.py')])
}

try {
  await mkdir(profiles)
  const git = (...args) => promisify(execFile)('git', args, { cwd: sourceRoot })
  report.harnessCommit = (await git('rev-parse', 'HEAD')).stdout.trim()
  report.dirtySource = Boolean((await git('status', '--porcelain')).stdout.trim())
  const prepared = await prepareWorkspace({ sourceRoot, lane, reportDirectory: directory })
  workspace = prepared.workspace
  report.temporaryWorkspace = workspace
  report.sourceSha256 = prepared.sourceSha256
  report.wallet = JSON.parse(await readFile(path.join(workspace, 'baseline.json'), 'utf8')).wallet
  await run('install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
  await run('installed graph', process.execPath, ['scripts/verify-installed.ts', lane, path.join(directory, 'installed-graph.json'), ...(mode === 'check' ? [] : ['--browser'])])
  if (mode !== 'check') await verifyArtifact('wallet artifact')
  await run('build', 'npm', ['run', 'build'])
  if (mode === 'check') {
    await run('deterministic checks', 'npm', ['test'])
    await run('bounded verification', 'npm', ['run', 'verify:publication'])
    await run('bounded Umami verdict verification', 'npm', ['run', 'verify:umami'])
    report.status = 'harness-checks-passed'
    report.stage = 'check'
  } else {
    report.stage = 'preview'
    report.appOrigin = await startPreview()
    console.log('Preview: ' + report.appOrigin)
    let workflowError
    try {
      sandboxAttempted = sandboxRun !== undefined
      await run(mode, 'node_modules/.bin/playwright', playwrightArgs)
    } catch (error) {
      workflowError = error
      report.workflowError = String(error)
    }
    if (!interrupted) {
      try {
        const { stats } = JSON.parse(await readFile(path.join(directory, 'playwright.json'), 'utf8'))
        report.stats = stats
        if (stats.expected !== repeats || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0) {
          throw new Error('Expected all workflows to complete with zero failures, skips, or retries')
        }
      } catch (error) {
        report.statisticsError = String(error)
        if (!workflowError) workflowError = error
      }
    }
    if (mode === 'lifecycle' && !interrupted) {
      try {
        const artifacts = path.join(directory, 'artifacts')
        const entries = await readdir(artifacts, { withFileTypes: true })
        const attempts = []
        for (const entry of entries.filter(entry => entry.isDirectory() && entry.name.startsWith('temple-'))) {
          attempts.push(JSON.parse(await readFile(path.join(artifacts, entry.name, 'measurement.json'), 'utf8')))
        }
        report.lifecycleAttempts = attempts
        const { lifecycleVerdict } = await import(pathToFileURL(path.join(workspace, 'scripts/lifecycle-verdict.ts')).href)
        report.lifecycle = lifecycleVerdict(attempts, report.stats)
      } catch (error) {
        report.lifecycleEvidenceError = String(error)
        if (!workflowError) workflowError = error
      }
    }
    if (mode !== 'lifecycle' && !interrupted) {
      try {
        const artifacts = path.join(directory, 'artifacts')
        const entries = await readdir(artifacts, { withFileTypes: true })
        const candidates = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('temple-sandbox-'))
        if (candidates.length !== 1) throw new Error('Expected one sandbox evidence directory')
        const evidence = JSON.parse(await readFile(path.join(artifacts, candidates[0].name, 'sandbox.json'), 'utf8'))
        const { sandboxVerdict } = await import(pathToFileURL(path.join(workspace, 'scripts/sandbox-verdict.ts')).href)
        report.sandbox = sandboxVerdict(evidence, mode)
        if (report.sandbox.workflow === 'failed' && !workflowError) throw new Error('Sandbox workflow failed')
      } catch (error) {
        report.sandboxEvidenceError = String(error)
        if (!workflowError) workflowError = error
      }
    }
    if (!interrupted) {
      await verifyArtifact('wallet artifact after test')
    }
    if (workflowError) {
      report.stage = mode
      throw workflowError
    }
    report.stage = mode
    report.status = report.lifecycle?.status ?? report.sandbox?.status ?? 'failed'
    if (report.status !== 'workflow-passed') {
      console.error(report.status + '. See the separate workflow and health results in ' + directory)
      process.exitCode = 1
    }
  }
} catch (error) {
  report.status = interrupted ? 'interrupted' : 'failed'
  report.error = String(error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  try {
    await stopPreview()
  } catch (error) {
    report.previewCleanupError = String(error)
    console.error('Preview cleanup failed: ' + report.previewCleanupError)
    report.status = 'failed'
    process.exitCode = 1
  }
  if (sandboxAttempted && sandboxRun) {
    try {
      const docker = (...args) => promisify(execFile)('docker', args, { timeout: 10_000 })
      const { stdout } = await docker('ps', '-aq', '--filter', 'label=tezos-wallet-e2e.run=' + sandboxRun)
      const ids = stdout.trim().split(/\s+/).filter(Boolean)
      if (ids.length) await docker('rm', '-f', ...ids)
    } catch (error) {
      report.cleanupError = String(error)
      console.error('Sandbox cleanup failed: ' + report.cleanupError)
      report.status = 'failed'
      process.exitCode = 1
    }
  }
  try {
    await rm(profiles, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error) {
    report.profileCleanupError = String(error)
    console.error('Profile cleanup failed: ' + report.profileCleanupError)
    report.status = 'failed'
    process.exitCode = 1
  }
  if (workspace) {
    try { await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) }
    catch (error) {
      report.workspaceCleanupError = String(error)
      report.status = 'failed'
      process.exitCode = 1
    }
  }
  if (interrupted) {
    report.status = 'interrupted'
    process.exitCode = 1
  }
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
