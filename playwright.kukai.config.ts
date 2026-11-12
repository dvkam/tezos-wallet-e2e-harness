import { defineConfig } from '@playwright/test'
import path from 'node:path'
const report = process.env.WALLET_REPORT_DIR
if (!report || !process.env.WALLET_APP_ORIGIN || !process.env.KUKAI_WALLET_ORIGIN) {
  throw new Error('Run through npm run kukai:lifecycle')
}
export default defineConfig({
  testDir: './e2e', testMatch: 'kukai.spec.ts', workers: 1, retries: 0, repeatEach: 3,
  timeout: 240_000, globalTimeout: 760_000, outputDir: path.join(report, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(report, 'playwright.json') }]]
})
