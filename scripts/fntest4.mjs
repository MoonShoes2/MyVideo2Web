import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('functions/api/[[default]].js').href)
const handler = mod.onRequest
const u = 'https://v.lfthirtytwo.com/20261107/11543_4ab406c7/index.m3u8'
const r = await handler({ request: new Request('http://t/api/hls?u=' + encodeURIComponent(u)) })
const text = await r.text()
console.log('status:', r.status, '| type:', r.headers.get('content-type'))
console.log('--- 改写后的 master ---')
console.log(text)
const child = text.split('\n').find(l => l.trim().startsWith('/api/hls?u='))
const r2 = await handler({ request: new Request('http://t' + child.trim()) })
console.log('--- 子列表（重试一次）---')
console.log('status:', r2.status)
if (r2.status === 200) {
  const t2 = await r2.text()
  const segs = t2.split('\n').filter(l => l.trim().startsWith('/api/seg'))
  console.log('分片改写数:', segs.length, '| 首个:', segs[0].slice(0, 80))
} else {
  // 上游偶发 504，重试一次
  const r3 = await handler({ request: new Request('http://t' + child.trim()) })
  console.log('重试后 status:', r3.status)
  if (r3.status === 200) {
    const t3 = await r3.text()
    const segs = t3.split('\n').filter(l => l.trim().startsWith('/api/seg'))
    console.log('分片改写数:', segs.length, '| 首个:', segs[0].slice(0, 80))
  }
}
