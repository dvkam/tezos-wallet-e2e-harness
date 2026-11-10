export const sandboxChain = {
  name: 'Tezbox Ushuaia',
  recipient: 'tz1aSkwEot3L2kmUvcoxzjMomb9mvBNuzFK6',
  amountMutez: 100_000,
  id: 'NetXtJqPyJGB6Pc',
  genesis: 'BL7aN4FRNydwCVRo4KB16FibBmu6LdzuTC4hxGqyziCVRhkdFBp'
}

export function sandboxRpc(value: string | null) {
  if (!value || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) {
    throw new Error('Expected a loopback Tezbox RPC origin')
  }
  const url = new URL(value)
  if (!url.port || url.origin !== value) throw new Error('Expected an explicit Tezbox port')
  return { temple: url.origin + '/temple', dapp: url.origin + '/dapp' }
}
