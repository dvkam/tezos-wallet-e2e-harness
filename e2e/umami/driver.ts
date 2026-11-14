import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import { umamiArtifactSchema } from '../../scripts/umami-verdict.ts'
import { ledgerSchema, processIdentity, stopOwnedUmami } from '../../scripts/umami-cleanup.ts'

// Chromium picks the port and announces it, so no other process can take a reserved one first.
export function devtoolsEndpoint(stderr: string) {
  const port = /^DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//m.exec(stderr)?.[1]
  return port ? 'http://127.0.0.1:' + port : undefined
}
export async function launchUmami(outputDirectory: string) {
  const artifactRoot = path.resolve(process.env.WALLET_ARTIFACT_ROOT ?? '.artifacts')
  const { stdout } = await promisify(execFile)('python3', ['scripts/umami_artifact.py'], {
    timeout: 30_000, env: { ...process.env, WALLET_ARTIFACT_ROOT: artifactRoot }
  })
  const artifact = umamiArtifactSchema.parse(JSON.parse(stdout))
  const profileRoot = process.env.WALLET_PROFILE_ROOT
  if (!profileRoot) throw new Error('Launch Umami through its owned runner')
  await mkdir(profileRoot, { recursive: true })
  await mkdir(outputDirectory, { recursive: true })
  const profile = await mkdtemp(path.join(profileRoot, 'umami-'))
  const binary = path.join(artifactRoot, 'umami/unpacked/opt/Umami/@umamidesktop')
  const environment = { ...process.env, XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_DATA_HOME: path.join(profile, 'data'), XDG_CACHE_HOME: path.join(profile, 'cache') }
  const ledger: z.infer<typeof ledgerSchema> = { binary, profile, processes: [] }
  const secrets: string[] = []
  const redact = (value: string) => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), value)
  let logs = ''
  let browser: Browser | undefined
  let closing: Promise<void> | undefined
  const children: ChildProcess[] = []
  async function saveLedger() {
    const file = path.join(outputDirectory, 'process.json')
    await writeFile(file + '.tmp', JSON.stringify(ledger, null, 2) + '\n')
    await rename(file + '.tmp', file)
  }
  async function own(child: ChildProcess, allowExited = false) {
    children.push(child)
    if (!child.pid) throw new Error('Umami did not start an owned process')
    const state = await processIdentity(child.pid)
    if (!state) { if (allowExited) return; throw new Error('Umami process exited before ownership was recorded') }
    ledger.processes.push({ pid: child.pid, startTicks: state.startTicks })
    await saveLedger()
  }
  const killOwned = () => {
    for (const child of children.filter(child => child.pid && child.exitCode === null && child.signalCode === null)) {
      if (!child.pid) continue
      try { process.kill(-child.pid, 'SIGKILL') }
      catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
      }
    }
  }
  const terminate = () => { killOwned(); process.exit(143) }
  const interrupt = () => { killOwned(); process.exit(130) }
  process.once('exit', killOwned)
  process.once('SIGTERM', terminate)
  process.once('SIGINT', interrupt)
  const close = () => {
    if (!closing) closing = (async () => {
      const errors: unknown[] = []
      const attempt = async (action: () => Promise<unknown>) => { try { await action() } catch (error: unknown) { errors.push(error) } }
      await attempt(() => stopOwnedUmami(ledger))
      await attempt(async () => {
        if (browser?.isConnected()) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try { await Promise.race([browser.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Umami CDP close timed out')), 5000) })]) }
          finally { clearTimeout(timer) }
        }
      })
      await attempt(() => writeFile(path.join(outputDirectory, 'wallet-process.log'), redact(logs)))
      await attempt(() => rm(profile, { recursive: true, force: true }))
      if (!errors.length) {
        process.removeListener('exit', killOwned)
        process.removeListener('SIGTERM', terminate)
        process.removeListener('SIGINT', interrupt)
      }
      if (errors.length) throw new AggregateError(errors, 'Umami cleanup failed')
    })()
    return closing
  }
  let spawnError: Error | undefined
  try {
    const child = spawn(binary, ['--user-data-dir=' + path.join(profile, 'browser'), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.once('error', error => { spawnError = error })
    child.stdout?.on('data', data => { logs += redact(String(data)) })
    let startup = ''
    let endpoint: string | undefined
    child.stderr?.on('data', data => {
      logs += redact(String(data))
      if (!endpoint) { startup += String(data); endpoint = devtoolsEndpoint(startup) }
    })
    await own(child)
    await expect.poll(async () => {
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error('Umami exited before CDP startup: ' + child.exitCode)
      return endpoint !== undefined
    }, { timeout: 20_000 }).toBe(true)
    if (!endpoint) throw new Error('Umami did not announce its CDP endpoint')
    browser = await chromium.connectOverCDP(endpoint)
    await expect.poll(() => browser?.contexts()[0]?.pages().length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
    const context = browser.contexts()[0]
    const page = context?.pages()[0]
    if (!context || !page) throw new Error('Umami renderer is missing')
    page.setDefaultTimeout(20_000)
    const version = browser.version()
    return { page, context, artifact, version, profile, close, redact,
      protect(...values: string[]) { secrets.push(...values.filter(Boolean)) },
      async pair(serialized: string) {
        const pairing = spawn(binary, ['--user-data-dir=' + path.join(profile, 'browser'), 'umami://?type=tzip10&data=' + encodeURIComponent(serialized)], { env: environment, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
        pairing.stderr?.on('data', data => { logs += redact(String(data)) })
        const completed = new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve() }
          pairing.once('error', () => finish(new Error('Umami deep-link process could not start')))
          pairing.once('close', code => finish(code === 0 ? undefined : new Error('Umami deep-link process failed')))
          timer = setTimeout(() => { void stopOwnedUmami(ledger).then(() => finish(new Error('Umami deep-link handoff timed out')), () => finish(new Error('Umami deep-link cleanup failed'))) }, 10_000)
        })
        await Promise.all([own(pairing, true), completed])
      }
    }
  } catch (error: unknown) {
    await close()
    throw error
  }
}
export async function onboardUmami(page: Page, mnemonic: string, password: string) {
  try {
    await page.getByRole('button', { name: 'Get started', exact: true }).click()
    await page.getByRole('checkbox').press('Space')
    await expect(page.getByRole('checkbox')).toBeChecked()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'I already have a wallet', exact: true }).click()
    await page.getByRole('button', { name: 'Import with Seed Phrase', exact: true }).click()
    await page.getByTestId('select').selectOption('12')
    const inputs = page.getByRole('textbox')
    await expect(inputs).toHaveCount(12)
    for (const [index, word] of mnemonic.split(' ').entries()) await inputs.nth(index).fill(word)
    await page.getByRole('heading', { name: 'Import Seed Phrase', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByTestId('name').fill('Public baseline test')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Derivation Path', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByTestId('password').fill(password)
    await page.getByTestId('confirmation').fill(password)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible({ timeout: 60_000 })
  } catch { throw new Error('Umami onboarding failed; capture was disabled') }
}
