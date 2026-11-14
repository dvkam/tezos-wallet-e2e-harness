export type Source = 'consumer' | 'wallet'
type Detail =
  | { kind: 'pageerror' | 'console'; message: string }
  | { kind: 'http'; url: string; status: number }
  | { kind: 'network'; url: string; error: string | null }
export type Finding = Detail & { source: Source; atMs: number; stage: string; action: string | null }

const canceled = (finding: Finding) => finding.kind === 'network' && /ERR_ABORTED|cancel/i.test(finding.error ?? '')

// Records where in the workflow each finding occurred. A stage is a workflow phase.
// An action is the wallet interaction inside it, so a shared helper cannot hide the phase.
export function createAttemptLog(now: () => number = () => performance.now()) {
  const started = now()
  const findings: Finding[] = []
  let stage = 'wallet-startup'
  let action: string | null = null
  return {
    enter(next: string) { stage = next; action = null },
    act(next: string) { action = next },
    position: () => ({ stage, action }),
    record(source: Source, detail: Detail) {
      findings.push({ ...detail, source, atMs: Math.round(now() - started), stage, action })
    },
    health(source: Source) {
      const own = findings.filter(finding => finding.source === source)
      const errors = own.filter(finding => !canceled(finding))
      return {
        status: errors.length ? (source === 'consumer' ? 'failed' : 'degraded') : 'clean',
        findings: errors,
        canceledRequests: own.filter(canceled)
      } as const
    }
  }
}
