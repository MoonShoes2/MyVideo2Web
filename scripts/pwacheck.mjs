import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const r = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  const res = await fetch('/manifest.json')
  const m = await res.json()
  return {
    secureContext: window.isSecureContext,
    sw: regs.map(x => x.active?.scriptURL || x.installing?.scriptURL || 'pending'),
    manifest: { name: m.name, display: m.display, start_url: m.start_url, icons: m.icons.map(i => `${i.sizes} ${i.purpose}`) },
  }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
