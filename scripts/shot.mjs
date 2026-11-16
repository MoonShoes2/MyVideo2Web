import { chromium } from 'playwright'
import fs from 'node:fs'

const OUT = 'shots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({
  viewport: { width: 420, height: 900 },
  deviceScaleFactor: 1,
})

const log = []
page.on('console', (m) => {
  if (m.type() === 'error') log.push('[console] ' + m.text())
})
page.on('pageerror', (e) => log.push('[pageerror] ' + e.message))

async function shot(name) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)
await shot('01-home')

// 分类
await page.click('a[href="/category"]')
await page.waitForTimeout(2500)
await shot('02-category')

// 我的
await page.click('a[href="/mine"]')
await page.waitForTimeout(800)
await shot('03-mine')

// 搜索
await page.goto('http://localhost:5173/search', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await shot('04-search')

// 详情：从首页第一张卡进
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const cards = page.locator('button.tap')
await cards.nth(3).click()
await page.waitForTimeout(3000)
await shot('05-detail')

// 播放页
await page.goto('http://localhost:5173/player/165605?source=1&episode=0', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await shot('06-player')
await page.mouse.move(210, 450)
await page.mouse.click(210, 450)
await page.waitForTimeout(600)
await shot('07-player-controls')

// 设置
await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await shot('08-settings')

console.log('--- errors ---')
console.log(log.join('\n') || 'none')
await browser.close()
