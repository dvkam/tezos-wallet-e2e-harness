import { Buffer } from 'buffer'

// Published Beacon packages use Buffer in browser code.
globalThis.Buffer = Buffer
await import('./app')
