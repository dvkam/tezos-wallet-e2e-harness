import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { z } from 'zod'
import { validateGraph, validateBrowserVersion } from './consumer-graph.ts'
import { laneVersions, sha256 } from './consumer-workspace.mjs'

const [lane, destination, browser] = process.argv.slice(2)
if (!lane || !Object.hasOwn(laneVersions, lane) || !destination) throw new Error('Expected lane and report destination')
const versions = z.record(z.string(), z.object({ beacon: z.string(), taquito: z.string() })).parse(laneVersions)[lane]
if (!versions) throw new Error('Unknown lane')
const packageSchema = z.object({ name: z.string(), version: z.string() })
const manifestBytes = await readFile('package.json')
const lockBytes = await readFile('package-lock.json')
const manifest = z.object({ dependencies: z.record(z.string(), z.string()) }).parse(JSON.parse(manifestBytes.toString()))
const expectedDirect = {
  '@ecadlabs/beacon-dapp': versions.beacon, '@ecadlabs/beacon-types': versions.beacon,
  '@taquito/beacon-wallet': versions.taquito, '@taquito/taquito': versions.taquito
}
for (const [name, version] of Object.entries(expectedDirect)) {
  if (manifest.dependencies[name] !== version) throw new Error('Manifest does not match lane: ' + name)
}
const inventory: { path: string; name: string; version: string }[] = []
async function walk(directory: string, optional = false): Promise<void> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) }
  catch (error) {
    if (optional && error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const location = path.join(directory, entry.name)
    if (entry.isSymbolicLink() || !(await lstat(location)).isDirectory()) throw new Error('Unexpected installed entry: ' + location)
    if (entry.name.startsWith('@')) { await walk(location); continue }
    const pkg = packageSchema.parse(JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8')))
    inventory.push({ path: location.split(path.sep).join('/'), ...pkg })
    await walk(path.join(location, 'node_modules'), true)
  }
}
await walk('node_modules')
const installed = validateGraph(JSON.parse(lockBytes.toString()), inventory)
for (const [name, version] of Object.entries(expectedDirect)) {
  if (!installed.some(pkg => pkg.path === 'node_modules/' + name && pkg.version === version)) throw new Error('Direct package not installed: ' + name)
}
const beacon = installed.filter(pkg => pkg.name.startsWith('@ecadlabs/beacon-'))
if (beacon.some(pkg => pkg.version !== versions.beacon)) throw new Error('Mixed Beacon versions in installed closure')
execFileSync('npm', ['ls', '--all', '--json'], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const require = createRequire(import.meta.url)
const browsers = z.object({ browsers: z.array(z.object({ name: z.string(), revision: z.string(), browserVersion: z.string().optional() })) })
  .parse(JSON.parse(await readFile(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8')))
let actualBrowser: string | null = null
if (browser === '--browser') {
  const { chromium } = await import('@playwright/test')
  actualBrowser = execFileSync(chromium.executablePath(), ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim()
  const pinned = browsers.browsers.find(value => value.name === 'chromium')
  validateBrowserVersion(pinned?.browserVersion, actualBrowser)
}
const byName = new Map<string, string[]>()
for (const pkg of installed) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg.path])
await writeFile(destination, JSON.stringify({
  lane, manifestSha256: sha256(manifestBytes), lockSha256: sha256(lockBytes),
  node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  platform: process.platform, architecture: process.arch,
  browser: { pinned: browsers.browsers.find(value => value.name === 'chromium'), actual: actualBrowser },
  packages: installed,
  omittedOptionalPaths: Object.keys(JSON.parse(lockBytes.toString()).packages).filter(location => location && !installed.some(pkg => pkg.path === location)),
  duplicates: Object.fromEntries([...byName].filter(([, paths]) => paths.length > 1))
}, null, 2) + '\n')
