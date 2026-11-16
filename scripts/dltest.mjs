import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5173/detail/165605', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.click('button[aria-label="下载"]')
await page.waitForTimeout(800)
await page.screenshot({ path: 'shots/10-download-sheet.png' })
await page.getByText('第01集', { exact: true }).last().click()
await page.getByRole('button', { name: '下载', exact: true }).last().click()
await page.waitForTimeout(12000)
await page.goto('http://localhost:5173/downloads', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'shots/11-downloads.png' })
const info = await page.evaluate(async () => {
  const dbs = await indexedDB.databases()
  const cacheNames = await caches.keys()
  let tasks = []
  if (dbs.some(d => d.name === 'zhuiying')) {
    tasks = await new Promise((res) => {
      const req = indexedDB.open('zhuiying')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('downloads', 'readonly')
        const all = tx.objectStore('downloads').getAll()
        all.onsuccess = () => res(all.result.map(t => ({ state: t.state, error: t.error, progress: t.progress, done: t.doneSegments, total: t.totalSegments, segs: t.segmentUrls.length })))
      }
      req.onerror = () => res([])
    })
  }
  let cached = 0
  for (const name of cacheNames) { const c = await caches.open(name); cached += (await c.keys()).length }
  return { dbs: dbs.map(d => d.name), cacheNames, cached, tasks }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
