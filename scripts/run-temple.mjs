import { execFile, fork, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, copyFile, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const mode = process.argv[2] ?? 'lifecycle'
if (!['lifecycle', 'network', 'transfer'].includes(mode) || process.argv.length > 3) throw new Error('Expected lifecycle, network, or transfer')
const sandboxRun = mode === 'lifecycle' ? undefined : randomUUID()
let sandboxAttempted = false
const repeats = mode === 'lifecycle' ? 3 : 1
const playwrightArgs = mode === 'lifecycle' ? ['test'] : ['test', '--config=playwright.sandbox.config.ts']

await mkdir('reports', { recursive: true })
const directory = await mkdtemp(path.resolve('reports', 'temple-' + mode + '-'))
const profiles = path.join(directory, 'profiles')
const report = { status: 'running', stage: 'install', scope: 'Temple ' + mode, node: process.version }
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
  await new Promise((resolve, reject) => {
    const sandboxEnv = sandboxRun ? { TEMPLE_SANDBOX_RUN_ID: sandboxRun } : {}
    const workflowEnv = {
      TEMPLE_REPORT_DIR: directory,
      TEMPLE_PROFILE_ROOT: profiles,
      TEMPLE_REPEATS: String(repeats),
      TEMPLE_PICKER: 'custom',
      TEMPLE_SANDBOX_MODE: mode,
      TEMPLE_APP_ORIGIN: report.appOrigin ?? ''
    }
    child = spawn(command, args, {
      detached: true,
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

try {
  await mkdir(profiles)
  await copyFile('package-lock.json', path.join(directory, 'package-lock.json'))
  await run('install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
  await run('wallet artifact', 'python3', ['scripts/temple_artifact.py'])
  await run('build', 'npm', ['run', 'build'])
  report.stage = 'preview'
  report.appOrigin = await startPreview()
  console.log('Preview: ' + report.appOrigin)
  let workflowError
  try {
    sandboxAttempted = sandboxRun !== undefined
    await run(mode, 'node_modules/.bin/playwright', playwrightArgs)
    const { stats } = JSON.parse(await readFile(path.join(directory, 'playwright.json'), 'utf8'))
    report.stats = stats
    if (stats.expected !== repeats || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0) {
      throw new Error('Expected all workflows to complete with zero failures, skips, or retries')
    }
  } catch (error) {
    workflowError = error
    report.workflowError = String(error)
  }
  if (mode !== 'lifecycle' && !interrupted) {
    try {
      const artifacts = path.join(directory, 'artifacts')
      const entries = await readdir(artifacts, { withFileTypes: true })
      const candidates = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('temple-sandbox-'))
      if (candidates.length !== 1) throw new Error('Expected one sandbox evidence directory')
      const evidence = JSON.parse(await readFile(path.join(artifacts, candidates[0].name, 'sandbox.json'), 'utf8'))
      const { sandboxVerdict } = await import('./sandbox-verdict.ts')
      report.sandbox = sandboxVerdict(evidence, mode)
      if (report.sandbox.workflow === 'failed' && !workflowError) throw new Error('Sandbox workflow failed')
    } catch (error) {
      report.sandboxEvidenceError = String(error)
      if (!workflowError) workflowError = error
    }
  }
  if (!interrupted) {
    await run('wallet artifact after test', 'python3', ['scripts/temple_artifact.py'])
  }
  if (workflowError) {
    report.stage = mode
    throw workflowError
  }
  report.stage = mode
  report.status = report.sandbox?.status ?? 'workflow-passed'
  if (report.status !== 'workflow-passed') {
    console.error(report.status + '. See the separate workflow and health results in ' + directory)
    process.exitCode = 1
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
  if (interrupted) {
    report.status = 'interrupted'
    process.exitCode = 1
  }
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
