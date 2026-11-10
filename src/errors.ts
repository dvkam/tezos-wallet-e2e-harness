export function describeError(error: unknown): { name: string; message: string; code?: string } {
  if (error !== null && typeof error === 'object') {
    const name: unknown = Reflect.get(error, 'name')
    const message: unknown = Reflect.get(error, 'message')
    const errorType: unknown = Reflect.get(error, 'errorType')
    if (typeof errorType === 'string') return {name:'BeaconProtocolError', message:errorType, code:errorType}
    if (typeof name === 'string' && typeof message === 'string') {
      const code = /^\[([A-Z_]+)\]:/.exec(message)?.[1]
      return {name, message, ...(code ? {code} : {})}
    }
  }
  return { name: typeof error, message: String(error) }
}
