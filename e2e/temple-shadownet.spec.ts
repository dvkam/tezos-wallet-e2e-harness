import { test, expect, type BrowserContext } from '@playwright/test'
import { rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { captureFailure, fixture, launchTemple, onboard, templeProfile, traceStep } from './temple-browser'
import { observeSandboxHealth, requestOrigin } from './sandbox-health'
import { proveShadownet, shadownet, NetworkProofError } from '../lib/shadownet'
import { startReadOnlyGateway } from './shadownet-gateway'

const appOrigin = z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/).parse(process.env.TEMPLE_APP_ORIGIN)
test('Temple and the dApp query Shadownet without sending an operation', async ({}, info) => {
  const profile = await templeProfile()
  let context: BrowserContext | undefined
  let gateway: Awaited<ReturnType<typeof startReadOnlyGateway>> | undefined
  let rpc: { status: 'verified'; proof: Awaited<ReturnType<typeof proveShadownet>> } | { status: 'failed'; kind: string } =
    { status: 'failed', kind: 'not-run' }
  let tracing = false
  let workflowPassed = false
  let extensionOrigin: string | undefined
  let browserVersion: string | undefined
  let confirmationRenderMs: number | undefined
  const injections: string[] = []
  let health: ReturnType<typeof observeSandboxHealth> | undefined
  const observed: { client: 'temple' | 'dapp'; origin: string; chain: unknown }[] = []
  try {
    const proof = await proveShadownet({
      primaryRpc: process.env.SHADOWNET_PRIMARY_RPC ?? shadownet.primaryRpc,
      observerRpc: process.env.SHADOWNET_OBSERVER_RPC ?? shadownet.observerRpc
    })
    rpc = { status: 'verified', proof }
    gateway = await startReadOnlyGateway(proof)
    const endpoints = gateway.endpoints
    const browser = context = await launchTemple(profile)
    browserVersion = browser.browser()?.version()
    browser.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname === '/injection/operation') injections.push(url.origin + url.pathname)
    })
    await onboard(browser)
    await browser.tracing.start({ screenshots: true, snapshots: true, sources: false })
    tracing = true
    const worker = browser.serviceWorkers()[0]
    if (!worker) throw new Error('Temple extension worker is missing')
    const extensionId = new URL(worker.url()).hostname
    extensionOrigin = 'chrome-extension://' + extensionId
    const walletOrigin = extensionOrigin
    health = observeSandboxHealth(browser, appOrigin, walletOrigin)
    const app = await browser.newPage()
    const parameters = new URLSearchParams({ picker: 'custom', extensionId, rpc: gateway.origin })
    await app.goto(appOrigin + '/shadownet.html?' + parameters.toString())
    await expect(app.locator('#result')).toHaveAttribute('data-ready', 'true')
    function observeChain(client: 'temple' | 'dapp', origin: string) {
      return browser.waitForEvent('response', {
        predicate: response => response.request().method() === 'GET' &&
          response.url() === endpoints[client] + '/chains/main/chain_id' &&
          requestOrigin(response.request()) === origin
      }).then(async response => {
        expect(response.status(), client + ' chain ID response').toBe(200)
        observed.push({ client, origin, chain: await response.json() })
      })
    }
    await Promise.all([
      observeChain('dapp', appOrigin),
      observeChain('temple', walletOrigin),
      traceStep(browser, 'Approve read-only Shadownet network permission', async () => {
        const readinessStarted = Date.now()
        const [confirmation] = await Promise.all([
          browser.waitForEvent('page', { predicate: page => page.url().startsWith(walletOrigin + '/confirm.html') }),
          (async () => {
            await app.getByRole('button', { name: 'Request Shadownet permission' }).click()
            await app.getByRole('button', { name: 'Connect installed Temple' }).click()
          })()
        ])
        try { await expect(confirmation.locator('body')).toContainText('Temple Shadownet preflight') }
        finally { confirmationRenderMs = Date.now() - readinessStarted }
        await Promise.all([
          confirmation.waitForEvent('close'),
          confirmation.getByTestId('ConfirmPage/ConnectAction/ConnectButton').click()
        ])
        await expect(app.locator('#result')).toContainText('"status":"passed"')
        expect(JSON.parse(await app.locator('#result').innerText())).toMatchObject({
          status: 'passed', address: fixture.address,
          network: { type: 'custom', name: 'Shadownet read-only', rpcUrl: endpoints.temple }
        })
      })
    ])
    await traceStep(browser, 'Verify actual client responses and zero mutation attempts', async () => {
      expect(observed).toEqual(expect.arrayContaining([
        { client: 'dapp', origin: appOrigin, chain: shadownet.id },
        { client: 'temple', origin: walletOrigin, chain: shadownet.id }
      ]))
      expect(injections).toEqual([])
      expect(gateway?.calls.filter(call => call.kind === 'blocked' || call.method !== 'GET')).toEqual([])
    })
    workflowPassed = true
  } catch (error: unknown) {
    if (error instanceof NetworkProofError) rpc = { status: 'failed', kind: error.kind }
    if (context && tracing) await captureFailure(context, appOrigin, info)
    throw error
  } finally {
    let cleanupError: unknown
    for (const cleanup of [
      async () => { if (context && tracing) await context.tracing.stop({ path: info.outputPath('trace.zip') }) },
      async () => { await context?.close() },
      async () => { await gateway?.close() },
      async () => { await rm(profile, { recursive: true, force: true }) }
    ]) {
      try { await cleanup() }
      catch (error: unknown) { cleanupError ??= error }
    }
    await writeFile(info.outputPath('shadownet.json'), JSON.stringify({
      workflow: workflowPassed && !cleanupError ? 'passed' : 'failed', transfer: 'not-run',
      health: health?.() ?? null, rpc, appOrigin, extensionOrigin,
      observed, injections, calls: gateway?.calls ?? [], browserVersion, confirmationRenderMs,
      cleanupFailed: cleanupError !== undefined
    }, null, 2) + '\n')
    if (cleanupError) throw cleanupError
  }
})
