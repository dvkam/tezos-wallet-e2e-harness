import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import {launchUmami} from '../e2e/umami/driver.ts'
import {cleanupUmami,ledgerSchema,processIdentity,assertOwnedProfile} from './umami-cleanup.ts'
if(process.argv[2]==='--worker'){
 const report=process.argv[3]
 if(!report)throw new Error('Missing report')
 await launchUmami(path.join(report,'artifacts/umami-control/wallet-process'))
 process.stdout.write('READY\n')
 setInterval(()=>{},1000)
}else{
 const report=await mkdtemp(path.join(os.tmpdir(),'umami-cleanup-'))
 const profiles=path.join(report,'profiles')
 await mkdir(profiles)
 assert.throws(()=>assertOwnedProfile(path.join(report,'outside'),profiles))
 assert.throws(()=>assertOwnedProfile(profiles,profiles))
 process.env.WALLET_PROFILE_ROOT=profiles
 let child:ChildProcess|undefined
 try{
  child=spawn(process.execPath,[import.meta.filename,'--worker',report],{env:process.env,stdio:['ignore','pipe','inherit']})
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Actual Umami control startup timed out')),40_000)
   child!.once('error',reject)
   child!.once('exit',code=>{clearTimeout(timer);reject(new Error('Control worker exited '+code))})
   child!.stdout?.on('data',chunk=>{if(String(chunk).includes('READY')){clearTimeout(timer);resolve()}})
  })
  const ledger=ledgerSchema.parse(JSON.parse(await readFile(path.join(report,'artifacts/umami-control/wallet-process/process.json'),'utf8')))
  assert.ok(await processIdentity(ledger.processes[0]!.pid))
  const closed=new Promise(resolve=>child!.once('close',resolve))
  child.kill('SIGKILL');await closed
  await cleanupUmami(report,profiles)
  for(const owned of ledger.processes){const state=await processIdentity(owned.pid);assert.ok(!state||state.state==='Z')}
  await cleanupUmami(report,profiles)
  const badOutput=path.join(report,'artifacts/umami-failure/wallet-process')
  await mkdir(path.join(badOutput,'process.json.tmp'),{recursive:true})
  await assert.rejects(launchUmami(badOutput))
  console.log('Actual Umami SIGKILL fallback, idempotence, profile containment and ledger-write setup failure controls passed')
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
  await cleanupUmami(report,profiles)
  await rm(report,{recursive:true,force:true})
 }
}
