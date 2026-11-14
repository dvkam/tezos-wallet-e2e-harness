import assert from 'node:assert/strict'
import { test } from 'node:test'
import { devtoolsEndpoint } from '../e2e/umami/driver.ts'

test('reads the CDP port Chromium chose only once its announcement is complete', () => {
  const noise = '[1234:ERROR:bus.cc] Failed to connect to the bus\n'
  assert.equal(devtoolsEndpoint(noise), undefined)
  assert.equal(devtoolsEndpoint(noise + 'DevTools listening on ws://127.0.0.1:45'), undefined)
  assert.equal(devtoolsEndpoint(noise + 'DevTools listening on ws://127.0.0.1:45678/devtools/browser/abc\n'), 'http://127.0.0.1:45678')
  assert.equal(devtoolsEndpoint('DevTools listening on ws://192.0.2.1:45678/devtools/browser/abc\n'), undefined)
})
