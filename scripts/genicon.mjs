/**
 * 生成 PWA 图标：普通 any 图标（圆角、透明底）+ maskable（满铺、内容留安全区）+ apple-touch-icon。
 * 用 Playwright 渲染 HTML 再截图，免装 canvas/sharp 依赖。跑一次即可：node scripts/genicon.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('public/icons', { recursive: true })

const GRADIENT = 'linear-gradient(180deg, #ff8a3d 0%, #ff4d1f 100%)'
const char = (px) => `
  <div style="
    width:100%;height:100%;display:flex;align-items:center;justify-content:center;
    background:${GRADIENT};color:#fff;font-weight:800;
    font-family:'PingFang SC','Microsoft YaHei',sans-serif;
    font-size:${px}px;line-height:1;letter-spacing:-0.05em;
  ">追</div>`

// any 图标：圆角方块 + 12% 外边距（透明底），桌面安装 UI 与标签页里观感自然
const anyHtml = (size) => `
<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;padding:${Math.round(size * 0.06)}px;box-sizing:border-box;background:transparent">
    <div style="width:100%;height:100%;border-radius:${Math.round(size * 0.24)}px;overflow:hidden">
      ${char(size * 0.52)}
    </div>
  </div>
</body></html>`

// maskable：满铺渐变，字形缩到 52% 居中，保证 Android 裁圆后四角也不越出安全区
const maskableHtml = (size) => `
<!doctype html><html><body style="margin:0">
  <div style="width:${size}px;height:${size}px;overflow:hidden">${char(size * 0.52)}</div>
</body></html>`

const browser = await chromium.launch({ channel: 'msedge', headless: true })

async function shoot(html, size, out, transparent) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.screenshot({ path: out, omitBackground: transparent })
  await page.close()
  console.log('✓', out)
}

await shoot(anyHtml(192), 192, 'public/icons/icon-192.png', true)
await shoot(anyHtml(512), 512, 'public/icons/icon-512.png', true)
await shoot(maskableHtml(512), 512, 'public/icons/icon-maskable-512.png', false)
await shoot(anyHtml(180), 180, 'public/icons/apple-touch-icon.png', false)

await browser.close()
console.log('done')
