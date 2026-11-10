import { fork, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, copyFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

const mode = 'lifecycle'
const repeats = 3
const playwrightArgs = ['test']

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
    const workflowEnv = {
      TEMPLE_REPORT_DIR: directory,
      TEMPLE_PROFILE_ROOT: profiles,
      TEMPLE_REPEATS: String(repeats),
      TEMPLE_PICKER: 'custom',
      TEMPLE_APP_ORIGIN: report.appOrigin ?? ''
    }
    child = spawn(command, args, {
      detached: true,
      stdio: 'inherit',
      env: { ...process.env, ...workflowEnv }
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
  if (!interrupted) {
    await run('wallet artifact after test', 'python3', ['scripts/temple_artifact.py'])
  }
  if (workflowError) {
    report.stage = mode
    throw workflowError
  }
  report.stage = mode
  report.status = 'workflow-passed'
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
  try {
    await rm(profiles, { recursive: true, force: true })
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
