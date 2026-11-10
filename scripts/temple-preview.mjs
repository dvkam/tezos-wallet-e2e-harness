import { preview } from 'vite'

const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Preview did not open a loopback port')
if (process.connected) {
  process.on('disconnect', () => { void server.close() })
  process.send('http://127.0.0.1:' + address.port)
} else {
  await server.close()
}
