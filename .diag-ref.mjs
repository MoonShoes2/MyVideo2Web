import { chromium } from 'playwright'

const b = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await b.newContext()
const page = await ctx.newPage()
await page.goto('https://myvideo2web.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 45000 })

const url = 'https://v.lzcdn31.com/20261005/12381_ce48aa78/2000k/hls/mixed.m3u8'
const out = []
for (const referer of [null, 'https://v.lzcdn31.com/', 'https://myvideo2web.pages.dev/']) {
  const t0 = Date.now()
  try {
    const headers = referer ? { Referer: referer } : {}
    const r = await ctx.request.get(url, { timeout: 15000, headers })
    const body = await r.text()
    out.push({ referer: referer ?? '(none)', status: r.status(), ms: Date.now() - t0, bytes: body.length })
  } catch (e) {
    out.push({ referer: referer ?? '(none)', error: String(e).slice(0, 80), ms: Date.now() - t0 })
  }
}
console.log(JSON.stringify(out, null, 2))
await b.close()
