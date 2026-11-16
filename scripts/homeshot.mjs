import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots/12-home-verify.png' })
const info = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 300),
  bg: [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).backgroundImage !== 'none').length,
}))
console.log(JSON.stringify(info, null, 2))
console.log(errs.slice(0, 6).join('\n') || 'no errors')
await browser.close()
