import { z } from 'zod'

const entry = z.object({
  name: z.string().optional(), version: z.string().optional(), resolved: z.string().optional(),
  integrity: z.string().optional(), optional: z.boolean().optional()
}).passthrough()
const lockSchema = z.object({ packages: z.record(z.string(), entry) })
const installedSchema = z.array(z.object({ path: z.string(), name: z.string(), version: z.string() }))

export function validateGraph(value: unknown, inventory: unknown) {
  const lock = lockSchema.parse(value)
  const installed = installedSchema.parse(inventory)
  const paths = new Set<string>()
  const result = installed.map(pkg => {
    if (paths.has(pkg.path)) throw new Error('Duplicate installed path: ' + pkg.path)
    paths.add(pkg.path)
    const expected = lock.packages[pkg.path]
    if (!expected || !pkg.path.startsWith('node_modules/')) throw new Error('Installed package not in the lock: ' + pkg.path)
    const expectedName = expected.name ?? pkg.path.slice(pkg.path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (pkg.name !== expectedName) throw new Error('Installed package name differs from lock at ' + pkg.path)
    if (pkg.version !== expected.version) throw new Error('Installed version differs from lock at ' + pkg.path)
    if (!expected.integrity || !expected.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error('Missing registry provenance at ' + pkg.path)
    }
    return { ...pkg, resolved: expected.resolved, integrity: expected.integrity }
  })
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (location && !paths.has(location) && !pkg.optional) throw new Error('Missing required installed package: ' + location)
  }
  return result
}

export function validateBrowserVersion(pinned: string | undefined, actual: string) {
  if (!pinned || !actual.endsWith(' ' + pinned)) throw new Error('Installed Chromium version differs from Playwright metadata')
}
