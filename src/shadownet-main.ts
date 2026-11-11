import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
await import('./shadownet-app')
