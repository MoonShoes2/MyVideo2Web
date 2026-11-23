import { chromium } from 'playwright'

const b = await chromium.launch({ channel: 'msedge', headless: true })
const page = await b.newPage()

await page.goto('https://myvideo2web.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 45000 })

const result = await page.evaluate(async () => {
  const tests = [
    'https://v.lzcdn31.com/20261005/12381_ce48aa78/index.m3u8',
    'https://v.lzcdn31.com/20261005/12381_ce48aa78/2000k/hls/mixed.m3u8',
  ]
  const out = []
  for (const url of tests) {
    const t0 = performance.now()
    try {
      const res = await fetch(url, { mode: 'cors' })
      const text = await res.text()
      out.push({
        url: url.split('/').slice(-2).join('/'),
        ok: res.ok,
        status: res.status,
        ms: Math.round(performance.now() - t0),
        bytes: text.length,
        cors: res.type,
        head: text.slice(0, 40),
      })
    } catch (e) {
      out.push({ url: url.split('/').slice(-2).join('/'), error: String(e).slice(0, 120), ms: Math.round(performance.now() - t0) })
    }
  }
  return out
})

console.log(JSON.stringify(result, null, 2))
await b.close()
