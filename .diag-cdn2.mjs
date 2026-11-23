import { chromium } from 'playwright'

const b = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await b.newContext()
const page = await ctx.newPage()
await page.goto('https://myvideo2web.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 45000 })

const urls = [
  'https://v.lzcdn31.com/20261005/12381_ce48aa78/index.m3u8',
  'https://v.lzcdn31.com/20261005/12381_ce48aa78/2000k/hls/mixed.m3u8',
]
const out = []
for (const u of urls) {
  const t0 = Date.now()
  try {
    const r = await ctx.request.get(u, { timeout: 20000, headers: { Referer: 'https://myvideo2web.pages.dev/' } })
    const body = await r.text()
    out.push({
      tail: u.split('/').slice(-2).join('/'),
      status: r.status(),
      ms: Date.now() - t0,
      bytes: body.length,
      head: body.slice(0, 50).replace(/\n/g, ' '),
    })
  } catch (e) {
    out.push({ tail: u.split('/').slice(-2).join('/'), error: String(e).slice(0, 100), ms: Date.now() - t0 })
  }
}
console.log(JSON.stringify(out, null, 2))
await b.close()
