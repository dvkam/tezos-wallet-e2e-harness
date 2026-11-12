import { readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

// Only the unique owned profile and exact browser executable authorize cleanup.
// Never kill all Chrome processes or a process group shared with the invoking shell.
export async function cleanupOwnedBrowsers(profileRoot, executable) {
  const root = await realpath(profileRoot)
  const expected = await realpath(executable)
  async function owned(pid) {
    try {
      const args = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0')
      const profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice(16)
      if (!profile || !path.isAbsolute(profile)) return false
      const actual = await realpath('/proc/' + pid + '/exe')
      if (actual !== expected) return false
      const relative = path.relative(root, await realpath(profile))
      return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
    } catch (error) {
      if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return false
      throw error
    }
  }
  const killed = []
  for (const pid of (await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(Number)) {
    if (!await owned(pid)) continue
    const stat = await readFile('/proc/' + pid + '/stat', 'utf8')
    const group = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2])
    const target = group === pid ? -pid : pid
    async function alive() {
      if (target > 0) return owned(pid)
      // Group ownership survives its leader. Chromium children omit the profile flag.
      for (const member of (await readdir('/proc')).filter(name => /^\d+$/.test(name))) {
        try {
          const value = await readFile('/proc/' + member + '/stat', 'utf8')
          const fields = value.slice(value.lastIndexOf(')') + 2).split(' ')
          if (Number(fields[2]) === group && fields[0] !== 'Z') return true
        } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error }
      }
      return false
    }
    process.kill(target, 'SIGTERM')
    for (let attempt = 0; attempt < 20 && await alive(); attempt++) await pause(50)
    if (await alive()) {
      try { process.kill(target, 'SIGKILL') }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    for (let attempt = 0; attempt < 20 && await alive(); attempt++) await pause(50)
    if (await alive()) throw new Error('Owned browser group survived cleanup')
    killed.push(pid)
  }
  return killed
}
