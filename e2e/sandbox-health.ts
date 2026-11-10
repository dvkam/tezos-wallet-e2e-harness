import type { BrowserContext, Request } from '@playwright/test'

type Finding = {
  kind: 'console-error' | 'page-error' | 'http-error' | 'request-failed'
  detail: string
  endpoint?: string
}

export function requestOrigin(request: Request): string | undefined {
  const worker = request.serviceWorker()
  if (worker) return originOf(worker.url())
  try {
    const origin = originOf(request.frame().url())
    if (origin) return origin
  } catch {
    // A navigation can start before Chromium creates its frame.
  }
  return request.isNavigationRequest() ? originOf(request.url()) : undefined
}

function originOf(value: string | undefined): string | undefined {
  if (!value) return
  const url = URL.parse(value)
  if (!url || url.origin === 'null' && url.protocol !== 'chrome-extension:') return
  return url.protocol === 'chrome-extension:' ? 'chrome-extension://' + url.host : url.origin
}

export function observeSandboxHealth(context: BrowserContext, appOrigin: string, extensionOrigin: string) {
  const dapp: Finding[] = []
  const wallet: Finding[] = []

  function record(origin: string | undefined, finding: Finding) {
    if (origin === appOrigin) dapp.push(finding)
    if (origin === extensionOrigin) wallet.push(finding)
  }

  function endpoint(request: Request) {
    const url = new URL(request.url())
    return url.origin + url.pathname
  }

  context.on('console', message => {
    if (message.type() !== 'error') return
    record(originOf(message.worker()?.url() ?? message.page()?.url()) ?? originOf(message.location().url), {
      kind: 'console-error', detail: message.text()
    })
  })
  context.on('weberror', error => {
    record(originOf(error.page()?.url()), { kind: 'page-error', detail: error.error().message })
  })
  context.on('response', response => {
    if (response.status() < 400) return
    const request = response.request()
    record(requestOrigin(request), {
      kind: 'http-error', detail: String(response.status()), endpoint: endpoint(request)
    })
  })
  context.on('requestfailed', request => {
    const detail = request.failure()?.errorText
    if (!detail || detail === 'net::ERR_ABORTED') return
    record(requestOrigin(request), { kind: 'request-failed', detail, endpoint: endpoint(request) })
  })

  return () => ({
    dapp: { status: dapp.length ? 'failed' : 'clean', findings: [...dapp] },
    wallet: { status: wallet.length ? 'degraded' : 'clean', findings: [...wallet] }
  })
}
