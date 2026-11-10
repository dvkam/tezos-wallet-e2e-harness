import assert from 'node:assert/strict'
import { test } from 'node:test'
import bs58check from 'bs58check'
import { deriveAddress, verifySignature } from '../lib/oracle.ts'

// The native Node crypto backend produced this signature independently.
const publicKey = 'edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf'
const payload = '05010000003754657a6f73205369676e6564204d6573736167653a2054656d706c6520737461626c6520626173656c696e652074657374206f6e6c792e'
const signature = 'edsigu4QgRjMBRfXuoMVfXDpM8uoQcBaNnjRzeAwpbNCAsKjBKkMrFu6WLud8dATuCmffABZJdT8VvnNbUFWtR2bVuty9mSPN7k'

test('derives the independently established test account', () => {
  assert.equal(deriveAddress(publicKey), 'tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL')
})
test('accepts the native-crypto signature of the exact bytes', () => {
  assert.equal(verifySignature(payload, publicKey, signature), true)
})
test('rejects a changed requested payload', () => {
  assert.equal(verifySignature(payload.slice(0, -2) + '00', publicKey, signature), false)
})
test('rejects a changed signature with a valid checksum', () => {
  const bytes = bs58check.decode(signature)
  bytes[bytes.length - 1] ^= 1
  assert.equal(verifySignature(payload, publicKey, bs58check.encode(bytes)), false)
})
test('rejects malformed encodings', () => {
  assert.equal(verifySignature(payload, publicKey, 'invalid'), false)
  assert.equal(verifySignature('odd', publicKey, signature), false)
})
