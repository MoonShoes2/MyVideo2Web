import { getSettings, normalizeBaseUrl, VOD_API_PATH } from './settings'
import type { VodResponse } from './types'

/** 业务失败（接口不可达、返回结构异常），message 直接给用户看。 */
export class ApiException extends Error {
  cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ApiException'
    if (cause) this.cause = cause
  }
}

export const API_PATH = VOD_API_PATH

/** 代理层失败时返回的是 JSON，别把 `{"error":"fetch failed"}` 原样给用户看。 */
function friendlyProxyError(detail: string): string {
  const text = detail.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as { error?: string }
    const message = String(parsed.error || '')
    if (/fetch failed|timeout|ENOTFOUND|EAI_AGAIN/i.test(message)) {
      return '网络连接失败，请检查网络或稍后重试'
    }
    return message ? `数据源连接失败：${message}` : ''
  } catch {
    return text.slice(0, 120)
  }
}

function baseParam(base?: string): string {
  return encodeURIComponent(normalizeBaseUrl(base ?? getSettings().baseUrl))
}

/** 采集源里存在路径含中文且未编码的地址，交给 URL 会失败；这里做一层宽松编码。 */
export function toPlayableUrl(raw: string): string {
  try {
    return new URL(raw).href
  } catch {
    return raw
  }
}

/**
 * 统一请求出口。
 *
 * 接口响应的 Content-Type 是 text/html（内容是 JSON），所以不能按 json() 读；
 * 这里先读文本，失败按「接口结构变化」报错，而不是抛一个用户看不懂的解析异常。
 */
export async function requestRaw(
  params: Record<string, string | number | undefined>,
  base?: string,
): Promise<string> {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') search.set(k, String(v))
  }
  const url = `/api/maccms?__base=${baseParam(base)}&${search.toString()}`
  let body: string
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ApiException(friendlyProxyError(detail) || `接口返回 HTTP ${res.status}`)
    }
    body = await res.text()
  } catch (e) {
    if (e instanceof ApiException) throw e
    throw new ApiException('网络连接失败，请检查网络或稍后重试', e)
  }
  if (!body.trim()) throw new ApiException('接口返回为空')
  // maccms 站长关闭采集接口时会返回 200 + 纯文本 "closed"
  if (body.trim().toLowerCase() === 'closed') {
    throw new ApiException('数据源接口已关闭，请在设置中更换接口地址')
  }
  return body
}

export async function request<T>(
  params: Record<string, string | number | undefined>,
  parse: (body: string) => T,
  base?: string,
): Promise<T> {
  const body = await requestRaw(params, base)
  try {
    return parse(body)
  } catch (e) {
    console.warn('[api] 响应解析失败:', body.slice(0, 120))
    throw new ApiException('接口数据格式异常，请稍后重试', e)
  }
}

export function parseVodResponse(body: string): VodResponse {
  return JSON.parse(body) as VodResponse
}

/** 一次轻量探活：设置页「测试连接」用。 */
export async function ping(base: string): Promise<number> {
  const res = await fetch(`/api/ping?__base=${encodeURIComponent(normalizeBaseUrl(base))}`)
  const data = (await res.json().catch(() => ({}))) as { status?: number; error?: string }
  if (!res.ok || data.error) throw new ApiException(data.error || '连接失败')
  return data.status ?? 0
}

/** 站内 HTML 页面（筛选字典 / 筛选列表 / 热搜榜）。path 可以是 /type/1.html 或完整地址。 */
export async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`/api/html?__base=${baseParam()}&path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new ApiException(`筛选页加载失败（HTTP ${res.status}）`)
  const text = await res.text()
  if (!text.trim()) throw new ApiException('筛选页返回为空')
  return text
}

/** 媒体地址一律走同源代理：跨域、防盗链、离线缓存三件事一次解决。 */
export function hlsUrl(url: string): string {
  return `/api/hls?u=${encodeURIComponent(toPlayableUrl(url))}`
}

export function segUrl(url: string): string {
  return `/api/seg?u=${encodeURIComponent(toPlayableUrl(url))}`
}

export function imgUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('/api/img')) return url
  return `/api/img?u=${encodeURIComponent(toPlayableUrl(url))}`
}

/** 播放列表原文（用于广告区间解析）。 */
export async function fetchPlaylistText(url: string): Promise<string> {
  const res = await fetch(hlsUrl(url))
  if (!res.ok) throw new ApiException(`播放列表加载失败（HTTP ${res.status}）`)
  return res.text()
}
