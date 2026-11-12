import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const { stdout } = await promisify(execFile)('python3', [fileURLToPath(new URL('./umami_artifact.py', import.meta.url))], { env: process.env, timeout: 30_000 })
process.stdout.write(stdout)
