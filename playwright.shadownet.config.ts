import { defineConfig } from '@playwright/test'
import path from 'node:path'
const directory = process.env.TEMPLE_REPORT_DIR
if (!directory) throw new Error('Run npm run temple:shadownet:network')
export default defineConfig({
  testDir: './e2e', testMatch: 'temple-shadownet.spec.ts',
  workers: 1, retries: 0, expect: { timeout: 20_000 }, timeout: 180_000, globalTimeout: 210_000,
  outputDir: path.join(directory, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(directory, 'playwright.json') }]]
})
