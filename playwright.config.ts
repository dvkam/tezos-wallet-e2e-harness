import { defineConfig } from '@playwright/test'
import path from 'node:path'

const reportDirectory = process.env.TEMPLE_REPORT_DIR ?? 'reports/exploratory'
const repeats = Number(process.env.TEMPLE_REPEATS ?? '3')
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) {
  throw new Error('TEMPLE_REPEATS must be an integer from 1 to 3')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'temple.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: repeats,
  timeout: 180_000,
  globalTimeout: 600_000,
  outputDir: path.join(reportDirectory, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(reportDirectory, 'playwright.json') }]],
  webServer: process.env.TEMPLE_APP_ORIGIN ? undefined : {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false
  }
})
