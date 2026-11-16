const B = 'https://myvideo2web.pages.dev'
const master = 'https://v.lfthirtytwo.com/20261107/11543_4ab406c7/index.m3u8'
const r = await fetch(`${B}/api/hls?u=${encodeURIComponent(master)}`)
const text = await r.text()
console.log('master:', r.status, '| 行数:', text.split('\n').length)
const child = text.split('\n').find(l => l.trim().startsWith('/api/hls?u='))
console.log('子列表:', decodeURIComponent(child).slice(0, 110))
const r2 = await fetch(B + child.trim())
const t2 = await r2.text()
const segs = t2.split('\n').filter(l => l.trim().startsWith('/api/seg'))
console.log('子列表:', r2.status, '| 分片数:', segs.length)
if (segs.length) {
  const r3 = await fetch(B + segs[0].trim(), { headers: { Range: 'bytes=0-2047' } })
  const buf = await r3.arrayBuffer()
  console.log('首分片:', r3.status, r3.headers.get('content-type'), buf.byteLength, 'bytes | Content-Range:', r3.headers.get('content-range'))
  const r4 = await fetch(B + segs[0].trim())
  console.log('不带 Range:', r4.status, (await r4.arrayBuffer()).byteLength, 'bytes')
}
