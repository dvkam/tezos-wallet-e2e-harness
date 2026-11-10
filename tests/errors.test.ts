import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeError } from '../src/errors.ts'

test('preserves non-native Beacon error code instead of object coercion', () => {
  assert.deepEqual(describeError({name:'NotGrantedBeaconError', message:'[NOT_GRANTED_ERROR]: Not granted'}), {
    name:'NotGrantedBeaconError', message:'[NOT_GRANTED_ERROR]: Not granted', code:'NOT_GRANTED_ERROR'
  })
  assert.deepEqual(describeError(new Error('broken')), {name:'Error',message:'broken'})
  assert.deepEqual(describeError(null), {name:'object',message:'null'})
})

test('preserves a raw protocol error rejected by the released DAppClient', () => {
  assert.deepEqual(describeError({type:'error',errorType:'NOT_GRANTED_ERROR',id:'public-id'}), {
    name:'BeaconProtocolError',message:'NOT_GRANTED_ERROR',code:'NOT_GRANTED_ERROR'
  })
})
