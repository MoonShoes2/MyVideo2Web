const B = 'https://myvideo2web.pages.dev'
const d = await (await fetch(`${B}/api/maccms?ac=detail&ids=165605`)).json()
const v = d.list[0]
console.log('片名:', v.vod_name)
const urls = v.vod_play_url.split('$$$')
const first = urls[0].split('#')[0].split('$').pop()
console.log('播放地址:', first.slice(0, 90))
const r = await fetch(`${B}/api/hls?u=${encodeURIComponent(first)}`)
const text = await r.text()
console.log('hls status:', r.status, '| type:', r.headers.get('content-type'))
if (r.status !== 200) { console.log(text.slice(0, 150)); process.exit(0) }
const child = text.split('\n').find(l => l.trim().startsWith('/api/hls?u='))
console.log('子列表地址:', child?.slice(0, 90) || '(无，可能是媒体列表本身)')
const target = child ? `${B}${child.trim()}` : `${B}/api/hls?u=${encodeURIComponent(first)}`
const r2 = await fetch(target)
const t2 = await r2.text()
const segs = t2.split('\n').filter(l => l.trim().startsWith('/api/seg'))
console.log('子列表:', r2.status, '| 分片数:', segs.length)
if (segs.length) {
  const r3 = await fetch(B + segs[0].trim(), { headers: { Range: 'bytes=0-1023' } })
  console.log('首个分片:', r3.status, r3.headers.get('content-type'), (await r3.arrayBuffer()).byteLength, 'bytes')
}
