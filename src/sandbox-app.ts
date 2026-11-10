import { TezosToolkit } from '@taquito/taquito'
import { NetworkType, PermissionScope } from '@ecadlabs/beacon-types'
import { parseConsumerConfig } from './config'
import { describeError } from './errors'
import { sandboxChain, sandboxRpc } from './sandbox-chain'
import { createTempleWallet } from './temple-wallet'

const query = new URLSearchParams(location.search)
const picker = parseConsumerConfig(query)
if (picker.picker !== 'custom') throw new Error('Select the unpacked Temple extension')
const endpoints = sandboxRpc(query.get('rpc'))
const network = { type: NetworkType.CUSTOM, name: sandboxChain.name, rpcUrl: endpoints.temple }
const wallet = createTempleWallet('Temple Tezbox test', network, picker)
const tezos = new TezosToolkit(endpoints.dapp)
tezos.setWalletProvider(wallet)

const result = document.querySelector('#result')
const permission = document.querySelector('#permission')
const transfer = document.querySelector('#transfer')
if (!(result instanceof HTMLElement) || !(permission instanceof HTMLButtonElement) || !(transfer instanceof HTMLButtonElement)) {
  throw new Error('Sandbox controls are missing')
}
permission.addEventListener('click', async () => {
  permission.disabled = true
  try {
    if (await tezos.rpc.getChainId() !== sandboxChain.id) throw new Error('Unexpected dApp chain ID')
    await wallet.requestPermissions({ scopes: [PermissionScope.OPERATION_REQUEST, PermissionScope.SIGN] })
    const account = await wallet.client.getActiveAccount()
    if (!account) throw new Error('Sandbox permission returned without an account')
    result.textContent = JSON.stringify({
      status: 'passed',
      address: await tezos.wallet.pkh(),
      publicKey: await wallet.getPK(),
      network: account.network,
      scopes: account.scopes
    })
    transfer.disabled = query.get('mode') !== 'transfer'
  } catch (error: unknown) {
    result.textContent = JSON.stringify({ status: 'rejected', error: describeError(error) })
  }
})
transfer.addEventListener('click', async () => {
  transfer.disabled = true
  try {
    const account = await wallet.client.getActiveAccount()
    if (!account || account.network.type !== network.type || account.network.name !== network.name ||
        account.network.rpcUrl !== network.rpcUrl) {
      throw new Error('The active account is outside the sandbox network')
    }
    if (await tezos.rpc.getChainId() !== sandboxChain.id ||
        await tezos.rpc.getBlockHash({ block: '0' }) !== sandboxChain.genesis) {
      throw new Error('The sandbox chain changed before transfer')
    }
    const operation = await tezos.wallet.transfer({
      to: sandboxChain.recipient, amount: sandboxChain.amountMutez, mutez: true
    }).send()
    result.textContent = JSON.stringify({ operation: 'transfer', status: 'passed', hash: operation.opHash })
  } catch (error: unknown) {
    result.textContent = JSON.stringify({ operation: 'transfer', status: 'rejected', error: describeError(error) })
  }
})
result.dataset.ready = 'true'
