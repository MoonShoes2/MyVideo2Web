import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const bad = []
page.on('response', r => { if (r.url().includes('/api/img') && r.status() >= 400) bad.push(`${r.status()} ${decodeURIComponent(r.url()).slice(0,160)}`) })
await page.goto('http://localhost:5173/category', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
console.log(bad.slice(0, 8).join('\n') || 'no bad images', '\ncount', bad.length)
await browser.close()
