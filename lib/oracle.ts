import nacl from 'tweetnacl'
import blake from 'blakejs'
import bs58check from 'bs58check'

function decode(value: string, prefix: number[], size: number): Uint8Array {
  const bytes = bs58check.decode(value)
  if (bytes.length !== prefix.length + size || prefix.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('Unexpected Tezos encoding')
  }
  return bytes.subarray(prefix.length)
}

export function deriveAddress(publicKey: string): string {
  const bytes = decode(publicKey, [13, 15, 37, 217], 32)
  const hash = blake.blake2b(bytes, undefined, 20)
  return bs58check.encode(Uint8Array.from([6, 161, 159, ...hash]))
}

export function verifySignature(payload: string, publicKey: string, signature: string): boolean {
  if (!/^(?:[a-f0-9]{2})+$/i.test(payload)) return false
  try {
    const key = decode(publicKey, [13, 15, 37, 217], 32)
    const sig = signature.startsWith('edsig')
      ? decode(signature, [9, 245, 205, 134, 18], 64)
      : decode(signature, [4, 130, 43], 64)
    const hash = blake.blake2b(Buffer.from(payload, 'hex'), undefined, 32)
    return nacl.sign.detached.verify(hash, sig, key)
  } catch {
    return false
  }
}
