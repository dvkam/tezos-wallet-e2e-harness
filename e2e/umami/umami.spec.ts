import {test,expect,chromium,type Page,type Browser,type BrowserContext} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {z} from 'zod'
import {launchUmami,onboardUmami} from './driver.ts'
import {deriveAddress,verifySignature} from '../../lib/oracle.ts'
const fixture = z.object({mnemonic:z.string(),derivationPath:z.string(),address:z.string(),publicKey:z.string(),payload:z.string()}).parse(JSON.parse(await readFile('fixtures/account.json','utf8')))
const completion = z.object({operation:z.string(),sequence:z.number(),status:z.enum(['pending','passed','rejected']),value:z.unknown().optional(),error:z.object({name:z.string(),message:z.string(),code:z.string().optional()}).optional()})
const identity = {address:fixture.address,publicKey:fixture.publicKey,network:'mainnet'}
test('Umami released desktop permission, signing and disconnect',async ({},info) => {
  const steps:string[]=[]
  const pageErrors:string[]=[]
  const consoleErrors:string[]=[]
  const consumerPageErrors:string[]=[]
  const consumerConsoleErrors:string[]=[]
  const walletPageErrors:string[]=[]
  const walletConsoleErrors:string[]=[]
  const httpErrors:{source:'consumer'|'wallet';url:string;status:number}[]=[]
  const failedRequests:{source:'consumer'|'wallet';url:string;error:string|null}[]=[]
  const externalEndpoints=new Set<string>()
  const measurement:Record<string,unknown>={attempt:info.repeatEachIndex,workflow:'failed',signedRequests:[],wallet:'umami',picker:'p2p',artifact:{name:'Umami',version:'2.3.8',sha256:'98c67e59a5f716cef4ea24b5039143fd72ad038dfc21028233210f5252fa5a5f'},steps}
  let ownedWallet:Awaited<ReturnType<typeof launchUmami>>|undefined
  let ownedBrowser:Browser|undefined
  let consumerContext:BrowserContext|undefined
  let tracing=false
  let walletTracing=false
  let stage='wallet-startup'
  const password='Umami-Test-1!'+randomBytes(16).toString('hex')
  const observe=(page:Page,source:'consumer'|'wallet') => {
    page.on('pageerror',error=>{pageErrors.push(ownedWallet?.redact(error.message)??error.message);(source==='consumer'?consumerPageErrors:walletPageErrors).push(ownedWallet?.redact(error.message)??error.message)})
    page.on('console',message=>{if(message.type()==='error'){consoleErrors.push(ownedWallet?.redact(message.text())??message.text());(source==='consumer'?consumerConsoleErrors:walletConsoleErrors).push(ownedWallet?.redact(message.text())??message.text())}})
    page.on('response',response=>{if(response.status()>=400){const url=new URL(response.url());httpErrors.push({source,url:url.origin+url.pathname,status:response.status()})}})
    page.on('requestfailed',request=>{
      const url=new URL(request.url())
      failedRequests.push({source,url:url.origin+url.pathname,error:request.failure()?.errorText??null})
    })
    page.on('request',request=>{const url=new URL(request.url());if(url.protocol==='https:')externalEndpoints.add(url.origin+url.pathname)})
  }
  try {
    const wallet=await launchUmami(info.outputPath('wallet-process'));ownedWallet=wallet
    stage='consumer-startup'
    const browser=await chromium.launch({headless:false});ownedBrowser=browser
    const context=await browser.newContext();consumerContext=context
    const app=await context.newPage()
    observe(app,'consumer');observe(wallet.page,'wallet')
    stage='onboarding'
    measurement.walletRuntimeVersion=wallet.version
    measurement.consumerBrowserVersion=browser.version()
    measurement.artifact=wallet.artifact
    wallet.protect(fixture.mnemonic,password)
    await onboardUmami(wallet.page,fixture.mnemonic,password)
    steps.push('onboarded public test account')
    await context.tracing.start({screenshots:true,snapshots:true,sources:false});tracing=true
    await wallet.context.tracing.start({screenshots:true,snapshots:true,sources:false});walletTracing=true
    let traceSegment=0
    let captureSafe=true
    async function pauseSensitiveCapture(){
      if(tracing){await context.tracing.stop({path:info.outputPath('consumer-trace-'+traceSegment+'.zip')});tracing=false}
      if(walletTracing){await wallet.context.tracing.stop({path:info.outputPath('wallet-trace-'+traceSegment+'.zip')});walletTracing=false}
      captureSafe=false
    }
    async function resumeCapture(){
      traceSegment++;await context.tracing.start({screenshots:true,snapshots:true,sources:false});tracing=true
      await wallet.context.tracing.start({screenshots:true,snapshots:true,sources:false});walletTracing=true;captureSafe=true
    }
    await app.goto(new URL('/?picker=p2p&wallet=umami',process.env.WALLET_APP_ORIGIN).href)
    await expect(app.locator('#result')).toHaveAttribute('data-ready','true')
    let sequence=0
    async function completed(operation:string,status:'passed'|'rejected',code?:string){
      const expected=++sequence
      await expect.poll(async()=>{
        const parsed=completion.safeParse(JSON.parse(await app.locator('#result').innerText()))
        return parsed.success?{operation:parsed.data.operation,sequence:parsed.data.sequence,status:parsed.data.status}:null
      },{timeout:45000}).toEqual({operation,sequence:expected,status})
      const result=completion.parse(JSON.parse(await app.locator('#result').innerText()))
      if(code){expect(result.error?.code).toBe(code);expect(result.value).toBeUndefined()}
      return result
    }
    async function permission(approve:boolean){
      await expect(wallet.page.getByRole('dialog')).toBeHidden()
      stage='p2p-pairing'
      await app.locator('#permission').click()
      await expect(app.locator('#pairing-p2p')).toHaveAttribute('data-ready','true',{timeout:90000})
      const serialized=await app.locator('#pairing-p2p').innerText()
      if(!serialized)throw new Error('Public P2P pairing payload is absent')
      await wallet.pair(serialized)
      stage='permission-popup'
      const dialog=wallet.page.getByRole('dialog')
      await expect(dialog).toContainText('Permission Request',{timeout:90000})
      await expect(dialog).toContainText('Umami lifecycle test')
      if(approve){
        await dialog.getByRole('textbox',{name:'address',exact:true}).fill(fixture.address)
        await expect(dialog.getByTestId('selected-address-tile-'+fixture.address)).toBeVisible()
        await dialog.getByRole('button',{name:'Allow',exact:true}).click()
      }else await dialog.getByRole('button',{name:'Close',exact:true}).click()
      const result=await completed('permission',approve?'passed':'rejected',approve?undefined:'NOT_GRANTED_ERROR')
      await expect(dialog).toBeHidden()
      return result
    }
    await permission(false)
    await app.locator('#account').click();expect((await completed('account','passed')).value).toBeNull()
    steps.push('permission rejected; account remains absent')
    const granted=(await permission(true)).value
    expect(granted).toEqual(identity)
    measurement.account=granted
    expect(deriveAddress(fixture.publicKey)).toBe(fixture.address)
    steps.push('permission recovery; exact independent identity')
    await app.reload();await expect(app.locator('#result')).toHaveAttribute('data-ready','true');sequence=0
    await app.locator('#account').click();expect((await completed('account','passed')).value).toEqual(identity)
    steps.push('authorized account survives reload')
    const signedRequests:{id:string;signature:string;requestedPayload:string}[]=[]
    async function approveSigning() {
    stage='signing-approval'
    const dialog=wallet.page.getByRole('dialog')
    await expect(dialog).toBeHidden()
    await app.locator('#sign').click()
    await expect(dialog).toContainText('Umami lifecycle test/dApp Pairing Request',{timeout:90000})
    await writeFile(info.outputPath('signing-ui.txt'),await dialog.ariaSnapshot())
    await pauseSensitiveCapture()
    try {
      await dialog.getByTestId('password').fill(password)
      await dialog.getByRole('button',{name:'Sign',exact:true}).click()
      await expect(dialog).toBeHidden()
    } catch { throw new Error('Umami signing unlock failed; capture was disabled') }
    await resumeCapture()
    const signed=z.object({requestedPayload:z.string(),response:z.object({id:z.string(),signature:z.string(),signingType:z.unknown().optional()})}).parse((await completed('sign','passed')).value)
    expect(signed.requestedPayload).toBe(fixture.payload)
    expect(verifySignature(fixture.payload,fixture.publicKey,signed.response.signature)).toBe(true)
    expect(verifySignature(fixture.payload.slice(0,-2)+'00',fixture.publicKey,signed.response.signature)).toBe(false)
    measurement.signature=signed.response.signature
    measurement.signingTypeContract={status:signed.response.signingType==='micheline'?'passed':'failed',expected:'micheline',observed:signed.response.signingType??null}
    signedRequests.push({id:signed.response.id,signature:signed.response.signature,requestedPayload:signed.requestedPayload})
    expect(new Set(signedRequests.map(request=>request.id)).size).toBe(signedRequests.length)
    measurement.signedRequests=signedRequests
    await expect(dialog).toBeHidden()
    return signed
    }
    await approveSigning()
    steps.push('signature verified; changed-payload negative control rejected')
    stage='disconnect'
    await app.locator('#disconnect').click();expect((await completed('disconnect','passed')).value).toBeNull()
    await app.reload();await expect(app.locator('#result')).toHaveAttribute('data-ready','true');sequence=0
    await app.locator('#account').click();expect((await completed('account','passed')).value).toBeNull()
    measurement.disconnectContract={status:'passed',accountAfterReload:null}
    steps.push('disconnect clears account across reload')
    expect((await permission(true)).value).toEqual(identity)
    steps.push('permission recovery after disconnect; exact independent identity')
    stage='signing-rejection'
    const dialog=wallet.page.getByRole('dialog')
    await app.locator('#sign').click();await expect(dialog).toContainText('Umami lifecycle test/dApp Pairing Request',{timeout:90000})
    await dialog.getByRole('button',{name:'Close',exact:true}).click()
    await completed('sign','rejected','ABORTED_ERROR')
    await expect(dialog).toBeHidden()
    await app.locator('#account').click()
    const postReject=(await completed('account','passed')).value;measurement.postRejectAccount=postReject
    expect(postReject).toBeNull()
    measurement.signingRejectionContract={status:'passed',expectedAccount:null,observedAccount:postReject,code:'ABORTED_ERROR',walletPolicy:'v2.3.8 removes its Beacon peer when closing the signing dialog'}
    steps.push('signing rejected; wallet revokes connection as declared')
    stage='recovery-after-signing-rejection'
    expect((await permission(true)).value).toEqual(identity)
    await approveSigning()
    measurement.recoveryAfterSigningRejection={status:'passed',account:identity,secondSignatureVerified:true}
    steps.push('permission recovery after signing rejection; exact independent identity and signature')
    expect(consumerPageErrors,'The consumer must have no uncaught errors').toEqual([])
    expect(consumerConsoleErrors,'The consumer must have no console errors').toEqual([])
    expect(walletPageErrors.filter(error=>/No matching request found|Cannot read properties of undefined \(reading 'type'\)/.test(error)),'Wallet request correlation errors are fatal to this workflow').toEqual([])
    measurement.workflow='passed'
    if(!captureSafe)throw new Error('Capture remains disabled')
    await app.screenshot({path:info.outputPath('consumer.png')})
    await wallet.page.screenshot({path:info.outputPath('wallet.png')})
    stage='completed'
  }finally{
    const healthSide=(source:'consumer'|'wallet')=>{
      const findings=[
        ...(source==='consumer'?consumerPageErrors:walletPageErrors).map(message=>({kind:'pageerror',message})),
        ...(source==='consumer'?consumerConsoleErrors:walletConsoleErrors).map(message=>({kind:'console',message})),
        ...httpErrors.filter(error=>error.source===source).map(error=>({kind:'http',...error})),
        ...failedRequests.filter(error=>error.source===source&&!/ERR_ABORTED|cancel/i.test(error.error??'')).map(error=>({kind:'network',...error}))
      ]
      return {status:findings.length?(source==='consumer'?'failed':'degraded'):'clean',findings,canceledRequests:failedRequests.filter(error=>error.source===source&&/ERR_ABORTED|cancel/i.test(error.error??''))}
    }
    const cleanupErrors:string[]=[]
    if(info.status!==info.expectedStatus&&tracing&&walletTracing){
      try{await ownedWallet?.page.screenshot({path:info.outputPath('wallet-failure.png')})}catch{}
      try{await consumerContext?.pages()[0]?.screenshot({path:info.outputPath('consumer-failure.png')})}catch{}
    }
    const cleanup=async(action:()=>Promise<unknown>)=>{try{await action()}catch(error:unknown){cleanupErrors.push(ownedWallet?.redact(String(error))??String(error))}}
    if(tracing&&consumerContext)await cleanup(()=>consumerContext!.tracing.stop({path:info.outputPath('consumer-trace-final.zip')}))
    if(walletTracing&&ownedWallet)await cleanup(()=>ownedWallet!.context.tracing.stop({path:info.outputPath('wallet-trace-final.zip')}))
    await cleanup(async()=>ownedBrowser?.close())
    await cleanup(async()=>ownedWallet?.close())
    measurement.stage=stage;measurement.health=ownedWallet?{scope:'after-CDP-attachment-including-onboarding',dapp:healthSide('consumer'),wallet:healthSide('wallet')}:null
    const scan=spawnSync('python3',['scripts/umami-evidence-scan.py',info.outputDir],{input:JSON.stringify([fixture.mnemonic,password]),encoding:'utf8',timeout:30_000})
    measurement.secretScan={status:scan.status===0?'passed':'failed',scope:'literal-text-and-zip-entries-no-OCR'}
    if(scan.status!==0)cleanupErrors.push('Sensitive evidence scan failed')
    measurement.cleanupErrors=cleanupErrors
    if(cleanupErrors.length)measurement.workflow='failed'
    measurement.externalEndpoints=[...externalEndpoints].sort()
    const body=ownedWallet?.redact(JSON.stringify(measurement,null,2))??JSON.stringify(measurement,null,2)
    await writeFile(info.outputPath('measurement.json'),body)
    await info.attach('measurement',{path:info.outputPath('measurement.json'),contentType:'application/json'})
    if(cleanupErrors.length)throw new Error(cleanupErrors.join('; '))
  }
})
