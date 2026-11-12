import { createHash } from 'node:crypto'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const artifactRoot=path.resolve(process.env.KUKAI_ARTIFACT_ROOT ?? path.join(process.env.WALLET_ARTIFACT_ROOT ?? path.join(root,'.artifacts'),'kukai'))
const source=path.join(artifactRoot,'source')
const manifestPath=path.join(artifactRoot,'artifact.json')
const commit='1b79adc438dd4b54f1526c489fcd154e1302f802'
const sha=content=>createHash('sha256').update(content).digest('hex')
function git(args){
  const result=spawnSync('git',['-C',source,...args],{encoding:'utf8'})
  if(result.status!==0)throw new Error(result.stderr||'Kukai Git command failed')
  return result.stdout
}
function checkSource(){
  if(git(['rev-parse','HEAD']).trim()!==commit||git(['status','--porcelain','--untracked-files=normal']).trim())throw new Error('Kukai source differs from the pinned clean production commit')
}
async function inventory(folder){
  const result=[]
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(folder,entry.name)
    if(entry.isSymbolicLink())throw new Error('Artifact contains symlink: '+file)
    if(entry.isDirectory())result.push(...await inventory(file))
    else if(entry.isFile())result.push({path:path.relative(source,file),sha256:sha(await readFile(file)),bytes:(await lstat(file)).size})
  }
  return result
}
async function trackedInventory(){
  const result=[]
  for(const name of git(['ls-files','-z']).split('\0').filter(Boolean).sort()){
    const file=path.join(source,name)
    if((await lstat(file)).isSymbolicLink())throw new Error('Source symlink is not supported: '+name)
    result.push({path:name,sha256:sha(await readFile(file))})
  }
  return result
}
export async function verifyKukaiArtifact(){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
  checkSource()
  if(manifest.sourceCommit!==commit||manifest.provenance!=='clean-install-and-upstream-build'||manifest.buildNode!=='v22.23.4')throw new Error('Kukai artifact lacks a completed clean preparation; run --prepare')
  if(JSON.stringify(await trackedInventory())!==JSON.stringify(manifest.sourceFiles))throw new Error('Kukai build inputs changed since preparation')
  if(JSON.stringify(await inventory(path.join(source,'dist')))!==JSON.stringify(manifest.files))throw new Error('Kukai built artifact differs from the prepared baseline')
  return manifest
}
async function prepare(){
  await mkdir(artifactRoot,{recursive:true})
  if(!existsSync(source)){
    const clone=spawnSync('git',['clone','--filter=blob:none','https://github.com/kukai-wallet/kukai.git',source],{stdio:'inherit'})
    if(clone.status!==0)throw new Error('Kukai source acquisition failed')
    git(['checkout','--detach',commit])
  }
  checkSource()
  for(const folder of [root,'/mnt/c']){
    try{const stats=await statfs(folder);if(stats.bavail*stats.bsize<3*1024**3)throw new Error('Less than 3 GiB free: '+folder)}
    catch(error){if(error.code!=='ENOENT')throw error}
  }
  const before=await trackedInventory()
  const node=process.env.KUKAI_BUILD_NODE??path.join(homedir(),'.nvm/versions/node/v22.23.4/bin/node')
  const version=spawnSync(node,['--version'],{encoding:'utf8'})
  if(version.status!==0||version.stdout.trim()!=='v22.23.4')throw new Error('Kukai preparation requires Node22.23.4; set KUKAI_BUILD_NODE to its executable')
  const npm=path.resolve(path.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js')
  const log=path.join(artifactRoot,'prepare-'+new Date().toISOString().replaceAll(':','-')+'.log')
  let activePid
  let interrupted=false
  let interruptTimer
  function kill(signal){if(activePid){try{process.kill(-activePid,signal)}catch(error){if(error.code!=='ESRCH')throw error}}}
  const stop=()=>{interrupted=true;process.exitCode=130;kill('SIGTERM');interruptTimer??=setTimeout(()=>kill('SIGKILL'),5000)}
  process.on('SIGINT',stop);process.on('SIGTERM',stop)
  async function command(label,args){
    if(interrupted)throw new Error('Kukai preparation interrupted')
    appendFileSync(log,'\n'+label+'\n')
    const child=spawn(node,args,{cwd:source,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:path.dirname(node)+path.delimiter+process.env.PATH,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'url.https://github.com/.insteadOf',GIT_CONFIG_VALUE_0:'ssh://git@github.com/',GIT_CONFIG_KEY_1:'url.https://github.com/.insteadOf',GIT_CONFIG_VALUE_1:'git://github.com/'}})
    activePid=child.pid
    const timer=setTimeout(()=>kill('SIGTERM'),300_000)
    const hard=setTimeout(()=>kill('SIGKILL'),305_000)
    child.stdout.on('data',data=>appendFileSync(log,data));child.stderr.on('data',data=>appendFileSync(log,data))
    let spawnError
    const result=await new Promise(resolve=>{child.on('error',error=>{spawnError=error});child.on('close',(code,signal)=>resolve({code,signal}))})
    clearTimeout(timer);clearTimeout(hard)
    if(interrupted||result.code!==0||spawnError){kill('SIGKILL');activePid=undefined;throw new Error(label+' failed; inspect '+log,{cause:spawnError})}
    activePid=undefined
    console.log(label+': passed')
  }
  try{
    await command('npm-ci',[npm,'ci','--ignore-scripts','--no-audit','--no-fund'])
    await command('upstream-build-hook',['patch.js'])
    await command('production-build',[npm,'run','build-prod'])
    checkSource()
    const after=await trackedInventory()
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Kukai build inputs changed during preparation')
    const manifest={kind:'production-source-build',source:'https://github.com/kukai-wallet/kukai',sourceCommit:commit,version:'2.1.0',provenance:'clean-install-and-upstream-build',buildNode:version.stdout.trim(),buildCommands:['npm ci --ignore-scripts --no-audit --no-fund','node patch.js','npm run build-prod'],preparedAt:new Date().toISOString(),log:path.relative(root,log),sourceFiles:after,files:await inventory(path.join(source,'dist'))}
    if(interrupted)throw new Error('Kukai preparation interrupted before artifact publication')
    writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2)+'\n')
    renameSync(manifestPath+'.tmp',manifestPath)
    console.log(JSON.stringify({sourceCommit:commit,files:manifest.files.length,provenance:manifest.provenance}))
  }finally{clearTimeout(interruptTimer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(interrupted)process.exitCode=130}
}
if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.includes('--record'))throw new Error('--record is intentionally disabled; --prepare must complete a clean installation and upstream build')
    if(process.argv.includes('--prepare'))await prepare()
    else{const manifest=await verifyKukaiArtifact()
      const lock=JSON.parse(await readFile(path.join(source,'package-lock.json'),'utf8'))
      const embeddedPackages=Object.fromEntries(Object.entries(lock.packages).filter(([name])=>/^node_modules\/(@airgap\/beacon[^/]*|@taquito\/[^/]+)$/.test(name)).map(([name,value])=>[name,value.version]))
      console.log(JSON.stringify({sourceCommit:manifest.sourceCommit,sourceLockSha256:sha(await readFile(path.join(source,'package-lock.json'))),buildNode:manifest.buildNode,files:manifest.files.length,verified:true,manifestSha256:sha(await readFile(manifestPath)),provenance:manifest.provenance,embeddedPackages}))}
  }catch(error){console.error(error.message);process.exitCode=process.exitCode||1}
}
