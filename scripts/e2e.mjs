import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))

// 1. 详情页 -> 收藏
await page.goto('http://localhost:5173/detail/165605', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const favBtn = page.locator('button[aria-label*="收藏"]')
if (await favBtn.count()) { await favBtn.first().click(); await page.waitForTimeout(600) }
console.log('fav clicked:', await favBtn.count())

// 2. 进播放页看几秒，产生历史与分集进度
await page.goto('http://localhost:5173/player/165605?source=1&episode=0', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const tap = page.locator('button[aria-label="播放"]')
if (await tap.count()) await tap.first().click()
await page.waitForTimeout(6000)
const st = await page.evaluate(() => { const v = document.querySelector('video'); return { t: v?.currentTime, paused: v?.paused } })
console.log('playback:', JSON.stringify(st))

// 3. 收藏页 / 历史页
for (const [path, shot] of [['/favorites', '13-favorites'], ['/history', '14-history']]) {
  await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `shots/${shot}.png` })
  const txt = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 160))
  console.log(path, '=>', txt)
}
console.log(errs.slice(0, 5).join('\n') || 'no page errors')
await browser.close()
