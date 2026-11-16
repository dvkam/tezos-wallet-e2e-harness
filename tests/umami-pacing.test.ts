import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequestPacer, pacingMarginMs, sdkRateLimitWindowMs } from '../e2e/umami/pacing.ts'

test('the first two requests start without waiting', () => {
  let clock = 0
  const pacer = createRequestPacer(() => clock)
  assert.equal(pacer.waitMs(), 0)
  clock = 800
  pacer.completed()
  assert.equal(pacer.waitMs(), 0)
  clock = 1500
  pacer.completed()
  assert.equal(pacer.waitMs(), 800 + sdkRateLimitWindowMs + pacingMarginMs - 1500)
})

test('a request never starts inside the SDK window of the request two before it', () => {
  let clock = 0
  const pacer = createRequestPacer(() => clock)
  const starts: number[] = []
  const completions: number[] = []
  for (const duration of [300, 200, 4000, 100, 100, 9000, 50, 50]) {
    clock += pacer.waitMs()
    starts.push(clock)
    clock += duration
    pacer.completed()
    completions.push(clock)
  }
  for (let index = 2; index < starts.length; index++) {
    assert.ok(starts[index]! - completions[index - 2]! > sdkRateLimitWindowMs, 'request ' + index + ' started too early')
  }
})

test('no wait remains once the window has passed', () => {
  let clock = 0
  const pacer = createRequestPacer(() => clock)
  pacer.completed()
  pacer.completed()
  clock = sdkRateLimitWindowMs + pacingMarginMs + 1
  assert.equal(pacer.waitMs(), 0)
})
