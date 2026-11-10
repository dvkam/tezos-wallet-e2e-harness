import { chromium, expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'

export const fixture = z.object({
  mnemonic: z.string(), derivationPath: z.string(), publicKey: z.string(),
  address: z.string(), payload: z.string()
}).parse(JSON.parse(await readFile('fixtures/account.json', 'utf8')))

export function templeProfile() {
  return mkdtemp(path.join(process.env.TEMPLE_PROFILE_ROOT ?? tmpdir(), 'temple-'))
}

export async function launchTemple(profile: string) {
  const extension = path.resolve('.artifacts/temple/2.0.34')
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  })
  context.setDefaultTimeout(20_000)
  return context
}

export async function onboard(context: BrowserContext): Promise<Page> {
  await expect.poll(() => context.pages().some(p => p.url().startsWith('chrome-extension:'))).toBe(true)
  const page = context.pages().find(p => p.url().startsWith('chrome-extension:'))
  if (!page) throw new Error('Temple did not open onboarding')
  await page.getByTestId('Welcome/Import Existing Wallet button').click()
  const inputs = page.getByTestId('Import Seed Form/Word Input')
  await expect(inputs).toHaveCount(12)
  for (const [index, word] of fixture.mnemonic.split(' ').entries()) await inputs.nth(index).fill(word)
  await page.getByTestId('Import Seed Form/Next Button').click()
  const password = 'Temple-Test-1!' + randomBytes(12).toString('hex')
  await page.getByTestId('Register Form/Password Field').fill(password)
  await page.getByTestId('Register Form/Repeat Password Field').fill(password)
  for (const id of ['Register Form/Analytics Check Box', 'Register Form/Get Rewards Check Box']) {
    const checkbox = page.getByTestId(id)
    if (await checkbox.isVisible()) await checkbox.click()
  }
  await page.getByTestId('Register Form/Import Button').click()
  await expect(page.getByTestId('Register Form/Password Field')).toBeHidden({timeout:30_000})
  const newsletter = page.getByTestId('Newsletter Modal/Close Button')
  if (await newsletter.isVisible()) await newsletter.click()
  return page
}

export function traceStep<T>(context: BrowserContext, name: string, run: () => Promise<T>) {
  return test.step(name, async () => {
    await context.tracing.group(name)
    try {
      return await run()
    } finally {
      await context.tracing.groupEnd()
    }
  })
}

export async function captureFailure(context: BrowserContext, appOrigin: string, info: TestInfo) {
  const pages = context.pages().filter(page => {
    const url = new URL(page.url())
    return url.origin === appOrigin ||
      (url.protocol === 'chrome-extension:' && url.pathname === '/confirm.html')
  })
  await Promise.allSettled(pages.map((page, index) =>
    page.screenshot({ path: info.outputPath('failure-' + index + '.png'), timeout: 2000 })))
}
