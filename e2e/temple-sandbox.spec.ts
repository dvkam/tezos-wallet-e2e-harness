import { test, expect, type BrowserContext } from '@playwright/test'
import { rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { captureFailure, fixture, launchTemple, onboard, templeProfile, traceStep } from './temple-browser'
import { startTezbox } from './tezbox'
import { sandboxChain, sandboxRpc } from '../src/sandbox-chain'

import { observeSandboxHealth, requestOrigin } from './sandbox-health'

const appOrigin = z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/).parse(process.env.TEMPLE_APP_ORIGIN)
const mode = process.env.TEMPLE_SANDBOX_MODE
if (mode !== 'network' && mode !== 'transfer') throw new Error('Select the Temple sandbox test through its npm command')
const receiptSchema = z.object({
  hash: z.string(),
  contents: z.array(z.object({ kind: z.string() }).passthrough())
})
const transactionSchema = z.object({
  source: z.string(),
  destination: z.string(),
  amount: z.string(),
  metadata: z.object({ operation_result: z.object({ status: z.string() }) })
})

test(mode === 'network' ? 'Temple approves the custom Tezbox network' : 'Temple sends one Taquito transfer on Tezbox', async ({}, info) => {
  const profile = await templeProfile()
  let sandbox: Awaited<ReturnType<typeof startTezbox>> | undefined
  let context: BrowserContext | undefined
  let tracing = false
  let browserVersion: string | undefined
  let workflowPassed = false
  let health: ReturnType<typeof observeSandboxHealth> | undefined
  let confirmedTransfer: object | undefined
  const observed: { client: 'temple' | 'dapp'; origin: string; chain: unknown }[] = []
  try {
    const tezbox = sandbox = await startTezbox()
    const browser = context = await launchTemple(profile)
    browserVersion = browser.browser()?.version()
    await onboard(browser)
    await browser.tracing.start({ screenshots: true, snapshots: true, sources: false })
    tracing = true
    const worker = browser.serviceWorkers()[0]
    if (!worker) throw new Error('Temple extension worker is missing')
    const extensionId = new URL(worker.url()).hostname
    const endpoints = sandboxRpc(tezbox.origin)
    const extensionOrigin = 'chrome-extension://' + extensionId
    health = observeSandboxHealth(browser, appOrigin, extensionOrigin)
    const app = await browser.newPage()
    function observeChain(client: 'temple' | 'dapp', origin: string) {
      return browser.waitForEvent('response', {
        predicate: response => response.request().method() === 'GET' &&
          response.url() === endpoints[client] + '/chains/main/chain_id' &&
          requestOrigin(response.request()) === origin
      }).then(async response => {
        expect(response.status(), client + ' chain ID response').toBe(200)
        const chain: unknown = await response.json()
        observed.push({ client, origin, chain })
      })
    }
    const parameters = new URLSearchParams({ picker: 'custom', extensionId, rpc: tezbox.origin, mode })
    await app.goto(appOrigin + '/sandbox.html?' + parameters.toString())
    await expect(app.locator('#result')).toHaveAttribute('data-ready', 'true')

    await Promise.all([
      observeChain('dapp', appOrigin),
      observeChain('temple', extensionOrigin),
      traceStep(browser, 'Approve custom permissions in Temple', async () => {
        const [confirmation] = await Promise.all([
          browser.waitForEvent('page', { predicate: page => page.url().startsWith(extensionOrigin + '/confirm.html') }),
          (async () => {
            await app.getByRole('button', { name: 'Request sandbox permission' }).click()
            await app.getByRole('button', { name: 'Connect installed Temple' }).click()
          })()
        ])
        await expect(confirmation.locator('body')).toContainText('Temple Tezbox test')
        await Promise.all([
          confirmation.waitForEvent('close'),
          confirmation.getByTestId('ConfirmPage/ConnectAction/ConnectButton').click()
        ])
        await expect(app.locator('#result')).toContainText('"status":"passed"')
        const response = z.object({
          status: z.literal('passed'), address: z.string(), publicKey: z.string(),
          network: z.object({ type: z.literal('custom'), name: z.string(), rpcUrl: z.string() }),
          scopes: z.array(z.string())
        }).parse(JSON.parse(await app.locator('#result').innerText()))
        expect(response).toMatchObject({
          address: fixture.address,
          publicKey: fixture.publicKey,
          network: { type: 'custom', name: sandboxChain.name, rpcUrl: endpoints.temple },
          scopes: expect.arrayContaining(['operation_request', 'sign'])
        })
      })
    ])
    await traceStep(browser, 'Verify both clients reached the pinned chain before any injection', async () => {
      await expect.poll(() => observed).toEqual(expect.arrayContaining([
        { client: 'dapp', origin: appOrigin, chain: sandboxChain.id },
        { client: 'temple', origin: extensionOrigin, chain: sandboxChain.id }
      ]))
      for (const client of ['temple', 'dapp']) {
        expect(tezbox.calls).toContainEqual({ client, method: 'GET', path: '/chains/main/chain_id', status: 200 })
      }
      expect(tezbox.calls.filter(call => call.path === '/injection/operation')).toEqual([])
    })
    if (mode === 'transfer') {
      await traceStep(browser, 'Fund the test account on the owned sandbox', async () => {
        await tezbox.fund(fixture.address)
        await expect.poll(() => tezbox.rpc('/chains/main/blocks/head/context/contracts/' + fixture.address + '/balance'),
          { timeout: 25_000 }).toBe('5000000')
      })
      await traceStep(browser, 'Approve one Taquito transfer and verify the applied receipt', async () => {
        const balancePath = '/chains/main/blocks/head/context/contracts/' + sandboxChain.recipient + '/balance'
        const balance = async () => BigInt(z.string().regex(/^\d+$/).parse(await tezbox.rpc(balancePath)))
        const before = await balance()
        const headLevel = async () => z.object({ level: z.number().int() })
          .parse(await tezbox.rpc('/chains/main/blocks/head/header')).level
        let nextLevel = (await headLevel()) + 1
        const [injection] = await Promise.all([
          browser.waitForEvent('response', {
            predicate: response => response.request().method() === 'POST' &&
              new URL(response.url()).pathname === '/temple/injection/operation' &&
              new URL(response.url()).origin === tezbox.origin &&
              requestOrigin(response.request()) === extensionOrigin
          }),
          (async () => {
            const [confirmation] = await Promise.all([
              browser.waitForEvent('page', { predicate: page => page.url().startsWith(extensionOrigin + '/confirm.html') }),
              app.getByRole('button', { name: 'Send sandbox transfer' }).click()
            ])
            await expect(confirmation.locator('body')).toContainText('Temple Tezbox test')
            const approve = confirmation.getByTestId('ConfirmPage/ConfirmOperationsAction/ConfirmButton')
            await expect(approve).toBeEnabled()
            expect(tezbox.calls.filter(call => call.path === '/injection/operation')).toEqual([])
            tezbox.allowWalletInjection()
            await Promise.all([
              confirmation.waitForEvent('close'),
              approve.click()
            ])
          })()
        ])
        expect(injection.status(), 'Temple injection response').toBe(200)
        const hash = z.string().parse(await injection.json())
        await expect(app.locator('#result')).toContainText('"operation":"transfer","status":"passed"')
        expect(JSON.parse(await app.locator('#result').innerText())).toEqual({ operation: 'transfer', status: 'passed', hash })
        let receipt: z.infer<typeof receiptSchema> | undefined
        await expect.poll(async () => {
          const head = await headLevel()
          for (; nextLevel <= head; nextLevel++) {
            const groups = z.array(receiptSchema).parse(await tezbox.rpc('/chains/main/blocks/' + nextLevel + '/operations/3'))
            receipt = groups.find(group => group.hash === hash)
            if (receipt) return receipt.hash
          }
          return undefined
        }, { timeout: 30_000 }).toBe(hash)
        if (!receipt) throw new Error('The sandbox did not include the operation')
        const kinds = receipt.contents.map(content => content.kind)
        expect(kinds).toEqual(kinds.length === 1 ? ['transaction'] : ['reveal', 'transaction'])
        for (const reveal of receipt.contents.filter(content => content.kind === 'reveal')) {
          expect(reveal).toMatchObject({
            source: fixture.address, public_key: fixture.publicKey,
            metadata: { operation_result: { status: 'applied' } }
          })
        }
        const transactions = receipt.contents.filter(content => content.kind === 'transaction')
        expect(transactions).toHaveLength(1)
        expect(transactionSchema.parse(transactions[0])).toEqual({
          source: fixture.address,
          destination: sandboxChain.recipient,
          amount: String(sandboxChain.amountMutez),
          metadata: { operation_result: { status: 'applied' } }
        })
        const after = await balance()
        expect(after - before).toBe(BigInt(sandboxChain.amountMutez))
        expect(tezbox.calls.filter(call => call.path === '/injection/operation')).toEqual([
          { client: 'temple', method: 'POST', path: '/injection/operation', status: 200 }
        ])
        confirmedTransfer = { hash, level: nextLevel, receipt, recipientBefore: String(before), recipientAfter: String(after) }
      })
    }
    workflowPassed = true
  } catch (error) {
    if (context && tracing) await captureFailure(context, appOrigin, info)
    throw error
  } finally {
    try {
      const chain = sandbox && { image: sandbox.image, id: sandboxChain.id, genesis: sandboxChain.genesis }
      await writeFile(info.outputPath('sandbox.json'), JSON.stringify({
        workflow: workflowPassed ? 'passed' : 'failed',
        transfer: mode === 'network' ? 'not-run' : confirmedTransfer ? 'passed' : 'failed',
        health: health?.() ?? null,
        browserVersion, chain, observed, rpc: sandbox?.calls, confirmedTransfer
      }, null, 2))
      if (context && tracing) await context.tracing.stop({ path: info.outputPath('trace.zip') })
      if (sandbox) {
        const log = await sandbox.logs().catch(error => String(error))
        await writeFile(info.outputPath('tezbox.log'), log)
      }
    } finally {
      try { await context?.close() }
      finally {
        try { await rm(profile, { recursive: true, force: true }) }
        finally { await sandbox?.close() }
      }
    }
  }
})
