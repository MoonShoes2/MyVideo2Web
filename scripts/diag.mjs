import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const events = []
page.on('console', (m) => events.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => events.push('[pageerror] ' + e.message))
page.on('requestfailed', (r) => events.push(`[reqfail] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`))
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/api/')) events.push(`[resp] ${r.status()} ${u.slice(0, 160)}`)
})

await page.goto('http://localhost:5173/player/165605?source=1&episode=0', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const state = await page.evaluate(() => {
  const v = document.querySelector('video')
  return {
    readyState: v?.readyState,
    networkState: v?.networkState,
    error: v?.error && { code: v.error.code, message: v.error.message },
    paused: v?.paused,
    currentTime: v?.currentTime,
    duration: v?.duration,
    src: v?.currentSrc?.slice(0, 120),
    canH264: v?.canPlayType('video/mp4; codecs="avc1.42E01E"'),
    canHls: v?.canPlayType('application/vnd.apple.mpegurl'),
    buffered: v?.buffered.length,
  }
})
console.log('STATE', JSON.stringify(state, null, 2))
console.log('--- events ---')
console.log(events.slice(-40).join('\n'))
await browser.close()
