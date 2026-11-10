import { parseConsumerConfig } from './config'
import { describeError } from './errors'
import { TezosToolkit } from '@taquito/taquito'
import { createTempleWallet } from './temple-wallet'
import { NetworkType, SigningType } from '@ecadlabs/beacon-types'

const config = parseConsumerConfig(new URLSearchParams(location.search))
const appName = 'Temple stable baseline'
const result = document.querySelector('#result')
if (!(result instanceof HTMLElement)) {
  throw new Error('Consumer controls are missing')
}

const wallet = createTempleWallet(appName, { type: NetworkType.MAINNET }, config)
const tezos = new TezosToolkit('https://prod.tcinfra.net/rpc/mainnet')
tezos.setWalletProvider(wallet)
const challenge = '05010000003754657a6f73205369676e6564204d6573736167653a2054656d706c6520737461626c6520626173656c696e652074657374206f6e6c792e'

let sequence = 0
type Operation = 'permission' | 'sign' | 'disconnect' | 'account'
type Completion = { operation: Operation; sequence: number } & (
  | { status: 'passed'; value: unknown }
  | { status: 'rejected'; error: ReturnType<typeof describeError> }
)
const history: Completion[] = []
const show = (state: object): void => {
  result.textContent = JSON.stringify({ ...state, history })
}
async function activeAccount() {
  const account = await wallet.client.getActiveAccount()
  return account ? {
    address: account.address,
    publicKey: account.publicKey,
    network: account.network.type
  } : null
}
async function run(operation: Operation, action: () => Promise<unknown>): Promise<void> {
  const requestSequence = ++sequence
  show({ operation, sequence: requestSequence, status: 'pending' })
  let completion: Completion
  try {
    completion = { operation, sequence: requestSequence, status: 'passed', value: await action() }
  } catch (error: unknown) {
    completion = {
      operation, sequence: requestSequence, status: 'rejected',
      error: describeError(error)
    }
  }
  history.push(completion)
  show(completion)
}
const actions: Record<string, [Operation, () => Promise<unknown>]> = {
  permission: ['permission', async () => {
    await wallet.requestPermissions()
    const account = await activeAccount()
    if (!account) throw new Error('Permission completed without an active account')
    return { ...account, address: await tezos.wallet.pkh(), publicKey: await wallet.getPK() }
  }],
  sign: ['sign', async () => ({
    requestedPayload: challenge,
    response: await wallet.client.requestSignPayload({ payload: challenge, signingType: SigningType.MICHELINE })
  })],
  disconnect: ['disconnect', async () => {
    await wallet.disconnect()
    return activeAccount()
  }],
  account: ['account', activeAccount]
}
for (const [id, [operation, action]] of Object.entries(actions)) {
  const button = document.getElementById(id)
  if (!button) throw new Error('Missing action ' + id)
  button.addEventListener('click', () => { void run(operation, action) })
}
result.dataset.ready = 'true'
