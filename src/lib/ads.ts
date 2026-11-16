import { fetchPlaylistText } from './api'

export interface AdRange {
  startMs: number
  endMs: number
}

interface AdSegment {
  index: number
  uri: string
  startMs: number
  endMs: number
  durationSec: number
  groupIndex: number
}

/** 广告分片地址的标记词：只放实测确认过的 `adjump`，宁可漏判也不误伤正片。 */
const MARKS = ['adjump']
const MAX_AD_RANGE_MS = 5 * 60_000
const MAX_AD_RATIO = 0.5
const MIN_SPLICE_MS = 1000
const MAX_SPLICE_MS = 30_000

function isAdUri(uri: string): boolean {
  const lower = uri.toLowerCase()
  return MARKS.some((m) => lower.includes(m))
}

function dirOf(uri: string): string {
  const noQuery = uri.split('?')[0]
  if (!noQuery.includes('/')) return ''
  return noQuery.slice(0, noQuery.lastIndexOf('/'))
}

/**
 * 把媒体播放列表拆成分片；直播 / master / 字节范围分片直接放弃。
 * 对应原工程 AdMarkParser.parseSegments。
 */
export function parseSegments(playlist: string): AdSegment[] {
  const lines = playlist.split(/\r?\n/).map((l) => l.trim())
  if (!lines.includes('#EXT-X-ENDLIST')) return []
  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) return []
  if (lines.some((l) => l.startsWith('#EXT-X-BYTERANGE'))) return []

  const out: AdSegment[] = []
  let cursor = 0
  let pending = -1
  let group = 0
  for (const line of lines) {
    if (line === '#EXT-X-DISCONTINUITY') {
      group++
    } else if (line.startsWith('#EXTINF:')) {
      const v = Number.parseFloat(line.slice(8).split(',')[0])
      pending = Number.isFinite(v) ? v : -1
    } else if (line && !line.startsWith('#') && pending >= 0) {
      const startMs = Math.round(cursor * 1000)
      cursor += pending
      out.push({
        index: out.length,
        uri: line,
        startMs,
        endMs: Math.round(cursor * 1000),
        durationSec: pending,
        groupIndex: group,
      })
      pending = -1
    }
  }
  return out
}

function markerRanges(segments: AdSegment[]): AdRange[] {
  const ranges: AdRange[] = []
  let adStart = -1
  for (const s of segments) {
    const ad = isAdUri(s.uri)
    if (ad && adStart < 0) adStart = s.startMs
    if (!ad && adStart >= 0) {
      ranges.push({ startMs: adStart, endMs: s.startMs })
      adStart = -1
    }
  }
  if (adStart >= 0) ranges.push({ startMs: adStart, endMs: segments[segments.length - 1].endMs })
  return ranges
}

/** 跨源拼接：某个 DISCONTINUITY 组分片目录与主目录不一致且足够短，就是插进来的广告素材。 */
function spliceRanges(segments: AdSegment[]): AdRange[] {
  if (!segments.some((s) => s.groupIndex > 0)) return []
  const counts = new Map<string, number>()
  segments.forEach((s) => counts.set(dirOf(s.uri), (counts.get(dirOf(s.uri)) ?? 0) + 1))
  let dominant = ''
  let max = -1
  counts.forEach((n, dir) => {
    if (n > max) {
      max = n
      dominant = dir
    }
  })
  const byGroup = new Map<number, AdSegment[]>()
  segments.forEach((s) => {
    const list = byGroup.get(s.groupIndex) ?? []
    list.push(s)
    byGroup.set(s.groupIndex, list)
  })
  const out: AdRange[] = []
  Array.from(byGroup.keys())
    .sort((a, b) => a - b)
    .forEach((g) => {
      const group = byGroup.get(g)!
      const dir = dirOf(group[0].uri)
      if (dir === dominant || group.some((s) => dirOf(s.uri) !== dir)) return
      const duration = group[group.length - 1].endMs - group[0].startMs
      if (duration < MIN_SPLICE_MS || duration > MAX_SPLICE_MS) return
      out.push({ startMs: group[0].startMs, endMs: group[group.length - 1].endMs })
    })
  return out
}

function mergeOverlapping(ranges: AdRange[]): AdRange[] {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const out: AdRange[] = [sorted[0]]
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (r.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, r.endMs)
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** 标记法 + 拼接法；占比超过一半则认为规则失配，整集不跳。 */
export function parseAdRanges(playlist: string): AdRange[] {
  const segments = parseSegments(playlist)
  if (segments.length === 0) return []
  const ranges = mergeOverlapping([...markerRanges(segments), ...spliceRanges(segments)])
  if (ranges.length === 0) return []
  const total = segments[segments.length - 1].endMs
  if (total <= 0) return []
  if (ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0) > total * MAX_AD_RATIO) return []
  return ranges.filter((r) => r.endMs - r.startMs > 0 && r.endMs - r.startMs <= MAX_AD_RANGE_MS)
}

function isMaster(playlist: string): boolean {
  return playlist.split(/\r?\n/).some((l) => l.trim().startsWith('#EXT-X-STREAM-INF'))
}

/** 取当前集的广告区间；master 播放列表先下钻到第一条子线路。失败返回 null（交给上层重试）。 */
export async function resolveAdRanges(url: string): Promise<AdRange[] | null> {
  try {
    const text = await fetchPlaylistText(url)
    if (!isMaster(text)) return parseAdRanges(text)
    const lines = text.split(/\r?\n/).map((l) => l.trim())
    const at = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'))
    const child = lines.slice(at + 1).find((l) => l && !l.startsWith('#'))
    if (!child) return []
    // 代理已经把 URI 改写成了 /api/hls?u=...：直接请求它，别再套一层 hlsUrl
    const childText = child.startsWith('/api/')
      ? await (await fetch(child)).text()
      : await fetchPlaylistText(child)
    return parseAdRanges(childText)
  } catch (e) {
    console.warn('[ad] 广告区间解析失败:', (e as Error).message)
    return null
  }
}

export function inRange(ranges: AdRange[], positionMs: number): AdRange | null {
  return ranges.find((r) => positionMs >= r.startMs && positionMs < r.endMs) ?? null
}
