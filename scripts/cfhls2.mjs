const B = 'https://myvideo2web.pages.dev'
const d = await (await fetch(`${B}/api/maccms?ac=detail&ids=165605`)).json()
const v = d.list[0]
const froms = v.vod_play_from.split('$$$')
const urls = v.vod_play_url.split('$$$')
for (let i = 0; i < urls.length; i++) {
  const first = urls[i].split('#')[0].split('$').pop()
  if (!/\.m3u8/.test(first)) { console.log(`[${froms[i]}] 非 m3u8，跳过`); continue }
  const r = await fetch(`${B}/api/hls?u=${encodeURIComponent(first)}`)
  const text = await r.text()
  console.log(`[${froms[i]}] master=${r.status}`)
  if (r.status !== 200) continue
  const child = text.split('\n').find(l => l.trim().startsWith('/api/hls?u='))
  const t2 = await (child ? fetch(B + child.trim()) : Promise.resolve({ text: async () => text, status: 200 }))
  const txt2 = await t2.text()
  const segs = txt2.split('\n').filter(l => l.trim().startsWith('/api/seg'))
  console.log(`  子列表=${t2.status} 分片=${segs.length}`)
  if (segs.length) {
    const r3 = await fetch(B + segs[0].trim(), { headers: { Range: 'bytes=0-1023' } })
    console.log('  分片:', r3.status, r3.headers.get('content-type'), (await r3.arrayBuffer()).byteLength, 'bytes')
    break
  }
}
