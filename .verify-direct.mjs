import { chromium } from 'playwright'

const b = await chromium.launch({ channel: 'msedge', headless: true })
const page = await b.newPage({ viewport: { width: 420, height: 900 } })

const net = []
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('lzcdn') || u.includes('/api/hls') || u.includes('/api/seg')) {
    net.push({ t: 'req', u: u.includes('lzcdn') ? 'DIRECT:' + u.split('/').slice(-2).join('/') : u.replace(/^https?:\/\/[^/]+/, '').slice(0, 60) })
  }
})
page.on('requestfailed', (r) => {
  const u = r.url()
  if (u.includes('lzcdn') || u.includes('/api/hls')) net.push({ t: 'FAIL', u: u.slice(0, 70), err: r.failure()?.errorText })
})

await page.goto('http://127.0.0.1:5173/player/159750?source=0&episode=0', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(18000)

const state = await page.evaluate(() => {
  const v = document.querySelector('video')
  return {
    text: document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '),
    readyState: v?.readyState ?? null,
    currentTime: v ? Math.round(v.currentTime * 10) / 10 : null,
    paused: v?.paused ?? null,
    duration: v && Number.isFinite(v.duration) ? Math.round(v.duration) : null,
    error: v?.error?.code ?? null,
    src: (v?.currentSrc || '').slice(0, 80),
  }
})
console.log('STATE:', JSON.stringify(state, null, 2))
console.log('NET(前20):')
console.log(JSON.stringify(net.slice(0, 20), null, 1))
await page.screenshot({ path: 'C:/workspace/MyVideo2Web/shots/verify-direct.png' })
await b.close()
