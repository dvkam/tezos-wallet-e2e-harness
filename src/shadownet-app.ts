import { TezosToolkit } from '@taquito/taquito'
import { NetworkType, PermissionScope } from '@ecadlabs/beacon-types'
import { parseConsumerConfig } from './config'
import { describeError } from './errors'
import { sandboxRpc } from './sandbox-chain'
import { createTempleWallet } from './temple-wallet'
import { shadownet } from '../lib/shadownet'

const query = new URLSearchParams(location.search)
const picker = parseConsumerConfig(query)
if (picker.picker !== 'custom') throw new Error('Select the unpacked Temple extension')
const endpoints = sandboxRpc(query.get('rpc'))
const network = { type: NetworkType.CUSTOM, name: 'Shadownet read-only', rpcUrl: endpoints.temple }
const wallet = createTempleWallet('Temple Shadownet preflight', network, picker)
const tezos = new TezosToolkit(endpoints.dapp)
tezos.setWalletProvider(wallet)
const result = document.querySelector('#result')
const permission = document.querySelector('#permission')
if (!(result instanceof HTMLElement) || !(permission instanceof HTMLButtonElement)) throw new Error('Network controls are missing')
permission.addEventListener('click', async () => {
  permission.disabled = true
  try {
    if (await tezos.rpc.getChainId() !== shadownet.id ||
        await tezos.rpc.getBlockHash({ block: '0' }) !== shadownet.genesis) throw new Error('Unexpected dApp chain identity')
    await wallet.requestPermissions({ scopes: [PermissionScope.OPERATION_REQUEST, PermissionScope.SIGN] })
    const account = await wallet.client.getActiveAccount()
    if (!account) throw new Error('Permission returned without an account')
    result.textContent = JSON.stringify({ status: 'passed', address: await tezos.wallet.pkh(), network: account.network })
  } catch (error: unknown) {
    result.textContent = JSON.stringify({ status: 'rejected', error: describeError(error) })
  }
})
result.dataset.ready = 'true'
