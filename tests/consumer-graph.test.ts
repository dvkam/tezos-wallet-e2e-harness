import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateGraph, validateBrowserVersion } from '../scripts/consumer-graph.ts'

const packages = {
  '': { name: 'test', version: '0.1.0', dependencies: { '@ecadlabs/beacon-dapp': '4.8.5-ecad' } },
  'node_modules/@ecadlabs/beacon-dapp': { version: '4.8.5-ecad', resolved: 'https://registry.npmjs.org/a.tgz', integrity: 'sha512-test' }
}
test('rejects an installed dependency that differs from the selected lock, including nested SDK copies', () => {
  const installed = [
    { path: 'node_modules/@ecadlabs/beacon-dapp', name: '@ecadlabs/beacon-dapp', version: '4.8.5-ecad' }
  ]
  assert.doesNotThrow(() => validateGraph({ packages }, installed))
  assert.throws(() => validateGraph({ packages }, [{ ...installed[0], name: '@other/sdk' }]), /name/)
  assert.throws(() => validateGraph({ packages }, [{ ...installed[0], version: '4.8.4-ecad' }]), /version/)
  assert.throws(() => validateGraph({ packages }, [...installed, {
    path: 'node_modules/other/node_modules/@ecadlabs/beacon-dapp', name: '@ecadlabs/beacon-dapp', version: '4.8.4-ecad'
  }]), /not in the lock/)
})

test('requires the actual Chromium version to match the pinned browser', () => {
  assert.doesNotThrow(() => validateBrowserVersion('148.0.0.1', 'Chromium 148.0.0.1'))
  assert.throws(() => validateBrowserVersion('148.0.0.1', 'Chromium 147.0.0.1'), /differs/)
  assert.throws(() => validateBrowserVersion(undefined, 'Chromium 148.0.0.1'), /differs/)
})
