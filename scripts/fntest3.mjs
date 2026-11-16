import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('functions/api/[[default]].js').href)
const handler = mod.onRequest
const u = 'https://v.lfthirtytwo.com/20261107/11543_4ab406c7/index.m3u8'
const r = await handler({ request: new Request('http://t/api/hls?u=' + encodeURIComponent(u)) })
const text = await r.text()
console.log('status:', r.status, '| type:', r.headers.get('content-type'))
const lines = text.split('\n')
console.log(lines.slice(0, 6).join('\n'))
const proxied = lines.filter(l => l.trim().startsWith('/api/'))
console.log('改写地址示例:', proxied[0])
const child = proxied.find(l => l.includes('/api/hls?u='))
if (child) {
  const r2 = await handler({ request: new Request('http://t' + child.trim()) })
  const t2 = await r2.text()
  const segs = t2.split('\n').filter(l => l.trim().startsWith('/api/seg'))
  console.log('子列表:', r2.status, '| 分片改写数:', segs.length, '| 首个分片:', segs[0]?.slice(0, 80))
}
