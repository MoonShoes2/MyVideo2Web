import type { Category, Episode, PlaySource, Vod, VodDto, VodPage, VodResponse } from './types'

/** 采集站的文本字段常混着 HTML 实体与全角空白，统一清一遍再交给 UI。 */
export function cleanText(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "张若昀,李沁,陈道明" → List，去空、去重、限量。 */
export function toNameList(raw: string | null | undefined, limit = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(raw ?? '').split(/[,，/、]/)) {
    const name = part.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= limit) break
  }
  return out
}

/** "0.0" / "" 都视为没有评分，UI 不要显示一个假的 0 分。 */
export function toScoreOrNull(raw: string | null | undefined): string | null {
  const n = Number.parseFloat(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toFixed(1)
}

export function lenientInt(raw: unknown): number {
  if (raw == null) return 0
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** 列表与详情共用一套映射，清洗、去空、评分归一都收在这里。 */
export function toVod(dto: VodDto): Vod {
  const summary = cleanText(dto.vod_content || dto.vod_blurb)
  return {
    id: lenientInt(dto.vod_id),
    name: cleanText(dto.vod_name) || '未知影片',
    poster: String(dto.vod_pic ?? '').trim(),
    remarks: cleanText(dto.vod_remarks),
    year: cleanText(dto.vod_year),
    area: cleanText(dto.vod_area),
    language: cleanText(dto.vod_lang),
    categoryName: cleanText(dto.type_name),
    tags: toNameList(dto.vod_class, 6),
    actors: toNameList(dto.vod_actor),
    director: toNameList(dto.vod_director, 2).join('、'),
    score: toScoreOrNull(dto.vod_score),
    summary: summary.length > 800 ? summary.slice(0, 800) + '…' : summary,
    updatedAt: cleanText(dto.vod_time),
    totalEpisodes: lenientInt(dto.vod_total),
    playFrom: String(dto.vod_play_from ?? ''),
    playUrls: String(dto.vod_play_url ?? ''),
  }
}

export function toCategories(response: VodResponse): Category[] {
  return (response.class ?? [])
    .map((c) => ({
      id: lenientInt(c.type_id),
      name: cleanText(c.type_name),
      parentId: lenientInt(c.type_pid),
    }))
    .filter((c) => c.id > 0 && c.name !== '')
    .sort((a, b) => a.id - b.id)
}

export function toVodPage(response: VodResponse, page: number, pageSize: number): VodPage {
  const items = (response.list ?? []).map(toVod)
  const pageCount = lenientInt(response.pagecount)
  const hasMore =
    items.length === 0 ? false : pageCount > 0 ? page < pageCount : items.length >= pageSize
  return { items, page, hasMore, total: lenientInt(response.total) }
}

/** 播放器只能播直链流；网页分享页 / iframe 属于网页线路。 */
function isStreamUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.flv')
}

/**
 * 解析 vod_play_from / vod_play_url。
 * 线路之间 `$$$`、线路内剧集 `#`、集名与地址用首个 `$`。
 * 整条线路没有流媒体地址 → 网页线路，保留全集但排到最后。
 */
export function parsePlaySources(playFrom: string, playUrls: string): PlaySource[] {
  if (!playUrls.trim()) return []
  const names = playFrom.split('$$$').map((s) => s.trim())
  const groups: PlaySource[] = []

  playUrls.split('$$$').forEach((group, groupIndex) => {
    const episodes: Episode[] = []
    for (const entry of group.split('#')) {
      const cut = entry.indexOf('$')
      if (cut <= 0) continue
      const name = entry.slice(0, cut).trim()
      const url = entry.slice(cut + 1).trim()
      if (!url) continue
      episodes.push({ name: name || `第${episodes.length + 1}集`, url, index: episodes.length })
    }
    if (episodes.length === 0) return

    const streams = episodes.filter((e) => isStreamUrl(e.url))
    const webOnly = streams.length === 0
    const kept = webOnly ? episodes : streams
    groups.push({
      name: names[groupIndex] || `线路${groupIndex + 1}`,
      episodes: kept.map((e, i) => ({ ...e, index: i })),
      webOnly,
    })
  })

  return groups.sort((a, b) => Number(a.webOnly) - Number(b.webOnly))
}

/** 线路名做展示用：接口给的是 1080zyk / ffm3u8 这类技术名，转成人话。 */
export function sourceDisplayName(source: PlaySource): string {
  const name = source.name
  let base: string
  if (/1080/i.test(name)) base = '线路一 · 1080'
  else if (/bfzy/i.test(name)) base = '线路二'
  else if (/ffzy|ffm3u8/i.test(name)) base = '线路三'
  else if (/lzm/i.test(name)) base = '量子线路'
  else if (/liangzi/i.test(name)) base = '量子网页'
  else if (/xigua/i.test(name)) base = '线路五'
  else if (!name.trim()) base = '默认线路'
  else base = name
  return source.webOnly && !base.includes('网页') ? `${base} · 网页` : base
}

/** 详情页副标题：年份 / 地区 / 分类 里挑有值的拼起来。 */
export function metaLine(vod: Pick<Vod, 'year' | 'area' | 'categoryName'>): string {
  return [vod.year, vod.area, vod.categoryName].filter((s) => s && s.trim()).join(' · ')
}

// ─────────────────────────── 时间 / 容量格式 ───────────────────────────

/** 播放进度 / 片长：不足 1 小时用 mm:ss，超过用 h:mm:ss。 */
export function playbackText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function sizeText(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const kb = bytes / 1024
  const mb = kb / 1024
  const gb = mb / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${kb.toFixed(0)} KB`
}

/** 接口的 vod_time 形如 `2026-09-22 14:24:06`。 */
function parseApiTime(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const ts = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
  return Number.isNaN(ts) ? null : ts
}

export function shortDate(raw: string): string {
  const date = raw.split(' ')[0]
  const time = (raw.split(' ')[1] || '').slice(0, 5)
  if (!date || date.length < 10) return ''
  return time ? `${date} ${time}` : date
}

/** 卡片角标用的紧凑更新时间："刚刚" / "3小时前" / "昨天" / "09/22"。 */
export function updateTimeLabel(raw: string, now = Date.now()): string {
  if (!raw) return ''
  const ts = parseApiTime(raw)
  if (ts == null) return ''
  const diff = now - ts
  const hour = 3600_000
  if (diff < hour) return '刚刚'
  if (diff < 24 * hour) return `${Math.floor(diff / hour)}小时前`
  if (diff < 48 * hour) return '昨天'
  if (diff < 30 * 24 * hour) return `${Math.floor(diff / (24 * hour))}天前`
  return raw.slice(5, 10).replace('-', '/')
}

export function updatedHint(raw: string, now = Date.now()): string {
  const ts = parseApiTime(raw)
  if (ts == null) return ''
  const diff = now - ts
  const hour = 3600_000
  if (diff < hour) return '刚刚更新'
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前更新`
  if (diff < 30 * 24 * hour) return `${Math.floor(diff / (24 * hour))} 天前更新`
  return shortDate(raw)
}

/** 1.0 显示成 "1"，1.25 保留两位小数。 */
export function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : String(speed)
}

/** 相对时间：今天带时分，昨天只给日期感，更早按天数退化成日期。 */
export function historyTimeLabel(epochMs: number): string {
  const d = new Date(epochMs)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400_000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (days === 0) return `今天 ${hh}:${mm}`
  if (days === 1) return '昨天'
  if (days >= 2 && days <= 30) return `${days} 天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function isFinished(record: { positionMs: number; durationMs: number }): boolean {
  return record.durationMs > 0 && record.positionMs >= (record.durationMs * 95) / 100
}

export function progressOf(record: { positionMs: number; durationMs: number }): number {
  if (record.durationMs <= 0) return 0
  return Math.min(1, Math.max(0, record.positionMs / record.durationMs))
}
