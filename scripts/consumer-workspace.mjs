import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'

export const laneVersions = {
  stable: { beacon: '4.8.5-ecad', taquito: '25.1.1' },
  candidate: { beacon: '4.9.0-ecad-beta.0', taquito: '25.2.0-beta1' },
  historical: { beacon: '4.8.4-ecad', taquito: '25.1.0' }
}
export function parseRunArgs(args) {
  const mode = args[0] ?? 'lifecycle'
  if (!['lifecycle', 'network', 'transfer', 'check'].includes(mode)) throw new Error('Expected lifecycle, network, transfer, or check')
  const rest = args.slice(1)
  if (rest.length && (rest.length !== 2 || rest[0] !== '--lane')) throw new Error('Use --lane stable|candidate|historical')
  const lane = rest[1] ?? 'stable'
  if (!Object.hasOwn(laneVersions, lane)) throw new Error('Unknown consumer lane: ' + lane)
  return { mode, lane }
}
export const sha256 = data => createHash('sha256').update(data).digest('hex')

// These directories contain the runnable harness. Never snapshot .env files, profiles or reports.
const directories = ['src', 'e2e', 'lib', 'tests', 'scripts', 'public', 'fixtures', 'formal', 'consumers']
const rootFiles = ['index.html', 'sandbox.html', 'baseline.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.sandbox.config.ts']

async function filesBelow(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['__pycache__', 'node_modules', 'dist'].includes(entry.name)) continue
    const relative = path.join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Source symlinks are not supported: ' + relative)
    if (entry.isDirectory()) files.push(...await filesBelow(path.join(directory, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}
export async function prepareWorkspace({ sourceRoot, lane, reportDirectory }) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'temple-consumer-'))
  try {
    const sourceHashes = {}
    for (const name of directories) {
      const source = path.join(sourceRoot, name)
      let files
      try { files = await filesBelow(source) }
      catch (error) { if (error.code === 'ENOENT' && name === 'formal') continue; throw error }
      for (const file of files) {
        const relative = path.join(name, file)
        const body = await readFile(path.join(sourceRoot, relative))
        await mkdir(path.dirname(path.join(workspace, relative)), { recursive: true })
        await writeFile(path.join(workspace, relative), body)
        sourceHashes[relative] = sha256(body)
      }
    }
    for (const name of rootFiles) {
      const body = await readFile(path.join(sourceRoot, name))
      await writeFile(path.join(workspace, name), body)
      sourceHashes[name] = sha256(body)
    }
    for (const name of ['package.json', 'package-lock.json']) {
      await cp(path.join(sourceRoot, 'consumers', lane, name), path.join(workspace, name))
      await cp(path.join(workspace, name), path.join(reportDirectory, name))
    }
    const snapshot = JSON.stringify(Object.fromEntries(Object.entries(sourceHashes).sort()), null, 2) + '\n'
    await writeFile(path.join(reportDirectory, 'source-files.json'), snapshot)
    return { workspace, sourceSha256: sha256(snapshot) }
  } catch (error) {
    await rm(workspace, { recursive: true, force: true })
    throw error
  }
}
