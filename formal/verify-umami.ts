import assert from 'node:assert/strict'
import {readFile,writeFile,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {umamiVerdict} from '../scripts/umami-verdict.ts'
import {completeAttempts,passedStats} from '../tests/umami-fixture.ts'
let cases=0
for(let mask=0;mask<256;mask++){
 const attempts=completeAttempts(), first=attempts[0]!
 if(mask&1)first.workflow='failed'
 if(mask&2)first.steps.pop()
 if(mask&4)first.account.address='wrong'
 if(mask&8)first.signedRequests[0]!.signature='invalid'
 if(mask&16)first.signedRequests[1]!.id='first'
 if(mask&32)first.secretScan.status='failed'
 if(mask&64)first.signedRequests[0]!.requestedPayload+='00'
 if(mask&128)first.signedRequests[0]!.signingType='missing'
 assert.equal(umamiVerdict(attempts,passedStats).status==='workflow-passed',mask===0,'counterexample mask '+mask)
 cases++
}
const sourceURL=new URL('../scripts/umami-verdict.ts',import.meta.url)
const source=await readFile(sourceURL,'utf8')
const mutantURL=new URL('../scripts/.umami-verdict-mutant.ts',import.meta.url)
const mutation="!verifySignature(fixture.payload, fixture.publicKey, request.signature)"
assert.ok(source.includes(mutation))
try{
 await writeFile(mutantURL,source.replace(mutation,'false'))
 const mutant=await import(mutantURL.href)
 const attempts=completeAttempts()
 attempts[0]!.signedRequests[0]!.signature='invalid'
 assert.equal(mutant.umamiVerdict(attempts,passedStats).status,'workflow-passed','mutation control must expose disabled positive signature verification')
}finally{await rm(mutantURL,{force:true})}
console.log(JSON.stringify({cases,mutationsDetected:1,sourceSha256:createHash('sha256').update(source).digest('hex'),scope:'bounded execution of actual Umami verdict, not wallet or network liveness proof'}))
