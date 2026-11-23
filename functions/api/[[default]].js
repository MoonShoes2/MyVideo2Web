/**
 * 追影 Web 版 · EdgeOne Pages 边缘函数
 *
 * 与本地 server/index.mjs 一一对应的云端版代理：采集接口 CORS 代理、
 * m3u8 地址改写、分片/海报流式转发。部署在 EdgeOne Pages 项目的
 * functions/api/[[default]].js，同一个域名下接管所有 /api/* 请求，
 * 前端代码不需要任何改动。
 *
 * 运行时是 V8（Web 标准 API），没有 Node 内置模块：
 *  - 域名 -> IP 的 DNS 解析不可用，防内网跳板只能校验字面量 IP 与
 *    localhost/.internal 等后缀；对「域名解析到私网 IP」的场景放弃防护。
 *  - 分片转发直接把上游 ReadableStream 透传回去，不落缓冲，
 *    CPU 时间占用极低（边缘函数单请求限 200ms CPU）。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36'

const DEFAULT_BASE = 'https://lzizy.net/'
const API_PATH = 'api.php/provide/vod/'

// ─────────────────────────── 基础工具 ───────────────────────────

function normalizeBase(raw) {
  let url = String(raw || '').trim()
  if (!url) return DEFAULT_BASE
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  const index = url.indexOf('api.php')
  if (index > 0) url = url.slice(0, index)
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

/** 只允许公网 http(s)：边缘函数无法做 DNS 解析，这里校验字面量 IP 与主机名后缀。 */
function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('地址格式不正确')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http/https 地址')
  const host = u.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('该地址不允许访问')
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    throw new Error('该地址不允许访问')
  }
  if (privateV4.some(([re]) => re.test(host))) throw new Error('该地址不允许访问')
  return u
}

async function upstream(url, { range, referer, accept } = {}) {
  const u = assertPublicUrl(url)
  const headers = { 'User-Agent': USER_AGENT, Accept: accept || '*/*' }
  if (referer) headers.Referer = referer
  if (range) headers.Range = range
  return fetch(u, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
  })
}

function json(data, status = 502) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function fail(err, status = 502) {
  return json({ error: err?.message || '代理请求失败' }, status)
}

// ─────────────────────────── 采集接口 ───────────────────────────

/**
 * GET /api/maccms?__base=<采集站>&ac=list&pg=1...
 * 原样返回接口文本：该站 Content-Type 是 text/html，前端自己按 JSON 解析。
 */
async function handleMaccms(url) {
  const base = normalizeBase(url.searchParams.get('__base'))
  const target = new URL(API_PATH, base)
  for (const [k, v] of url.searchParams.entries()) {
    if (k === '__base') continue
    target.searchParams.append(k, v)
  }
  const r = await upstream(target.href, { accept: 'application/json, text/plain, */*' })
  const body = await r.text()
  return new Response(body, {
    status: r.status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/** GET /api/ping?__base=... —— 设置页「测试连接」。 */
async function handlePing(url) {
  const base = normalizeBase(url.searchParams.get('__base'))
  const target = new URL(API_PATH + '?ac=list&pagesize=1', base)
  const r = await upstream(target.href)
  return json({ status: r.status }, 200)
}

/** GET /api/html?__base=...&path=/type/1.html —— 筛选字典 / 筛选列表 / 热搜榜。 */
async function handleHtml(url) {
  const base = normalizeBase(url.searchParams.get('__base'))
  const raw = String(url.searchParams.get('path') || '')
  const target = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith('//')
      ? 'https:' + raw
      : new URL(raw.replace(/^\//, ''), base).href
  const r = await upstream(target, { accept: 'text/html,application/xhtml+xml' })
  if (!r.ok) {
    return new Response(`筛选页加载失败（HTTP ${r.status}）`, {
      status: r.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const body = await r.text()
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

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
async function handleHls(url) {
  const target = String(url.searchParams.get('u') || '')
  if (!target) throw new Error('缺少播放列表地址')
  const r = await upstream(target, { accept: 'application/vnd.apple.mpegurl,*/*' })
  if (!r.ok) {
    return new Response(`播放列表加载失败（HTTP ${r.status}）`, {
      status: r.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const text = await r.text()
  // 死线路常见「200 + 一整页 HTML 错误页」，改写它只会得到一堆垃圾地址
  if (!text.includes('#EXTM3U')) {
    return new Response('播放列表无效（上游返回的不是 m3u8），请切换线路', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const body = rewritePlaylist(text, r.url || target)
  return new Response(body, {
    headers: {
      // 播放列表本身不缓存：直链带时效签名，缓存等于给自己埋「点了播不动」
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/** GET /api/seg?u=<绝对地址> —— 分片 / 密钥 / 图片通用的二进制通道，支持 Range。 */
async function handleSeg(request, url) {
  const target = String(url.searchParams.get('u') || '')
  if (!target) throw new Error('缺少媒体地址')
  const referer = new URL(target).origin + '/'
  const r = await upstream(target, { range: request.headers.get('range'), referer })
  const headers = new Headers()
  headers.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream')
  headers.set('Accept-Ranges', r.headers.get('accept-ranges') || 'bytes')
  const cr = r.headers.get('content-range')
  if (cr) headers.set('Content-Range', cr)
  const len = r.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  // 分片内容不会变（地址本身带版本），可以放心让浏览器缓存
  headers.set('Cache-Control', 'public, max-age=86400')
  // 上游 body 直接透传（流式），不整段读进内存
  return new Response(r.body, { status: r.status, headers })
}

/** GET /api/img?u=... —— 海报代理，顺手补上 Referer，绕开部分站点的防盗链。 */
async function handleImg(url) {
  const target = String(url.searchParams.get('u') || '')
  if (!target) throw new Error('缺少图片地址')
  const referer = new URL(target).origin + '/'
  const r = await upstream(target, { referer, accept: 'image/*' })
  if (!r.ok) return new Response(null, { status: 404 })
  return new Response(r.body, {
    headers: {
      'Content-Type': r.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
    },
  })
}

// ─────────────────────────── 路由入口 ───────────────────────────

export async function onRequest(context) {
  const { request } = context
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)
  const url = new URL(request.url)
  try {
    switch (url.pathname) {
      case '/api/maccms':
        return await handleMaccms(url)
      case '/api/ping':
        return await handlePing(url)
      case '/api/html':
        return await handleHtml(url)
      case '/api/hls':
        return await handleHls(url)
      case '/api/seg':
        return await handleSeg(request, url)
      case '/api/img':
        return await handleImg(url)
      default:
        return json({ error: 'not found' }, 404)
    }
  } catch (e) {
    return fail(e)
  }
}
