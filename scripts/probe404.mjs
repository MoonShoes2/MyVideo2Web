import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const missing = []
page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
console.log([...new Set(missing)].slice(0, 10).join('\n') || 'none')
await browser.close()
