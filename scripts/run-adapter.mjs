import { execFile, fork, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { parseRunArgs, prepareWorkspace } from './consumer-workspace.mjs'

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.chdir(sourceRoot)
const wallet = process.argv[2]
if (!['kukai', 'umami'].includes(wallet)) throw new Error('Expected kukai or umami')
const { lane } = parseRunArgs(['lifecycle', ...process.argv.slice(3)])
await mkdir('reports', { recursive: true })
const directory = await mkdtemp(path.resolve('reports', wallet + '-lifecycle-'))
const profiles = path.join(directory, 'profiles')
const artifactRoot = path.resolve(process.env.WALLET_ARTIFACT_ROOT ?? '.artifacts')
const report = { status: 'running', wallet, lane, node: process.version,
  os: { type: os.type(), release: os.release(), architecture: os.arch() } }
console.log('Report directory: ' + directory)
let workspace
let child
let interrupted = false
const servers = []
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal) }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}
function interrupt() {
  interrupted = true
  if (child?.pid) {
    const pid = child.pid
    signalGroup(pid, 'SIGTERM')
    setTimeout(() => { if (child?.pid === pid) signalGroup(pid, 'SIGKILL') }, 5000).unref()
  }
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
const env = () => ({ ...process.env, WALLET_REPORT_DIR: directory, WALLET_PROFILE_ROOT: profiles,
  WALLET_ARTIFACT_ROOT: artifactRoot, WALLET_APP_ORIGIN: report.appOrigin ?? '',
  KUKAI_WALLET_ORIGIN: report.walletOrigin ?? '' })
async function run(stage, command, args) {
  if (interrupted) throw new Error('Run interrupted')
  report.stage = stage
  writeFileSync(path.join(directory, 'progress.json'), JSON.stringify(report, null, 2))
  await new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: workspace, env: env(), detached: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      child = undefined
      if (code === 0 && !interrupted) resolve()
      else reject(new Error(stage + ' failed (' + (signal ?? code) + ')'))
    })
  })
}
async function startServer(script, cwd) {
  if (interrupted) throw new Error('Run interrupted')
  const process = fork(script, [], { cwd, env: env(), detached: true,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const closed = new Promise(resolve => process.once('close', resolve))
  servers.push({ process, closed })
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(script + ' startup timeout')), 15_000)
    process.once('message', message => {
      clearTimeout(timer)
      if (typeof message === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message)) resolve(message)
      else reject(new Error('Server must report a loopback origin'))
    })
    process.once('error', error => { clearTimeout(timer); reject(error) })
    process.once('close', code => { clearTimeout(timer); reject(new Error(script + ' exited (' + code + ')')) })
  })
}
async function verifyArtifact() {
  if (interrupted) throw new Error('Run interrupted')
  const { stdout } = await promisify(execFile)(process.execPath,
    [path.join(sourceRoot, 'scripts', wallet + '-artifact.mjs')], { env: env(), maxBuffer: 4 * 1024 * 1024 })
  return JSON.parse(stdout)
}
async function measurements() {
  const artifacts = path.join(directory, 'artifacts')
  const entries = await readdir(artifacts, { withFileTypes: true })
  const result = []
  for (const entry of entries.filter(entry => entry.isDirectory() && entry.name.startsWith(wallet + '-'))) {
    try { result.push(JSON.parse(await readFile(path.join(artifacts, entry.name, 'measurement.json'), 'utf8'))) }
    catch (error) { report.measurementReadErrors ??= []; report.measurementReadErrors.push(String(error)) }
  }
  return result
}

try {
  await mkdir(profiles)
  const git = (...args) => promisify(execFile)('git', args, { cwd: sourceRoot })
  report.harnessCommit = (await git('rev-parse', 'HEAD')).stdout.trim()
  report.dirtySource = Boolean((await git('status', '--porcelain')).stdout.trim())
  report.artifact = await verifyArtifact()
  const prepared = await prepareWorkspace({ sourceRoot, lane, reportDirectory: directory,
    extraRootFiles: ['playwright.' + wallet + '.config.ts'] })
  workspace = prepared.workspace
  report.sourceSha256 = prepared.sourceSha256
  await run('install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
  await run('installed graph', process.execPath, ['scripts/verify-installed.ts', lane, path.join(directory, 'installed-graph.json'), '--browser'])
  await run('build', 'npm', ['run', 'build'])
  report.appOrigin = await startServer('scripts/temple-preview.mjs', workspace)
  if (wallet === 'kukai') report.walletOrigin = await startServer('scripts/kukai-serve.mjs', sourceRoot)
  try {
    await run('lifecycle', 'node_modules/.bin/playwright', ['test', '--config=playwright.' + wallet + '.config.ts'])
  } catch (error) { report.workflowError = String(error) }
  report.attempts = await measurements()
  const { stats } = JSON.parse(await readFile(path.join(directory, 'playwright.json'), 'utf8'))
  report.stats = stats
  const module = await import(pathToFileURL(path.join(workspace, 'scripts', wallet + '-verdict.ts')).href)
  report.lifecycle = module[wallet + 'Verdict'](report.attempts, stats)
  report.artifactAfter = await verifyArtifact()
  if (JSON.stringify(report.artifact) !== JSON.stringify(report.artifactAfter)) throw new Error('Wallet artifact changed during run')
  report.status = report.workflowError ? 'failed' : report.lifecycle.status
} catch (error) {
  report.status = 'failed'
  report.error = String(error)
  console.error(report.error)
} finally {
  for (const server of servers.reverse()) {
    try {
      if (server.process.exitCode === null && server.process.signalCode === null) {
        signalGroup(server.process.pid, 'SIGTERM')
        const timeout = setTimeout(() => signalGroup(server.process.pid, 'SIGKILL'), 5000)
        try { await server.closed } finally { clearTimeout(timeout) }
      }
    } catch (error) { report.serverCleanupError = String(error); report.status = 'failed' }
  }
  if (wallet === 'umami' && workspace) {
    try {
      await promisify(execFile)(process.execPath, [path.join(workspace, 'scripts/umami-cleanup.ts'), directory, profiles])
    } catch (error) { report.walletCleanupError = String(error); report.status = 'failed' }
  }
  for (const owned of [profiles, workspace].filter(Boolean)) {
    try { await rm(owned, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) }
    catch (error) { report.cleanupError = String(error); report.status = 'failed' }
  }
  // No await may separate the final interruption guard and publication.
  if (interrupted) report.status = 'interrupted'
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.status === 'workflow-passed' ? 0 : 1
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  console.log(report.status + ': ' + directory)
}
