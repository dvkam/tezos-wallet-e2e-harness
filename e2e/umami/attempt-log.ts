export type Source = 'consumer' | 'wallet'
type Detail =
  | { kind: 'pageerror' | 'console'; message: string }
  | { kind: 'http'; url: string; status: number }
  | { kind: 'network'; url: string; error: string | null }
export type Finding = Detail & { source: Source; atMs: number; stage: string; action: string | null }

const canceled = (finding: Finding) => finding.kind === 'network' && /ERR_ABORTED|cancel/i.test(finding.error ?? '')

// Records where in the workflow each finding occurred. A stage is a workflow phase.
// An action is the wallet interaction running inside it, so a shared helper cannot hide the phase.
// An action ends when its interaction returns. A failed interaction stays as the position.
export function createAttemptLog(now: () => number = () => performance.now()) {
  const started = now()
  const findings: Finding[] = []
  let stage = 'wallet-startup'
  let action: string | null = null
  return {
    enter(next: string) { stage = next; action = null },
    async during<T>(next: string, interaction: () => Promise<T>): Promise<T> {
      action = next
      const result = await interaction()
      action = null
      return result
    },
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
