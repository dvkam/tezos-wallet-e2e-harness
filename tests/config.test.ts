import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConsumerConfig } from '../src/config.ts'

test('requires a valid extension ID for the custom picker', () => {
  const extensionId = 'a'.repeat(32)
  assert.deepEqual(parseConsumerConfig(new URLSearchParams()), { picker: 'default' })
  assert.deepEqual(parseConsumerConfig(new URLSearchParams({ picker: 'custom', extensionId })), {
    picker: 'custom', extensionId
  })
  for (const value of ['picker=custom', 'picker=custom&extensionId=invalid', 'picker=wrong']) {
    assert.throws(() => parseConsumerConfig(new URLSearchParams(value)))
  }
})
