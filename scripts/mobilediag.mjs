import { chromium, devices } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
for (const path of ['/', '/category', '/detail/165605']) {
  await page.goto('http://localhost:8787' + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() => {
    const se = document.scrollingElement
    const shell = document.querySelector('.app-shell')
    const wide = []
    const vw = window.innerWidth
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect()
      if (rect.width > vw + 1 || rect.right > vw + 1) {
        const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 60) : el.tagName
        if (wide.length < 5) wide.push(`${el.tagName}.${cls} w=${Math.round(rect.width)} right=${Math.round(rect.right)}`)
      }
    })
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      scrollW: se.scrollWidth, scrollH: se.scrollHeight,
      bodyScrollH: document.body.scrollHeight,
      shellH: shell ? getComputedStyle(shell).height : 'no-shell',
      shellPos: shell ? getComputedStyle(shell).position : '',
      wide,
    }
  })
  console.log(path, JSON.stringify(r, null, 1))
}
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/15-mobile-home.png' })
await browser.close()
