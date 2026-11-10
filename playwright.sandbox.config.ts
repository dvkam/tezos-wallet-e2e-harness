import { defineConfig } from '@playwright/test'
import path from 'node:path'

const directory = process.env.TEMPLE_REPORT_DIR
if (!directory) throw new Error('Run npm run temple:network or npm run temple:transfer')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'temple-sandbox.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 150_000,
  globalTimeout: 180_000,
  outputDir: path.join(directory, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(directory, 'playwright.json') }]]
})
