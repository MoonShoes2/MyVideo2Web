import { chromium } from 'playwright'

const target = 'https://myvideo2web.pages.dev/player/159750?source=0&episode=0'
const b = await chromium.launch({ channel: 'msedge', headless: true })
const page = await b.newPage({ viewport: { width: 420, height: 900 } })

const logs = []
const reqs = []
const fails = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`))
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/') || u.includes('m3u8')) reqs.push({ phase: 'req', url: u.slice(0, 160) })
})
page.on('requestfinished', (r) => {
  const u = r.url()
  if (u.includes('/api/')) reqs.push({ phase: 'done', url: u.slice(0, 160) })
})
page.on('requestfailed', (r) => {
  const u = r.url()
  if (u.includes('/api/')) fails.push({ url: u.slice(0, 160), err: r.failure()?.errorText })
})

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 })
} catch (e) {
  console.log('GOTO_FAIL', e.message.slice(0, 200))
}
await page.waitForTimeout(30000)

const state = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 300),
  hasVideo: !!document.querySelector('video'),
  videoReadyState: document.querySelector('video')?.readyState ?? null,
  videoSrc: (document.querySelector('video')?.currentSrc || '').slice(0, 120),
  swController: !!navigator.serviceWorker?.controller,
  displayMode: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
})).catch((e) => ({ error: String(e) }))

console.log('=== STATE ===')
console.log(JSON.stringify(state, null, 2))
console.log('=== API 请求 ===')
console.log(JSON.stringify(reqs.slice(-15), null, 2))
console.log('=== 失败 ===')
console.log(JSON.stringify(fails.slice(-10), null, 2))
console.log('=== 日志 ===')
console.log(logs.slice(-20).join('\n'))
await page.screenshot({ path: 'C:/workspace/MyVideo2Web/shots/online-player.png' })
await b.close()
