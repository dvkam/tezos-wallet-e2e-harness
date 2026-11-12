import { readFile, readdir, readlink, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

export const ledgerSchema = z.object({
  binary: z.string(), profile: z.string(),
  processes: z.array(z.object({ pid: z.number().int().positive(), startTicks: z.string().regex(/^\d+$/) }))
})
export async function processIdentity(pid: number) {
  try {
    const stat = await readFile('/proc/' + pid + '/stat', 'utf8')
    const end = stat.lastIndexOf(')')
    const fields = stat.slice(end + 2).trim().split(/\s+/)
    return { state: fields[0], group: Number(fields[2]), startTicks: fields[19] }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')) return
    throw error
  }
}
export function assertOwnedProfile(profile: string, profileRoot: string) {
  const relative = path.relative(path.resolve(profileRoot), path.resolve(profile))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      !/^umami-[^/]+$/.test(relative)) throw new Error('Umami ledger profile is outside the owned root')
}
async function groupMembers(group: number) {
  const members: {pid:number;startTicks:string|undefined;args:string[];executable:string}[]=[]
  for(const name of await readdir('/proc')){
    if(!/^\d+$/.test(name))continue
    const pid=Number(name), state=await processIdentity(pid)
    if(!state||state.group!==group||state.state==='Z')continue
    try{members.push({pid,startTicks:state.startTicks,executable:await readlink('/proc/'+pid+'/exe'),args:(await readFile('/proc/'+pid+'/cmdline','utf8')).split('\0')})}
    catch(error:unknown){if(!(error instanceof Error)||!('code' in error)||!['ENOENT','ESRCH'].includes(String(error.code)))throw error}
  }
  return members
}
export async function stopOwnedUmami(ledger: z.infer<typeof ledgerSchema>) {
  for(const owned of ledger.processes){
    const leader=await processIdentity(owned.pid)
    if(leader&&leader.startTicks!==owned.startTicks)throw new Error('Umami PID ownership changed')
    const members=await groupMembers(owned.pid)
    if(!members.length)continue
    const expected='--user-data-dir='+path.join(ledger.profile,'browser')
    if(members.some(member=>member.executable!==ledger.binary)||!members.some(member=>(' '+member.args.join(' ')+' ').includes(' '+expected+' '))){
      throw new Error('Umami command group ownership mismatch')
    }
    const signal=(value:NodeJS.Signals)=>{
      try{process.kill(-owned.pid,value)}
      catch(error:unknown){if(!(error instanceof Error)||!('code' in error)||error.code!=='ESRCH')throw error}
    }
    signal('SIGTERM')
    for(let count=0;count<30&&(await groupMembers(owned.pid)).length;count++)await delay(100)
    if((await groupMembers(owned.pid)).length){
      signal('SIGKILL')
      for(let count=0;count<30&&(await groupMembers(owned.pid)).length;count++)await delay(100)
      if((await groupMembers(owned.pid)).length)throw new Error('Owned Umami process group did not stop')
    }
  }
}
export async function cleanupUmami(reportRoot: string, profileRoot: string) {
  if (path.resolve(profileRoot) !== path.resolve(reportRoot, 'profiles')) throw new Error('Unexpected Umami cleanup profile root')
  let entries
  try { entries = await readdir(path.join(reportRoot, 'artifacts'), { withFileTypes: true }) }
  catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const file = path.join(reportRoot, 'artifacts', entry.name, 'wallet-process', 'process.json')
    let body: string
    try { body = await readFile(file, 'utf8') }
    catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    const ledger = ledgerSchema.parse(JSON.parse(body))
    assertOwnedProfile(ledger.profile, profileRoot)
    await stopOwnedUmami(ledger)
    await rm(ledger.profile, { recursive: true, force: true })
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [report, profiles] = process.argv.slice(2)
  if (!report || !profiles) throw new Error('Expected owned report and profiles directories')
  await cleanupUmami(report, profiles)
}
