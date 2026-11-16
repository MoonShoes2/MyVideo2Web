import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const bad = []
page.on('response', (r) => { if (r.url().includes('/api/img') && r.status() >= 400) bad.push(`${r.status()} ${decodeURIComponent(r.url()).slice(0,140)}`) })
const pages = ['/home', '/category', '/search', '/mine', '/detail/165605', '/favorites', '/history', '/downloads', '/settings']
for (const p of pages) {
  await page.goto('http://localhost:5173' + p, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  const stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')]
    return { total: imgs.length, broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.slice(0, 100)).slice(0, 3) }
  })
  console.log(p.padEnd(16), 'imgs=' + stats.total, stats.broken.length ? 'BROKEN: ' + stats.broken.join(' | ') : 'ok')
}
console.log('--- proxy 4xx/5xx ---')
console.log(bad.length ? [...new Set(bad)].slice(0, 6).join('\n') : 'none')
await browser.close()
