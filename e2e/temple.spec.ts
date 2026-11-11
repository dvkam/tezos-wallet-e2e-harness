import { test, expect, type BrowserContext } from '@playwright/test'
import { rm, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { observeSandboxHealth } from './sandbox-health'
import { deriveAddress, verifySignature } from '../lib/oracle.ts'

import { captureFailure, fixture, launchTemple, onboard, templeProfile, traceStep } from './temple-browser'
const completion = z.object({
  operation: z.string(), sequence: z.number(), status: z.enum(['pending', 'passed', 'rejected']),
  value: z.unknown().optional(), error: z.object({name: z.string(), message: z.string(), code:z.string().optional()}).optional()
})
const account = {address: fixture.address, publicKey: fixture.publicKey, network:'mainnet'}

test('Temple stable permission, signing and disconnect', async ({}, info) => {
  const appOrigin = process.env.TEMPLE_APP_ORIGIN || 'http://127.0.0.1:4173'
  const profile = await templeProfile()
  let context: BrowserContext | undefined
  let tracing = false
  const measurements: Record<string, unknown> = {attempt: info.repeatEachIndex, workflow:'failed', picker:process.env.TEMPLE_PICKER ?? 'custom', steps:[]}
  let health: ReturnType<typeof observeSandboxHealth> | undefined
  const steps: string[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const endpoints = new Set<string>()
  const failedRequests: {url:string; error:string | null}[] = []
  try {
    context = await launchTemple(profile)
    measurements.browserVersion = context.browser()?.version()
    const runningContext = context
    await test.step('Import the dedicated public test account through Temple UI', async () => { await onboard(runningContext) })
    steps.push('onboarded public test account')
    // Never trace the seed/password form. Only post-onboarding requests are captured.
    await context.tracing.start({screenshots:true, snapshots:true, sources:false})
    tracing = true
    const app = await context.newPage()
    app.on('pageerror', error => pageErrors.push(error.message))
    app.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    context.on('request', request => {
      const url = new URL(request.url())
      if (url.protocol === 'https:') endpoints.add(url.origin + url.pathname)
    })
    context.on('requestfailed', request => {
      const url = new URL(request.url())
      failedRequests.push({url:url.origin + url.pathname, error:request.failure()?.errorText ?? null})
    })
    const worker = context.serviceWorkers()[0]
    if (!worker) throw new Error('Temple extension worker is missing')
    const extensionId = new URL(worker.url()).hostname
    measurements.extensionId = extensionId
    health = observeSandboxHealth(context, appOrigin, 'chrome-extension://' + extensionId)
    const custom = process.env.TEMPLE_PICKER !== 'default'
    await app.goto(appOrigin + '/' + (custom ? '?picker=custom&extensionId=' + extensionId : ''))
    await expect(app.locator('#result')).toHaveAttribute('data-ready','true')
    let sequence = 0
    async function completed(operation:string, status:'passed'|'rejected') {
      const expected = ++sequence
      await expect.poll(async () => {
        const parsed = completion.safeParse(JSON.parse(await app.locator('#result').innerText()))
        return parsed.success ? {operation:parsed.data.operation, sequence:parsed.data.sequence, status:parsed.data.status} : null
      }, {timeout:30_000}).toEqual({operation,sequence:expected,status})
      const result = completion.parse(JSON.parse(await app.locator('#result').innerText()))
      if (status === 'rejected') {
        expect(result.error?.code).toBe('ABORTED_ERROR')
        expect(result.value).toBeUndefined()
      }
      return result
    }
    async function actWithConfirmation(action:'permission'|'sign', approve:boolean, firstPairing = false) {
      const popup = runningContext.waitForEvent('page', {predicate:p => p.url().includes('/confirm.html')})
      const trigger = async () => {
      await app.locator('#' + action).click()
      if (firstPairing) {
        if (custom) await app.getByRole('button',{name:'Connect installed Temple'}).click()
        else {
          await app.getByText('Show more',{exact:true}).click()
          await app.getByText('Temple Wallet',{exact:true}).click()
        }
      }
      }
      const [confirmation] = await Promise.all([popup,trigger()])
      await expect(confirmation.locator('body')).toContainText('Temple stable baseline',{timeout:20_000})
      const id = action === 'permission'
        ? 'ConfirmPage/ConnectAction/' + (approve ? 'ConnectButton' : 'CancelButton')
        : 'ConfirmPage/SignAction/' + (approve ? 'SignButton' : 'RejectButton')
      await Promise.all([confirmation.waitForEvent('close'), confirmation.getByTestId(id).click()])
      return completed(action,approve ? 'passed':'rejected')
    }
    await traceStep(runningContext, 'Reject permission and leave no active account', async () => {
      await actWithConfirmation('permission',false,true)
      await app.locator('#account').click()
      expect((await completed('account','passed')).value).toBeNull()
    })
    steps.push('permission rejected; account remains absent')
    await traceStep(runningContext, 'Recover with approved permission and exact expected identity', async () => {
      expect((await actWithConfirmation('permission',true,true)).value).toEqual(account)
      expect(deriveAddress(fixture.publicKey)).toBe(fixture.address)
    })
    steps.push('permission recovery; exact independent identity')
    await traceStep(runningContext, 'Prove the authorized account persists before testing cleanup', async () => {
      await app.reload()
      await expect(app.locator('#result')).toHaveAttribute('data-ready','true')
      sequence = 0
      await app.locator('#account').click()
      expect((await completed('account','passed')).value).toEqual(account)
    })
    steps.push('authorized account survives reload')
    await traceStep(runningContext, 'Approve signing and independently verify the exact challenge', async () => {
      const result = await actWithConfirmation('sign',true)
      const signed = z.object({requestedPayload:z.string(), response:z.object({signature:z.string(),signingType:z.unknown().optional()})}).parse(result.value)
      expect(signed.requestedPayload).toBe(fixture.payload)
      expect(verifySignature(fixture.payload,fixture.publicKey,signed.response.signature)).toBe(true)
      expect(verifySignature(fixture.payload.slice(0,-2)+'00',fixture.publicKey,signed.response.signature)).toBe(false)
      measurements.signingTypeContract = {status:signed.response.signingType === 'micheline' ? 'passed':'failed', expected:'micheline', observed:signed.response.signingType ?? null}
      measurements.signature = signed.response.signature
    })
    steps.push('signature verified; changed-payload negative control rejected')
    await traceStep(runningContext, 'Reject signing and preserve the authorized account', async () => {
      await actWithConfirmation('sign',false)
      await app.locator('#account').click()
      expect((await completed('account','passed')).value).toEqual(account)
    })
    steps.push('signing rejected; account preserved')
    await traceStep(runningContext, 'Disconnect and prove the account stays absent after reload', async () => {
      await app.locator('#disconnect').click()
      expect((await completed('disconnect','passed')).value).toBeNull()
      await app.reload()
      await expect(app.locator('#result')).toHaveAttribute('data-ready','true')
      sequence = 0
      await app.locator('#account').click()
      expect((await completed('account','passed')).value).toBeNull()
    })
    steps.push('disconnect clears account across reload')
    measurements.workflow = 'passed'
    await app.screenshot({path:info.outputPath('consumer.png')})
  } catch (error) {
    if (context && tracing) await captureFailure(context, appOrigin, info)
    throw error
  } finally {
    measurements.steps = steps
    measurements.health = health?.() ?? null
    measurements.pageErrors = pageErrors
    measurements.consoleErrors = consoleErrors
    measurements.failedRequests = failedRequests
    measurements.externalEndpoints = [...endpoints].sort()
    try {
    await writeFile(info.outputPath('measurement.json'), JSON.stringify(measurements,null,2))
    await info.attach('measurement',{path:info.outputPath('measurement.json'),contentType:'application/json'})
    } finally {
    try {
      if (context && tracing) await context.tracing.stop({path:info.outputPath('trace.zip')})
    } finally {
      try { await context?.close() }
      finally { await rm(profile,{recursive:true,force:true}) }
    }
    }
  }
})
