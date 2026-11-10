import { BeaconWallet, BeaconEvent } from '@taquito/beacon-wallet'
import { ExtensionMessageTarget, type Network } from '@ecadlabs/beacon-types'
import type { parseConsumerConfig } from './config'

export function createTempleWallet(name: string, network: Network, picker: ReturnType<typeof parseConsumerConfig>) {
  const connect = document.querySelector('#connect-temple')
  if (!(connect instanceof HTMLButtonElement)) throw new Error('Temple pairing button is missing')
  let pairingPayload: string | undefined
  if (picker.picker === 'custom') {
    const extensionId = picker.extensionId
    connect.hidden = false
    connect.addEventListener('click', () => {
      if (!pairingPayload) throw new Error('Pairing is not ready')
      window.postMessage({
        target: ExtensionMessageTarget.EXTENSION,
        payload: pairingPayload,
        targetId: extensionId
      }, location.origin)
      connect.disabled = true
      pairingPayload = undefined
    })
  }
  return new BeaconWallet({
    name,
    enableMetrics: false,
    network,
    eventHandlers: picker.picker === 'custom' ? {
      [BeaconEvent.PAIR_INIT]: {
        handler: async data => {
          pairingPayload = await data.postmessagePeerInfo
          connect.disabled = false
        }
      }
    } : undefined
  })
}
