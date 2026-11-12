import {umamiSteps} from '../scripts/umami-verdict.ts'
export const signature='edsigu4QgRjMBRfXuoMVfXDpM8uoQcBaNnjRzeAwpbNCAsKjBKkMrFu6WLud8dATuCmffABZJdT8VvnNbUFWtR2bVuty9mSPN7k'
export const identity={address:'tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL',publicKey:'edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf',network:'mainnet'}
export const payload='05010000003754657a6f73205369676e6564204d6573736167653a2054656d706c6520737461626c6520626173656c696e652074657374206f6e6c792e'
export function completeAttempts(){
 return [0,1,2].map(attempt=>({
  attempt,wallet:'umami',picker:'p2p',workflow:'passed',stage:'completed',steps:[...umamiSteps],
  artifact:{name:'Umami',version:'2.3.8',sourceCommit:'771e1d34ac714899a0056079f5d0e764bce427ef',archiveSha256:'98c67e59a5f716cef4ea24b5039143fd72ad038dfc21028233210f5252fa5a5f',extractedFileCount:187,extractedTreeSha256:'1'.repeat(64),executableSha256:'2'.repeat(64),extractedFilesMatchArchive:true},
  walletRuntimeVersion:'122.0.6261.156',consumerBrowserVersion:'148.0.7778.0',account:{...identity},
  signedRequests:[{id:'first',signature,requestedPayload:payload,signingType:'micheline'},{id:'second',signature,requestedPayload:payload,signingType:'micheline'}],
  signingTypeContract:{expected:'micheline',observed:'micheline'},
  disconnectContract:{status:'passed',accountAfterReload:null},
  signingRejectionContract:{status:'passed',observedAccount:null,code:'ABORTED_ERROR'},
  recoveryAfterSigningRejection:{status:'passed',account:{...identity},secondSignatureVerified:true},
  secretScan:{status:'passed'},
  health:{scope:'after-CDP-attachment-including-onboarding',dapp:{status:'clean',findings:[],canceledRequests:[]},wallet:{status:'clean',findings:[],canceledRequests:[]}}
 }))
}
export const passedStats={expected:3,unexpected:0,skipped:0,flaky:0}
