import { defineConfig } from '@playwright/test'
import path from 'node:path'
const report = process.env.WALLET_REPORT_DIR
if (!report || !process.env.WALLET_APP_ORIGIN) throw new Error('Use the owned Umami runner')
export default defineConfig({
  testDir: './e2e/umami',
  testMatch: 'umami.spec.ts',
  timeout: 240_000,
  globalTimeout: 800_000,
  workers: 1,
  retries: 0,
  repeatEach: 3,
  outputDir: path.join(report, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(report, 'playwright.json') }]],
  use: { trace: 'off', screenshot: 'off', video: 'off' }
})
