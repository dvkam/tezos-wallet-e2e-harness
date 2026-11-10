import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

await mkdir('reports', { recursive: true })
const directory = await mkdtemp(path.resolve('reports', 'temple-lifecycle-'))
const report = { status: 'running', stage: 'install', scope: 'Temple lifecycle', node: process.version }
console.log('Report directory: ' + directory)

let child
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

async function run(stage, command, args) {
  if (interrupted) throw new Error('Run interrupted')
  report.stage = stage
  await new Promise((resolve, reject) => {
    child = spawn(command, args, {
      detached: true,
      stdio: 'inherit',
      env: { ...process.env, TEMPLE_REPORT_DIR: directory, TEMPLE_REPEATS: '3', TEMPLE_PICKER: 'custom' }
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
  await copyFile('package-lock.json', path.join(directory, 'package-lock.json'))
  await run('install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
  await run('wallet artifact', 'python3', ['scripts/temple_artifact.py'])
  await run('build', 'npm', ['run', 'build'])
  let lifecycleError
  try {
    await run('lifecycle', 'node_modules/.bin/playwright', ['test'])
    const { stats } = JSON.parse(await readFile(path.join(directory, 'playwright.json'), 'utf8'))
    report.stats = stats
    if (stats.expected !== 3 || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0) {
      throw new Error('Expected three completed workflows with zero failures, skips, or retries')
    }
  } catch (error) {
    lifecycleError = error
    report.lifecycleError = String(error)
  }
  if (!interrupted) {
    await run('wallet artifact after test', 'python3', ['scripts/temple_artifact.py'])
  }
  if (lifecycleError) {
    report.stage = 'lifecycle'
    throw lifecycleError
  }
  report.stage = 'lifecycle'
  report.status = 'workflow-passed'
} catch (error) {
  report.status = interrupted ? 'interrupted' : 'failed'
  report.error = String(error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
