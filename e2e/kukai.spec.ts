import { test, expect, chromium, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { observeSandboxHealth } from './sandbox-health'
import { deriveAddress, verifySignature } from '../lib/oracle.ts'

const fixture=z.object({mnemonic:z.string(),address:z.string(),publicKey:z.string(),payload:z.string()}).parse(JSON.parse(await readFile('fixtures/account.json','utf8')))
const account={address:fixture.address,publicKey:fixture.publicKey,network:'mainnet'}
const outcome=z.object({operation:z.string(),sequence:z.number(),status:z.enum(['pending','passed','rejected']),value:z.unknown().optional(),error:z.object({code:z.string().optional()}).optional()})

async function onboard(page:Page,password:string, walletOrigin:string){
  await page.goto(walletOrigin+'/import')
  const accept=page.getByRole('button',{name:'Accept',exact:true})
  await expect(accept).toBeVisible()
  await accept.click()
  await page.getByText('Seed Words',{exact:true}).click()
  await page.getByPlaceholder('Seed Words (required)').fill(fixture.mnemonic)
  await page.locator('app-ui-toggle-advanced .slider').click()
  await page.getByPlaceholder('tz1... (optional)').fill(fixture.address)
  await page.getByRole('button',{name:'Import',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Set a password',exact:true})).toBeVisible({timeout:25_000})
  await page.getByPlaceholder('Password',{exact:true}).fill(password)
  await page.getByPlaceholder('Confirm Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Next',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Wallet created!',exact:true})).toBeVisible()
  await expect(page.locator('.pkh')).toContainText(fixture.address)
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'Download',exact:true}).click()
  const keystore=await download
  await keystore.delete()
  await page.getByRole('button',{name:'Open Wallet',exact:true}).click()
  await expect(page.locator('app-mnemonic-import-wallet')).toBeHidden()
}

test('Kukai real P2P permission, signing and disconnect',async({},info)=>{
  const appOrigin=process.env.WALLET_APP_ORIGIN
  const walletOrigin=process.env.KUKAI_WALLET_ORIGIN
  const profileRoot=process.env.WALLET_PROFILE_ROOT
  if(!appOrigin||!walletOrigin||!profileRoot)throw new Error('Run with npm run kukai:lifecycle')

  const verification=JSON.parse(execFileSync(process.execPath,['scripts/kukai-artifact.mjs'],{encoding:'utf8'}))
  const artifact=z.object({sourceCommit:z.string(),files:z.number(),verified:z.literal(true),manifestSha256:z.string(),provenance:z.literal('clean-install-and-upstream-build')}).parse(verification)
  await writeFile(info.outputPath('artifact.json'),await readFile(path.join(process.env.KUKAI_ARTIFACT_ROOT??path.join(process.env.WALLET_ARTIFACT_ROOT??'.artifacts','kukai'),'artifact.json')))
  const profile=await mkdtemp(path.join(profileRoot,'kukai-'))
  const context=await chromium.launchPersistentContext(profile,{headless:false,channel:'chromium'}).catch(async(error:unknown)=>{
    await rm(profile,{recursive:true,force:true})
    throw error
  })
  context.setDefaultTimeout(25_000)
  const password='Kukai-Test-1!'+randomBytes(12).toString('hex')
  const steps:string[]=[]
  let health: ReturnType<typeof observeSandboxHealth>|undefined
  type Measurement = {
    wallet:'kukai';picker:'p2p';attempt:number;workflow:'failed'|'passed';artifact:typeof artifact;
    browserVersion:string|undefined;steps:string[];account?:unknown;
    signed?:{requestedPayload:string;response:{signature:string;signingType?:unknown}};
    health?:ReturnType<ReturnType<typeof observeSandboxHealth>>;
    phase?:string;secretScan?:{status:'passed'|'failed'}
  }
  const measurement:Measurement={wallet:'kukai',picker:'p2p',attempt:info.repeatEachIndex,workflow:'failed',artifact,browserVersion:context.browser()?.version(),steps}
  let tracing=false
  let phase='onboarding'
  try{
    const wallet=await context.newPage()
    health=observeSandboxHealth(context,appOrigin,walletOrigin,'wallet-startup-and-post-onboarding')
    await test.step('Import the exact public HD account through Kukai UI',async()=>{
      try{await onboard(wallet,password,walletOrigin)}
      catch(error){throw new Error('Kukai onboarding failed: '+String(error).replaceAll(password,'[redacted]').replaceAll(fixture.mnemonic,'[public fixture omitted]'))}
    })
    steps.push('onboarded public test account')
    await context.tracing.start({screenshots:true,snapshots:true,sources:false})
    tracing=true
    const app=await context.newPage()
    await app.goto(appOrigin+'/?picker=p2p&wallet=kukai')
    await expect(app.locator('#result')).toHaveAttribute('data-ready','true')
    let sequence=0
    async function completed(operation:string,status:'passed'|'rejected'){
      const expected=++sequence
      await expect.poll(async()=>{
        const result=outcome.parse(JSON.parse(await app.locator('#result').innerText()))
        return {operation:result.operation,sequence:result.sequence,status:result.status}
      },{timeout:35_000}).toEqual({operation,sequence:expected,status})
      const result=outcome.parse(JSON.parse(await app.locator('#result').innerText()))
      if(status==='rejected'){expect(result.error?.code).toBe('ABORTED_ERROR');expect(result.value).toBeUndefined()}
      return result
    }
    async function permission(approve:boolean){
      const previous=await app.locator('#pairing-p2p').innerText()
      await app.locator('#permission').click()
      phase='P2P pairing'
      await expect(app.locator('#pairing-p2p')).toHaveAttribute('data-ready','true',{timeout:45_000})
      await expect.poll(()=>app.locator('#pairing-p2p').innerText(),{timeout:45_000}).not.toBe(previous)
      const pairing=await app.locator('#pairing-p2p').innerText()
      expect(pairing.length).toBeGreaterThan(50)
      await wallet.goto(walletOrigin+'/?type=tzip10&data='+encodeURIComponent(pairing))
      const modal=wallet.locator('app-permission-request .kukai-modal')
      phase='permission confirmation'
      await expect(modal).toBeVisible({timeout:60_000})
      await expect(modal).toContainText('Kukai lifecycle test')
      await expect(modal).toContainText(fixture.address.slice(0,5))
      if(approve)await modal.getByRole('button',{name:'Connect',exact:true}).click()
      else await modal.locator('.close').click()
      await expect(modal).toBeHidden()
      return completed('permission',approve?'passed':'rejected')
    }
    await test.step('Reject permission and preserve absent account',async()=>{
      await permission(false)
      await app.locator('#account').click()
      expect((await completed('account','passed')).value).toBeNull()
    })
    steps.push('permission rejected; account remains absent')
    await test.step('Approve permission and verify exact account',async()=>{
      const permitted=(await permission(true)).value
      expect(permitted).toEqual(account)
      measurement.account=permitted
      expect(deriveAddress(fixture.publicKey)).toBe(fixture.address)
    })
    steps.push('permission recovery; exact independent identity')
    phase='authorized reload'
    await app.reload();await expect(app.locator('#result')).toHaveAttribute('data-ready','true');sequence=0
    await app.locator('#account').click()
    expect((await completed('account','passed')).value).toEqual(account)
    steps.push('authorized account survives reload')
    async function sign(approve:boolean){
      phase='signing confirmation'
      await app.locator('#sign').click()
      const modal=wallet.locator('app-sign-expr .kukai-modal')
      await expect(modal).toBeVisible({timeout:60_000})
      await expect(modal.locator('textarea')).toHaveValue(Buffer.from(fixture.payload.slice(12),'hex').toString('utf8'))
      if(approve){
        // Trace snapshots must never contain password values or Playwright fill arguments.
        await context.tracing.stop({path:info.outputPath('trace-before-unlock.zip')})
        tracing=false
        try{
          await modal.getByPlaceholder('Password',{exact:true}).fill(password)
          await modal.getByRole('button',{name:'Sign',exact:true}).click()
          await expect(modal).toBeHidden()
        }catch{throw new Error('Kukai signing unlock failed; secret-entry diagnostics intentionally omitted')}
        await context.tracing.start({screenshots:true,snapshots:true,sources:false})
        tracing=true
      }else await modal.locator('.close').click()
      await expect(modal).toBeHidden()
      return completed('sign',approve?'passed':'rejected')
    }
    const signed=z.object({requestedPayload:z.string(),response:z.object({signature:z.string(),signingType:z.unknown().optional()})}).parse((await sign(true)).value)
    expect(signed.requestedPayload).toBe(fixture.payload)
    expect(verifySignature(fixture.payload,fixture.publicKey,signed.response.signature)).toBe(true)
    expect(verifySignature(fixture.payload.slice(0,-2)+'00',fixture.publicKey,signed.response.signature)).toBe(false)
    measurement.signed=signed
    steps.push('signature verified; changed-payload negative control rejected')
    await sign(false)
    await app.locator('#account').click();expect((await completed('account','passed')).value).toEqual(account)
    steps.push('signing rejected; account preserved')
    phase='disconnect'
    await app.locator('#disconnect').click();expect((await completed('disconnect','passed')).value).toBeNull()
    await app.reload();await expect(app.locator('#result')).toHaveAttribute('data-ready','true');sequence=0
    await app.locator('#account').click();expect((await completed('account','passed')).value).toBeNull()
    steps.push('disconnect clears account across reload')
    await app.screenshot({path:info.outputPath('consumer.png')})
    execFileSync(process.execPath,['scripts/kukai-artifact.mjs'],{encoding:'utf8'})
    measurement.workflow='passed'
  }catch(error){
    if(tracing){
      for(const page of context.pages()){
        if(new URL(page.url()).origin===appOrigin)await page.screenshot({path:info.outputPath('failure-dapp.png')}).catch(()=>{})
      }
    }
    throw error
  }finally{
    try{if(tracing)await context.tracing.stop({path:info.outputPath('trace.zip')})}
    finally{
      try{await context.close()}
      finally{await rm(profile,{recursive:true,force:true})}
    }
    measurement.health=health?.()
    measurement.phase=phase
    const scan=spawnSync('python3',['scripts/scan-wallet-evidence.py',info.outputDir],{
      input:JSON.stringify([password,fixture.mnemonic]),encoding:'utf8'
    })
    measurement.secretScan={status:scan.status===0?'passed':'failed'}
    await writeFile(info.outputPath('measurement.json'),JSON.stringify(measurement,null,2))
    await info.attach('measurement',{path:info.outputPath('measurement.json'),contentType:'application/json'})
    if(scan.status!==0)throw new Error('Secret scan failed; evidence must remain private')
  }
})
