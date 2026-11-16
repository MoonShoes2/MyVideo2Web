import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const ev = []
page.on('console', (m) => { if (m.type() !== 'debug') ev.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => ev.push('[pageerror] ' + e.message))
page.on('response', (r) => { const u=r.url(); if (u.includes('/api/hls')) ev.push(`[hls] ${r.status()} ${u.slice(0,150)}`) })
await page.goto('http://localhost:5173/player/165605?source=1&episode=0', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const btn = page.locator('button[aria-label="播放"]')
if (await btn.count()) { await btn.first().click(); console.log('clicked center play') }
await page.waitForTimeout(4000)
const st = await page.evaluate(() => { const v=document.querySelector('video'); return { paused:v?.paused, t:v?.currentTime, dur:v?.duration, rs:v?.readyState } })
console.log('STATE', st)
console.log(ev.slice(-12).join('\n'))
await page.screenshot({ path: 'shots/09-player-playing.png' })
await browser.close()
