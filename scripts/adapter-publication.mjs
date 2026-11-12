import { writeFileSync } from 'node:fs'

// Synchronous: a signal handler cannot run between the guard and the write.
export function publishAdapterResult(report, interrupted, destination) {
  if (interrupted) report.status = 'interrupted'
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  return report.status === 'workflow-passed' ? 0 : 1
}
