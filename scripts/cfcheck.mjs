import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))
await page.goto('https://myvideo2web.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(4000)
const r = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  const m = await (await fetch('/manifest.json')).json()
  return {
    secure: window.isSecureContext,
    sw: regs.map(x => x.active?.scriptURL || 'pending'),
    name: m.name, display: m.display, icons: m.icons.length,
    cards: document.querySelectorAll('img').length,
    text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 120),
  }
})
console.log(JSON.stringify(r, null, 1))
console.log(errs.slice(0, 4).join('\n') || 'no page errors')
await page.screenshot({ path: 'shots/16-cf-home.png' })
await browser.close()
