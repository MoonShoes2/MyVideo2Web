/**
 * 追影 Web 版 · 本地代理服务
 *
 * 浏览器直连采集站会遇到三个死结：
 *  1. 采集接口没有 CORS 头，跨域请求被浏览器拦掉；
 *  2. 接口的 Content-Type 是 text/html，但内容是 JSON；
 *  3. m3u8 的分片地址指向各种 CDN，时有时无 CORS，而且离线缓存需要一个同源地址。
 *
 * 所以这里只做一件事：把「取数据/取流」搬到服务端，浏览器只跟同源打交道。
 * 生产模式下它同时托管 dist 静态文件，一个进程就够。
 */
import express from 'express'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 8787)

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36'

const DEFAULT_BASE = 'https://cj.lziapi.com/'
const API_PATH = 'api.php/provide/vod/'

const app = express()

// ─────────────────────────── 基础工具 ───────────────────────────

function normalizeBase(raw) {
  let url = String(raw || '').trim()
  if (!url) return DEFAULT_BASE
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  if (!url.endsWith('/')) url += '/'
  return url
}

const privateV4 = [
  [/^10\./, '10/8'],
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'link-local'],
  [/^192\.168\./, '192.168/16'],
  [/^172\.(1[6-9]|2\d|3[01])\./, '172.16/12'],
  [/^0\./, '0/8'],
]

const ipGuardCache = new Map()

/** 只允许公网 http(s)：避免这个代理被当成访问内网的跳板。 */
async function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('地址格式不正确')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http/https 地址')
  const host = u.hostname
  if (ipGuardCache.has(host)) return u

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('该地址不允许访问')
  }
  const literal = net.isIP(host)
  if (literal === 4 && privateV4.some(([re]) => re.test(host))) throw new Error('该地址不允许访问')
  if (literal === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    throw new Error('该地址不允许访问')
  }
  if (!literal) {
    const addrs = await dns.lookup(host, { all: true }).catch(() => [])
    for (const a of addrs) {
      if (a.family === 4 && privateV4.some(([re]) => re.test(a.address))) throw new Error('该地址不允许访问')
      if (a.family === 6 && (a.address === '::1' || a.address.startsWith('fc') || a.address.startsWith('fd'))) {
        throw new Error('该地址不允许访问')
      }
    }
  }
  ipGuardCache.set(host, true)
  return u
}

async function upstream(url, { range, referer, accept } = {}) {
  const u = await assertPublicUrl(url)
  const headers = { 'User-Agent': USER_AGENT, Accept: accept || '*/*' }
  if (referer) headers.Referer = referer
  if (range) headers.Range = range
  const res = await fetch(u, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  return res
}

function fail(res, err, status = 502) {
  res.status(status).json({ error: err?.message || '代理请求失败' })
}

function baseFrom(req) {
  const raw = req.query.__base
  if (Array.isArray(raw)) return normalizeBase(raw[0])
  return normalizeBase(raw)
}

// ─────────────────────────── 采集接口 ───────────────────────────

/**
 * GET /api/maccms?__base=<采集站>&ac=list&pg=1...
 * 原样返回接口文本：该站 Content-Type 是 text/html，前端自己按 JSON 解析。
 */
app.get('/api/maccms', async (req, res) => {
  try {
    const url = new URL(API_PATH, baseFrom(req))
    for (const [k, v] of Object.entries(req.query)) {
      if (k === '__base') continue
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)))
      else if (v != null) url.searchParams.set(k, String(v))
    }
    const r = await upstream(url.href, { accept: 'application/json, text/plain, */*' })
    const body = await r.text()
    res.status(r.status).type('text/plain; charset=utf-8').set('Cache-Control', 'no-store').send(body)
  } catch (e) {
    fail(res, e)
  }
})

/** GET /api/ping?__base=... —— 设置页「测试连接」。 */
app.get('/api/ping', async (req, res) => {
  try {
    const url = new URL(API_PATH + '?ac=list&pagesize=1', baseFrom(req))
    const r = await upstream(url.href)
    res.json({ status: r.status })
  } catch (e) {
    res.status(502).json({ error: e?.message || '连接失败' })
  }
})

/** GET /api/html?__base=...&path=/type/1.html —— 筛选字典 / 筛选列表 / 热搜榜。 */
app.get('/api/html', async (req, res) => {
  try {
    const base = baseFrom(req)
    const raw = String(req.query.path || '')
    const url = /^https?:\/\//i.test(raw)
      ? raw
      : raw.startsWith('//')
        ? 'https:' + raw
        : new URL(raw.replace(/^\//, ''), base).href
    const r = await upstream(url, { accept: 'text/html,application/xhtml+xml' })
    if (!r.ok) {
      res.status(r.status).type('text/plain; charset=utf-8').send(`筛选页加载失败（HTTP ${r.status}）`)
      return
    }
    const body = await r.text()
    res.type('text/html; charset=utf-8').set('Cache-Control', 'no-store').send(body)
  } catch (e) {
    fail(res, e)
  }
})

// ─────────────────────────── 媒体代理 ───────────────────────────

function proxyMediaUrl(rawUri, baseUrl) {
  let abs
  try {
    abs = new URL(rawUri, baseUrl).href
  } catch {
    return rawUri
  }
  const isPlaylist = /\.m3u8(\?|$)/i.test(abs)
  const route = isPlaylist ? 'hls' : 'seg'
  return `/api/${route}?u=${encodeURIComponent(abs)}`
}

/**
 * 把播放列表里的地址全部改写成本地代理地址。
 * 分片、子播放列表、密钥、初始化段都要改——漏一个就会在跨域上卡住。
 */
function rewritePlaylist(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]*)"/g, (_m, uri) => `URI="${proxyMediaUrl(uri, baseUrl)}"`)
      }
      return proxyMediaUrl(t, baseUrl)
    })
    .join('\n')
}

/** GET /api/hls?u=<绝对地址> */
app.get('/api/hls', async (req, res) => {
  try {
    const target = String(req.query.u || '')
    if (!target) throw new Error('缺少播放列表地址')
    const r = await upstream(target, { accept: 'application/vnd.apple.mpegurl,*/*' })
    if (!r.ok) {
      res.status(r.status).type('text/plain').send(`播放列表加载失败（HTTP ${r.status}）`)
      return
    }
    const text = await r.text()
    const body = rewritePlaylist(text, r.url || target)
    res
      .type('application/vnd.apple.mpegurl; charset=utf-8')
      // 播放列表本身不缓存：直链带时效签名，缓存等于给自己埋「点了播不动」
      .set('Cache-Control', 'no-store')
      .send(body)
  } catch (e) {
    fail(res, e)
  }
})

/** GET /api/seg?u=<绝对地址> —— 分片 / 密钥 / 图片通用的二进制通道，支持 Range。 */
app.get('/api/seg', async (req, res) => {
  try {
    const target = String(req.query.u || '')
    if (!target) throw new Error('缺少媒体地址')
    const referer = new URL(target).origin + '/'
    const r = await upstream(target, { range: req.headers.range, referer })
    res.status(r.status)
    const type = r.headers.get('content-type') || 'application/octet-stream'
    res.set('Content-Type', type)
    res.set('Accept-Ranges', r.headers.get('accept-ranges') || 'bytes')
    const cr = r.headers.get('content-range')
    if (cr) res.set('Content-Range', cr)
    const len = r.headers.get('content-length')
    if (len) res.set('Content-Length', len)
    // 分片内容不会变（地址本身带版本），可以放心让浏览器缓存
    res.set('Cache-Control', 'public, max-age=86400')
    const buf = Buffer.from(await r.arrayBuffer())
    res.end(buf)
  } catch (e) {
    fail(res, e)
  }
})

/** GET /api/img?u=... —— 海报代理，顺手补上 Referer，绕开部分站点的防盗链。 */
app.get('/api/img', async (req, res) => {
  try {
    const target = String(req.query.u || '')
    if (!target) throw new Error('缺少图片地址')
    const referer = new URL(target).origin + '/'
    const r = await upstream(target, { referer, accept: 'image/*' })
    if (!r.ok) {
      res.status(404).end()
      return
    }
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=604800')
    res.end(Buffer.from(await r.arrayBuffer()))
  } catch {
    res.status(404).end()
  }
})

// ─────────────────────────── 静态资源 ───────────────────────────

const dist = path.join(ROOT, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    // HTML 永远拿最新版：更新代码后手机刷新即可，不会被旧页面缓存卡住（assets 文件名带 hash，可放心长缓存）
    res.set('Cache-Control', 'no-store')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

// 默认监听所有网卡，方便手机 / 局域网设备直接访问 http://<内网IP>:8787；
// 只想本机用时可设 HOST=127.0.0.1。家庭局域网内所有设备都能打开此服务，介意的话收紧。
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`[proxy] http://${HOST === '0.0.0.0' ? '<内网IP>' : HOST}:${PORT}  ${fs.existsSync(dist) ? '(已托管 dist)' : '(仅代理)'}`)
})
