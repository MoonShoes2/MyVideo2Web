const B = 'https://myvideo2web.pages.dev'
const d = await (await fetch(`${B}/api/maccms?ac=detail&ids=165605`)).json()
const v = d.list[0]
const froms = v.vod_play_from.split('$$$')
const urls = v.vod_play_url.split('$$$')
for (let i = 0; i < urls.length; i++) {
  const first = urls[i].split('#')[0].split('$').pop()
  console.log(`--- [${froms[i]}] ${first.slice(0, 120)}`)
  const r = await fetch(`${B}/api/hls?u=${encodeURIComponent(first)}`)
  const body = await r.text()
  console.log('proxy status:', r.status, '| body head:', body.slice(0, 120).replace(/\n/g, ' '))
  if (/^https?:\/\//.test(first) && !first.includes('share/')) {
    try {
      const raw = await fetch(first, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0' } })
      console.log('直连上游 status:', raw.status)
    } catch (e) { console.log('直连失败:', e.message) }
  }
}
