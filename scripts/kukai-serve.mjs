import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
const artifactRoot=process.env.KUKAI_ARTIFACT_ROOT ?? path.join(process.env.WALLET_ARTIFACT_ROOT ?? path.resolve('.artifacts'),'kukai')
const root=path.resolve(artifactRoot,'source/dist')
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.ttf':'font/ttf'}
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname)
    const candidate=path.resolve(root,'.'+pathname)
    if(candidate!==root&&!candidate.startsWith(root+path.sep)){response.writeHead(403).end();return}
    let file=candidate
    try{if(!(await stat(file)).isFile())file=path.join(root,'index.html')}
    catch{if(path.extname(file)){response.writeHead(404).end();return}file=path.join(root,'index.html')}
    response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'})
    response.end(await readFile(file))
  }catch{response.writeHead(500).end()}
})
server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Missing Kukai server address');const origin='http://127.0.0.1:'+address.port;if(process.send)process.send(origin);else console.log(origin)})
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));server.closeAllConnections()})
process.on('disconnect',()=>{server.close(()=>process.exit(0));server.closeAllConnections()})
