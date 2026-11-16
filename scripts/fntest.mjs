import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('functions/api/[[default]].js').href)
const handler = mod.onRequest

async function call(path) {
  const res = await handler({ request: new Request('http://test.local' + path) })
  return res
}

console.log('--- maccms ---')
let r = await call('/api/maccms?__base=https%3A%2F%2Fcj.lziapi.com%2F&ac=list&pg=1&pagesize=2')
console.log(r.status, r.headers.get('content-type'), (await r.text()).slice(0, 120))

console.log('--- ping ---')
r = await call('/api/ping?__base=cj.lziapi.com')
console.log(r.status, await r.text())

console.log('--- hls 改写 ---')
r = await call('/api/hls?u=https%3A%2F%2Fv.lfthirtytwo.com%2F20261107%2F11543_4ab406c7%2Findex.m3u8')
const text = await r.text()
console.log(r.status, r.headers.get('content-type'))
console.log(text.split('\n').filter(l => l.includes('/api/')).slice(0, 3).join('\n') || text.slice(0, 200))

console.log('--- seg 前 100KB ---')
r = await call('/api/seg?u=https%3A%2F%2Fv.lfthirtytwo.com%2F20261107%2F11543_4ab406c7%2F2000k%2Fhls%2Fd6a75c03b9d000000.ts')
const ab = await r.arrayBuffer()
console.log(r.status, r.headers.get('content-type'), 'bytes=' + ab.byteLength)

console.log('--- img ---')
r = await call('/api/img?u=https%3A%2F%2Fp.lztutu.com%2Fupload%2Fvod%2F20261108-1%2Fb4a79c12f640b2a3fadcdb556246d0fe.webp')
console.log(r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength)

console.log('--- 内网拦截 ---')
r = await call('/api/maccms?__base=http%3A%2F%2F192.168.1.1%2F')
console.log(r.status, await r.text())
r = await call('/api/img?u=http%3A%2F%2Flocalhost%2Fx.png')
console.log(r.status, await r.text())

console.log('--- 未知路径 ---')
r = await call('/api/nothing')
console.log(r.status, await r.text())
