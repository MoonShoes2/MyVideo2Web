import { db, prunePageCache } from './db'
import { ApiException, fetchHtml, request } from './api'
import {
  cleanText,
  parsePlaySources,
  progressOf,
  toCategories,
  toVod,
  toVodPage,
} from './parse'
import { getSettings, normalizeBaseUrl } from './settings'
import type {
  Category,
  EpisodeHistoryRecord,
  FavoriteRecord,
  HistoryRecord,
  Vod,
  VodPage,
  VodResponse,
} from './types'
import { HISTORY_LIMIT } from './types'

/**
 * 缓存策略按「变化速度」分层（与原工程一致）：
 *  - 分类字典几乎不变 → 24h；
 *  - 列表 / 搜索 → 30min / 10min，翻页也缓存；
 *  - 详情 → 5min；播放地址永远取最新，直链带时效签名。
 */
const TTL_CATEGORIES = 24 * 3600_000
const TTL_LIST = 30 * 60_000
const TTL_SEARCH = 10 * 60_000
const TTL_DETAIL = 5 * 60_000

export const PAGE_SIZE = 12

async function readCache(key: string): Promise<{ json: string; savedAt: number } | null> {
  const row = await db.pageCache.get(key)
  return row ? { json: row.json, savedAt: row.savedAt } : null
}

async function writeCache(key: string, json: string) {
  await db.pageCache.put({ key, json, savedAt: Date.now() })
  void prunePageCache().catch(() => undefined)
}

export async function clearPageCache() {
  await db.pageCache.clear()
}

function listKey(page: number, typeId?: number | null, keyword?: string | null, pageSize = PAGE_SIZE) {
  return `list:${typeId ?? 0}:${keyword ?? ''}:${page}:${pageSize}`
}

function listParams(page: number, typeId?: number | null, keyword?: string | null, pageSize = PAGE_SIZE) {
  return {
    ac: 'detail',
    pg: page,
    pagesize: pageSize,
    ...(typeId ? { t: typeId } : {}),
    ...(keyword && keyword.trim() ? { wd: keyword.trim() } : {}),
  }
}

/**
 * 统一请求出口。有缓存且未过期直接返回；请求失败时退回过期缓存，
 * 让用户至少能看到旧列表，而不是一屏错误。
 */
async function fetchResponse(
  params: Record<string, string | number | undefined>,
  key: string | null,
  ttlMs: number,
  force: boolean,
): Promise<VodResponse & { rawJson: string }> {
  if (key && !force) {
    const entry = await readCache(key).catch(() => null)
    if (entry && Date.now() - entry.savedAt < ttlMs) {
      try {
        return { ...(JSON.parse(entry.json) as VodResponse), rawJson: entry.json }
      } catch {
        /* 缓存坏了就当没有 */
      }
    }
  }

  try {
    const response = await request(params, (body) => {
      const parsed = JSON.parse(body) as VodResponse
      return { ...parsed, rawJson: body }
    })
    if (key) await writeCache(key, response.rawJson).catch(() => undefined)
    const code = Number(response.code ?? 1)
    const list = response.list ?? []
    if (code !== 1 && code !== 200 && list.length === 0) {
      throw new ApiException(cleanText(response.msg) || `接口返回异常（code=${response.code}）`)
    }
    return response
  } catch (e) {
    if (key) {
      const stale = await readCache(key).catch(() => null)
      if (stale) {
        try {
          return { ...(JSON.parse(stale.json) as VodResponse), rawJson: stale.json }
        } catch {
          /* ignore */
        }
      }
    }
    throw e
  }
}

export async function fetchCategories(force = false): Promise<Category[]> {
  const response = await fetchResponse(
    { ac: 'list', pg: 1, pagesize: 2 },
    'categories',
    TTL_CATEGORIES,
    force,
  )
  return toCategories(response)
}

export async function fetchPage(
  page: number,
  typeId?: number | null,
  keyword?: string | null,
  pageSize = PAGE_SIZE,
  force = false,
): Promise<VodPage> {
  const response = await fetchResponse(
    listParams(page, typeId, keyword, pageSize),
    listKey(page, typeId, keyword, pageSize),
    keyword && keyword.trim() ? TTL_SEARCH : TTL_LIST,
    force,
  )
  return toVodPage(response, page, pageSize)
}

/** 只读本地缓存的第一页，不触发网络：首页冷启动先把上次的内容铺上去。 */
export async function cachedPage(
  page = 1,
  typeId?: number | null,
  keyword?: string | null,
  pageSize = PAGE_SIZE,
): Promise<{ page: VodPage; savedAt: number } | null> {
  const entry = await readCache(listKey(page, typeId, keyword, pageSize)).catch(() => null)
  if (!entry) return null
  try {
    return { page: toVodPage(JSON.parse(entry.json) as VodResponse, page, pageSize), savedAt: entry.savedAt }
  } catch {
    return null
  }
}

export async function fetchDetail(vodId: number, force = false): Promise<Vod> {
  const response = await fetchResponse(
    { ac: 'detail', ids: vodId },
    `detail:${vodId}`,
    TTL_DETAIL,
    force,
  )
  const dto = (response.list ?? [])[0]
  if (!dto) throw new ApiException('影片不存在或已下架')
  return toVod(dto)
}

export async function cachedDetail(vodId: number): Promise<Vod | null> {
  const entry = await readCache(`detail:${vodId}`).catch(() => null)
  if (!entry) return null
  try {
    const dto = (JSON.parse(entry.json) as VodResponse).list?.[0]
    return dto ? toVod(dto) : null
  } catch {
    return null
  }
}

// ─────────────────────────── 本地片库 ───────────────────────────

export async function listFavorites(): Promise<FavoriteRecord[]> {
  return db.favorites.orderBy('addedAt').reverse().toArray()
}

export async function listHistory(): Promise<HistoryRecord[]> {
  return db.history.orderBy('updatedAt').reverse().toArray()
}

export async function isFavorite(vodId: number): Promise<boolean> {
  return (await db.favorites.get(vodId)) != null
}

export async function getHistory(vodId: number): Promise<HistoryRecord | null> {
  return (await db.history.get(vodId)) ?? null
}

export async function toggleFavorite(vod: Vod): Promise<void> {
  const existing = await db.favorites.get(vod.id)
  if (existing) {
    await db.favorites.delete(vod.id)
  } else {
    await db.favorites.put({
      vodId: vod.id,
      name: vod.name,
      poster: vod.poster,
      remarks: vod.remarks,
      meta: [vod.year, vod.area, vod.categoryName].filter(Boolean).join(' · '),
      addedAt: Date.now(),
    })
  }
}

export async function removeFavorite(vodId: number): Promise<void> {
  await db.favorites.delete(vodId)
}

export async function removeHistory(vodId: number): Promise<void> {
  await db.transaction('rw', db.history, db.episodeHistory, async () => {
    await db.history.delete(vodId)
    await db.episodeHistory.where('vodId').equals(vodId).delete()
  })
}

export async function clearHistory(): Promise<void> {
  await db.transaction('rw', db.history, db.episodeHistory, async () => {
    await db.history.clear()
    await db.episodeHistory.clear()
  })
}

export async function watchedEpisodes(vodId: number): Promise<EpisodeHistoryRecord[]> {
  return db.episodeHistory.where('vodId').equals(vodId).toArray()
}

/**
 * 记录播放进度：同一部片只留一条「看到哪了」，同时按集累积一份「哪几集看过」。
 * 写入是幂等 upsert，播放器每隔 5 秒调用一次。
 */
export async function saveProgress(input: {
  vod: Vod
  sourceIndex: number
  sourceName: string
  episodeIndex: number
  episodeName: string
  positionMs: number
  durationMs: number
}): Promise<void> {
  const now = Date.now()
  const record: HistoryRecord = {
    vodId: input.vod.id,
    name: input.vod.name,
    poster: input.vod.poster,
    remarks: input.vod.remarks,
    sourceIndex: input.sourceIndex,
    sourceName: input.sourceName,
    episodeIndex: input.episodeIndex,
    episodeName: input.episodeName,
    positionMs: Math.max(0, Math.round(input.positionMs)),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    updatedAt: now,
  }
  await db.transaction('rw', db.history, db.episodeHistory, async () => {
    await db.history.put(record)
    await db.episodeHistory.put({
      vodId: input.vod.id,
      sourceIndex: input.sourceIndex,
      episodeIndex: input.episodeIndex,
      positionMs: record.positionMs,
      durationMs: record.durationMs,
      updatedAt: now,
    })
  })
}

/** 历史只留最近 200 部，避免长年使用后无限膨胀。 */
export async function trimHistory(): Promise<void> {
  const rows = await db.history.orderBy('updatedAt').reverse().toArray()
  if (rows.length <= HISTORY_LIMIT) return
  const drop = rows.slice(HISTORY_LIMIT)
  await db.history.bulkDelete(drop.map((r) => r.vodId))
  const keepIds = new Set(rows.slice(0, HISTORY_LIMIT).map((r) => r.vodId))
  const episodes = await db.episodeHistory.toArray()
  await db.episodeHistory.bulkDelete(
    episodes
      .filter((e) => !keepIds.has(e.vodId))
      .map((e) => [e.vodId, e.sourceIndex, e.episodeIndex] as [number, number, number]),
  )
}

export function historyProgress(record: HistoryRecord): number {
  return progressOf(record)
}

// ─────────────────────────── 热门搜索 ───────────────────────────

const HOT_SOURCES = ['/vodshow/1--hits---------.html', '/vodshow/2--hits---------.html']

/**
 * 热门搜索词：首选站点「按人气排序」的 HTML 页（API 的 by=hits 实测无效），
 * 模板对不上时退化为 API 最近更新的片名——至少都是真实存在、搜得到的词。
 */
export async function hotWords(limit = 10): Promise<string[]> {
  const perSource = Math.ceil(limit / HOT_SOURCES.length)
  const words: string[] = []
  for (const path of HOT_SOURCES) {
    if (words.length >= limit) break
    try {
      const page = await fetchFilterList(path)
      page.items
        .map((v) => v.name.trim())
        .filter(Boolean)
        .slice(0, perSource)
        .forEach((w) => {
          if (!words.includes(w) && words.length < limit) words.push(w)
        })
    } catch {
      /* 单个来源失败不影响另一个 */
    }
  }
  if (words.length > 0) return words.slice(0, limit)
  try {
    const response = await request({ ac: 'detail', pg: 1, pagesize: limit }, (body) =>
      JSON.parse(body) as VodResponse,
    )
    return (response.list ?? [])
      .map((v) => cleanText(v.vod_name))
      .filter(Boolean)
      .slice(0, limit)
  } catch {
    return []
  }
}

// ─────────────────────────── 二级筛选（HTML） ───────────────────────────

export interface FilterOption {
  name: string
  url: string
}

export interface FilterGroup {
  label: string
  options: FilterOption[]
}

export interface FilterPage {
  items: Vod[]
  nextUrl: string | null
  total: number
  hasMore: boolean
}

const TTL_DICT = 24 * 3600_000
const TTL_FILTER_LIST = 10 * 60_000

function absolutePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('//')) return 'https:' + path
  const base = normalizeBaseUrl(getSettings().baseUrl).replace(/\/$/, '')
  return path.startsWith('/') ? base + path : `${base}/${path}`
}

async function loadHtmlCached(path: string, key: string | null, ttlMs: number, force = false) {
  if (key && !force) {
    const entry = await readCache(key).catch(() => null)
    if (entry && Date.now() - entry.savedAt < ttlMs) return entry.json
  }
  const html = await fetchHtml(absolutePath(path))
  if (key) await writeCache(key, html).catch(() => undefined)
  return html
}

function parseFilterGroups(html: string, typeId: number): FilterGroup[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const screen = doc.querySelector('.stui-screen')
  if (!screen) return []
  const groups: FilterGroup[] = []
  screen.querySelectorAll('ul.clearfix').forEach((ul) => {
    const anchors = Array.from(ul.querySelectorAll<HTMLAnchorElement>('a[href*="/vodshow/"]'))
    const rawOptions = anchors
      .map((a) => ({ name: cleanText(a.textContent), url: a.getAttribute('href') || '' }))
      .filter((o) => o.name && o.url.startsWith('/vodshow/'))
    const options = rawOptions.filter((o, i) => rawOptions.findIndex((x) => x.name === o.name) === i)
    if (options.length < 2) return
    const labelRaw = cleanText(ul.querySelector('span')?.textContent)
    if (!labelRaw) return
    const label = labelRaw.replace(/^按/, '').replace(/[：: ]+$/, '')
    if (!label) return
    groups.push({
      label: label === '剧情' || label === '分类' ? '类型' : label,
      options: options.some((o) => o.name === '全部')
        ? options
        : [{ name: '全部', url: `/vodshow/${typeId}-----------.html` }, ...options],
    })
  })
  return groups
}

export async function fetchFilterGroups(typeId: number, force = false): Promise<FilterGroup[]> {
  try {
    const html = await loadHtmlCached(`/type/${typeId}.html`, `filter:dict:${typeId}`, TTL_DICT, force)
    return parseFilterGroups(html, typeId)
  } catch (e) {
    // API-only 源没有 HTML 筛选页（404），属正常情况，静默返回空
    console.warn('[filter] 筛选项解析失败:', (e as Error).message)
    return []
  }
}

function parseFilterItems(html: string): Vod[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: Vod[] = []
  doc.querySelectorAll('.stui-vodlist__box').forEach((box) => {
    const anchor = box.querySelector<HTMLAnchorElement>('a.stui-vodlist__thumb')
    const href = anchor?.getAttribute('href') || ''
    const idMatch = /\/chi\/(\d+)\.html/.exec(href)
    if (!anchor || !idMatch) return
    const name = cleanText(anchor.getAttribute('title')) || cleanText(box.querySelector('h3 a')?.textContent)
    if (!name) return
    const img = box.querySelector<HTMLImageElement>('img')
    const poster = img?.getAttribute('data-original') || img?.getAttribute('src') || ''
    out.push({
      id: Number(idMatch[1]),
      name,
      poster: poster ? absolutePath(poster) : '',
      remarks: cleanText(box.querySelector('.pic-text b')?.textContent),
      year: '',
      area: '',
      language: '',
      categoryName: cleanText(box.querySelector('.pic-text1 b')?.textContent),
      tags: [],
      actors: [],
      director: '',
      score: null,
      summary: '',
      updatedAt: '',
      totalEpisodes: 0,
      playFrom: '',
      playUrls: '',
    })
  })
  return out
}

function parseNext(html: string, current: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const next = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (a) => a.textContent?.trim() === '下一页',
  )
  const href = next?.getAttribute('href')
  if (!href) return null
  const abs = absolutePath(href)
  if (abs === current) return null
  const mark = /class="active num"[^>]*>\s*<a[^>]*>\s*(\d+)\s*\/\s*(\d+)/.exec(html)
  if (mark) {
    const page = Number(mark[1])
    const total = Number(mark[2])
    if (total >= 1 && page >= total) return null
  }
  return abs
}

function parseTotal(html: string): number {
  const m = /共检索到\s*[“"']?(\d+)/.exec(html)
  return m ? Number(m[1]) : 0
}

/** 拉一页 HTML 筛选结果；url 可以是站内相对地址或完整地址。 */
export async function fetchFilterList(url: string, force = false): Promise<FilterPage> {
  const abs = absolutePath(url)
  const html = await loadHtmlCached(abs, `filter:list:${hashCode(abs)}`, TTL_FILTER_LIST, force)
  const items = parseFilterItems(html)
  const nextUrl = parseNext(html, abs)
  return { items, nextUrl, total: parseTotal(html), hasMore: nextUrl != null }
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/** 把多组选中项合并成一个筛选地址（站点地址形如 /vodshow/{type}-{area}-{sort}-...html）。 */
export function buildFilterUrl(selection: Record<string, string>, groups: FilterGroup[]): string | null {
  const segments: string[][] = []
  for (const [label, name] of Object.entries(selection)) {
    const option = groups.find((g) => g.label === label)?.options.find((o) => o.name === name)
    if (!option) continue
    const core = option.url.split('/vodshow/')[1]?.split('.html')[0]
    if (core) segments.push(core.split('-'))
  }
  if (segments.length === 0) return null
  const size = Math.max(...segments.map((s) => s.length))
  const merged: string[] = []
  for (let i = 0; i < size; i++) {
    merged.push(segments.find((s) => s[i])?.[i] ?? '')
  }
  return '/vodshow/' + merged.join('-') + '.html'
}

// ─────────────────────────── 播放线路 ───────────────────────────

export async function preferredSourceIndex(
  vod: Vod,
  historySource?: number | null,
): Promise<number> {
  const sources = parsePlaySources(vod.playFrom, vod.playUrls)
  if (sources.length === 0) return 0
  if (historySource != null && historySource >= 0 && historySource < sources.length) return historySource
  const firstPlayable = sources.findIndex((s) => !s.webOnly)
  return firstPlayable >= 0 ? firstPlayable : 0
}
