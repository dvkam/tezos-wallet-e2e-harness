// @ecadlabs/beacon-core Client.addRequestAndCheckIfRateLimited rejects a dApp request with
// "rate limit reached" when more than rateLimit (2) requests fall inside rateLimitWindowInSeconds (5).
export const sdkRateLimit = 2
export const sdkRateLimitWindowMs = 5000
// The SDK counts a request no later than it completes, so measuring from the completion is already
// conservative. The margin covers timer resolution and the page and runner clocks.
export const pacingMarginMs = 1000

// Starts each request only after the request sdkRateLimit places earlier has left the SDK window.
export function createRequestPacer(now: () => number = () => performance.now()) {
  const completions: number[] = []
  return {
    waitMs() {
      const previous = completions.at(-sdkRateLimit)
      return previous === undefined ? 0 : Math.max(0, previous + sdkRateLimitWindowMs + pacingMarginMs - now())
    },
    completed() { completions.push(now()) }
  }
}
