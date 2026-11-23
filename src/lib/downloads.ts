import { db } from './db'
import { fetchPlaylistText, hlsUrl, segUrl } from './api'
import { fetchDetail } from './repo'
import { getSettings } from './settings'
import { parsePlaySources, sizeText } from './parse'
import type { DownloadTask, Episode, Vod } from './types'

/**
 * 离线下载（浏览器版）。
 *
 * 没有 Media3 DownloadManager，等价物是 **Cache Storage + Service Worker**：
 *  - 下载时把播放列表与每个分片按「同源代理地址」存进 `zy-media-v1`；
 *  - 播放时 hls.js 依旧请求 /api/hls 与 /api/seg，Service Worker 直接命中缓存；
 *  - 于是断网也能播，且不用改动播放层一行代码。
 *
 * 任务本身存在 IndexedDB（downloads 表），刷新页面后队列还在。
 */
const CACHE_NAME = 'zy-media-v1'
const SEGMENT_CONCURRENCY = 4
/** 原生同时下 2 集：再多会摊薄单集速度。 */
const MAX_PARALLEL_EPISODES = 2
const MAX_RETRY = 3

type Listener = () => void
const listeners = new Set<Listener>()
const active = new Map<string, AbortController>()
const paused = new Set<string>()
/** 仅 Wi-Fi 下被挡住的任务：留在队列里等网络恢复，而不是直接置为已暂停。 */
const waitingWifi = new Set<string>()
let runningEpisodes = 0

function emit() {
  listeners.forEach((fn) => fn())
}

/** 回到 Wi-Fi 后自动把等待中的任务放回队列。 */
;(navigator as unknown as { connection?: EventTarget }).connection?.addEventListener?.('change', () => {
  if (onCellular() || waitingWifi.size === 0) return
  waitingWifi.forEach((id) => {
    void db.downloads.update(id, { error: undefined, updatedAt: Date.now() })
  })
  waitingWifi.clear()
  void runQueue()
})

export function subscribeDownloads(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function listDownloads(): Promise<DownloadTask[]> {
  return db.downloads.orderBy('createdAt').reverse().toArray()
}

async function patch(id: string, changes: Partial<DownloadTask>) {
  await db.downloads.update(id, { ...changes, updatedAt: Date.now() })
  emit()
}

export function taskId(vodId: number, sourceIndex: number, episodeIndex: number): string {
  return `${vodId}-${sourceIndex}-${episodeIndex}`
}

/** 网页端拿不到真实网卡类型，用 Network Information API 尽力判断；不支持就当 Wi-Fi。 */
function onCellular(): boolean {
  const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection
  if (!conn) return false
  if (conn.type) return conn.type === 'cellular'
  return conn.effectiveType === '2g' || conn.effectiveType === '3g'
}

/** 与原生 DetailViewModel 一致：单集预留 350MB。 */
const ESTIMATED_EPISODE_BYTES = 350 * 1024 * 1024
/** 原生 LOW_SPACE_BYTES = 1GB：低于这个值直接拦，低于需求 0.8 倍只提醒。 */
const LOW_SPACE_BYTES = 1024 * 1024 * 1024

export async function spaceWarning(count: number): Promise<string | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    const free = Math.max(0, quota - usage)
    const need = ESTIMATED_EPISODE_BYTES * count
    if (free < LOW_SPACE_BYTES) {
      return '剩余空间不足 1GB，下载可能失败，请先清理浏览器缓存'
    }
    if (free < need * 0.8) {
      return `预计需要 ${sizeText(need)}，当前剩余 ${sizeText(free)}，空间可能不足，请留意`
    }
  } catch {
    /* 估算失败就不拦 */
  }
  return null
}

/** 队列入口：去重后逐集入队并立即开跑。 */
export async function enqueue(
  vod: Vod,
  sourceIndex: number,
  sourceName: string,
  episodes: Episode[],
): Promise<void> {
  const now = Date.now()
  for (const episode of episodes) {
    const id = taskId(vod.id, sourceIndex, episode.index)
    const existing = await db.downloads.get(id)
    if (existing && (existing.state === 'completed' || existing.state === 'downloading')) continue
    const task: DownloadTask = {
      id,
      vodId: vod.id,
      vodName: vod.name,
      poster: vod.poster,
      remarks: vod.remarks,
      sourceIndex,
      sourceName,
      episodeIndex: episode.index,
      episodeName: episode.name,
      url: episode.url,
      state: 'queued',
      progress: 0,
      doneSegments: 0,
      totalSegments: 0,
      bytes: 0,
      speedBytesPerSecond: 0,
      attempts: 0,
      rebuilt: false,
      segmentUrls: [],
      createdAt: now,
      updatedAt: now,
    }
    await db.downloads.put(task)
  }
  emit()
  void runQueue()
}

let pumping = false

/** 最多同时跑 2 集；领任务时先把状态写成 downloading，避免并发重复领同一个。 */
async function runQueue() {
  if (pumping) return
  pumping = true
  try {
    while (runningEpisodes < MAX_PARALLEL_EPISODES) {
      const queued = await db.downloads.where('state').equals('queued').toArray()
      const next = queued.find((t) => !waitingWifi.has(t.id))
      if (!next) break
      if (paused.has(next.id)) {
        await patch(next.id, { state: 'paused' })
        continue
      }
      await db.downloads.update(next.id, { state: 'downloading', updatedAt: Date.now() })
      runningEpisodes++
      void downloadOne(next.id).finally(() => {
        runningEpisodes--
        void runQueue()
      })
    }
  } finally {
    pumping = false
  }
}

/** 地址带时效签名：失败时用最新详情重新解析这一集，每集最多重建一次。 */
async function rebuildDownloadUrl(task: DownloadTask): Promise<string | null> {
  try {
    const detail = await fetchDetail(task.vodId, true)
    const sources = parsePlaySources(detail.playFrom, detail.playUrls)
    const source = sources[task.sourceIndex]
    const episode = source?.episodes[task.episodeIndex]
    if (!source || source.webOnly || !episode) return null
    return episode.url === task.url ? null : episode.url
  } catch {
    return null
  }
}

/** 下载一集：拉播放列表 → 下钻 master → 逐分片写缓存。 */
async function downloadOne(id: string) {
  const task = await db.downloads.get(id)
  if (!task || task.state === 'completed') return
  const settings = getSettings()
  if (settings.wifiOnly && onCellular()) {
    // 留在队列里等 Wi-Fi，而不是直接暂停——对齐原生「非 Wi-Fi 下排队等待」
    waitingWifi.add(id)
    await patch(id, { state: 'queued', error: '等待 Wi-Fi 网络' })
    return
  }
  waitingWifi.delete(id)

  const controller = new AbortController()
  active.set(id, controller)
  paused.delete(id)
  await patch(id, { state: 'downloading', error: undefined })

  try {
    const cache = await caches.open(CACHE_NAME)
    const playlistUrl = hlsUrl(task.url)
    let text = await fetchPlaylistText(task.url)
    const masterText = text
    let mediaUrl = playlistUrl

    // master 列表：先取第一条子线路，真正要缓存的是媒体列表
    if (text.split(/\r?\n/).some((l) => l.trim().startsWith('#EXT-X-STREAM-INF'))) {
      const lines = text.split(/\r?\n/).map((l) => l.trim())
      const at = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'))
      const child = lines.slice(at + 1).find((l) => l && !l.startsWith('#'))
      if (!child) throw new Error('播放列表没有可用的子线路')
      mediaUrl = child.startsWith('/api/') ? child : hlsUrl(child)
      // 代理已经把子线路改写成 /api/hls?u=...：直接请求，别再套一层代理地址
      text = child.startsWith('/api/')
        ? await (await fetch(mediaUrl)).text()
        : await fetchPlaylistText(child)
    }

    const segments = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => (l.startsWith('/api/') ? l : segUrl(l)))

    if (segments.length === 0) throw new Error('播放列表里没有分片，无法离线缓存')

    await patch(id, { totalSegments: segments.length, segmentUrls: segments, progress: 0 })

    // 播放列表也进缓存：离线时 hls.js 第一步要读 master、第二步读媒体列表，两层都得留
    const masterReq = new Request(playlistUrl)
    if (masterText !== text && !(await cache.match(masterReq))) {
      await cache.put(
        masterReq,
        new Response(masterText, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }),
      )
    }
    const playlistReq = new Request(mediaUrl)
    if (!(await cache.match(playlistReq))) {
      await cache.put(
        playlistReq,
        new Response(text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }),
      )
    }

    let done = 0
    let bytes = task.bytes
    let lastBytes = bytes
    let lastAt = Date.now()
    const queue = [...segments]
    const failure: { error: Error | null } = { error: null }

    const worker = async () => {
      while (queue.length > 0 && !failure.error) {
        if (paused.has(id)) throw new DOMException('paused', 'AbortError')
        const url = queue.shift()!
        const req = new Request(url)
        const hit = await cache.match(req)
        if (hit) {
          done++
          await patch(id, { doneSegments: done, progress: done / segments.length })
          continue
        }
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`分片下载失败（HTTP ${res.status}）`)
        const buf = await res.arrayBuffer()
        await cache.put(
          req,
          new Response(buf, {
            headers: {
              'Content-Type': res.headers.get('content-type') || 'video/mp2t',
              'Content-Length': String(buf.byteLength),
            },
          }),
        )
        bytes += buf.byteLength
        done++
        const now = Date.now()
        const elapsed = (now - lastAt) / 1000
        const speed =
          elapsed >= 0.5 ? Math.round((bytes - lastBytes) / elapsed) : task.speedBytesPerSecond ?? 0
        if (elapsed >= 0.5) {
          lastBytes = bytes
          lastAt = now
        }
        await patch(id, {
          doneSegments: done,
          bytes,
          speedBytesPerSecond: speed,
          progress: Math.min(0.99, done / segments.length),
        })
      }
    }

    await Promise.all(Array.from({ length: SEGMENT_CONCURRENCY }, worker)).catch((e) => {
      failure.error = e as Error
    })
    if (failure.error) throw failure.error

    await patch(id, {
      state: 'completed',
      progress: 1,
      doneSegments: segments.length,
      speedBytesPerSecond: 0,
      error: undefined,
    })
    // 让浏览器尽量别把刚下的东西清掉
    navigator.storage?.persist?.().catch(() => undefined)
  } catch (e) {
    if (paused.has(id) || (e as Error).name === 'AbortError') {
      await patch(id, { state: 'paused' })
    } else {
      const attempts = (task.attempts ?? 0) + 1
      let rebuilt = task.rebuilt ?? false
      let url = task.url
      // 第一次失败先尝试重建过期地址，之后按次数重试
      if (!rebuilt && attempts <= MAX_RETRY) {
        const fresh = await rebuildDownloadUrl(task)
        if (fresh) {
          url = fresh
          rebuilt = true
        }
      }
      if (attempts <= MAX_RETRY) {
        await patch(id, {
          state: 'queued',
          attempts,
          rebuilt,
          url,
          segmentUrls: [],
          bytes: 0,
          doneSegments: 0,
          progress: 0,
          speedBytesPerSecond: 0,
          error: `下载失败，正在重试（${attempts - 1}/${MAX_RETRY}）`,
        })
        window.setTimeout(() => void runQueue(), 1500 * attempts)
      } else {
        await patch(id, { state: 'failed', attempts, error: (e as Error).message || '下载失败' })
      }
    }
  } finally {
    active.delete(id)
    emit()
  }
}

export async function pause(id: string) {
  paused.add(id)
  active.get(id)?.abort()
  await patch(id, { state: 'paused' })
}

export async function resume(id: string) {
  paused.delete(id)
  waitingWifi.delete(id)
  await patch(id, { state: 'queued', error: undefined })
  void runQueue()
}

/** 失败后手动重试：次数归零，重新排队。 */
export async function retryDownload(id: string) {
  paused.delete(id)
  waitingWifi.delete(id)
  await patch(id, {
    state: 'queued',
    attempts: 0,
    error: undefined,
    progress: 0,
    doneSegments: 0,
    bytes: 0,
    speedBytesPerSecond: 0,
  })
  void runQueue()
}

export async function pauseAll(ids: string[]) {
  for (const id of ids) await pause(id)
}

export async function resumeAll(ids: string[]) {
  for (const id of ids) await resume(id)
}

export async function remove(id: string) {
  paused.add(id)
  waitingWifi.delete(id)
  active.get(id)?.abort()
  const task = await db.downloads.get(id)
  if (task && 'caches' in window) {
    const cache = await caches.open(CACHE_NAME)
    for (const url of task.segmentUrls) await cache.delete(url).catch(() => undefined)
  }
  await db.downloads.delete(id)
  emit()
}

export async function clearCompleted(): Promise<void> {
  const done = await db.downloads.where('state').equals('completed').toArray()
  for (const task of done) await remove(task.id)
}

/** 对应原生「清空全部下载」：连未完成的任务一起清掉。 */
export async function clearAllDownloads(): Promise<void> {
  const all = await db.downloads.toArray()
  for (const task of all) await remove(task.id)
}

export async function isEpisodeDownloaded(url: string): Promise<boolean> {
  const all = await db.downloads.where('state').equals('completed').toArray()
  return all.some((t) => t.url === url)
}

/** 已完成任务的集号集合（按线路分组），详情页/播放页打「已下载」角标用。 */
export async function downloadedBySource(vodId: number): Promise<Record<number, number[]>> {
  const rows = await db.downloads
    .where('vodId')
    .equals(vodId)
    .filter((t) => t.state === 'completed')
    .toArray()
  const out: Record<number, number[]> = {}
  rows.forEach((t) => {
    out[t.sourceIndex] = [...(out[t.sourceIndex] ?? []), t.episodeIndex]
  })
  return out
}

/**
 * 断网兜底：用已下载的集拼一个「离线影片」，播放页拿它照常开播。
 * playUrls 里的地址与下载索引里的 key 一致，Service Worker 才能命中缓存。
 */
export async function offlineVod(vodId: number): Promise<Vod | null> {
  const rows = await db.downloads
    .where('vodId')
    .equals(vodId)
    .filter((t) => t.state === 'completed')
    .sortBy('episodeIndex')
  if (rows.length === 0) return null
  const first = rows[0]
  return {
    id: vodId,
    name: first.vodName,
    poster: first.poster,
    remarks: first.remarks,
    year: '',
    area: '',
    language: '',
    categoryName: '',
    tags: [],
    actors: [],
    director: '',
    score: null,
    summary: '',
    updatedAt: '',
    totalEpisodes: rows.length,
    playFrom: 'offline',
    playUrls: rows.map((t) => `${t.episodeName}$${t.url}`).join('#'),
  }
}

/** 页面刷新/关闭会中断正在跑的下载：把残留的「下载中」改回「已暂停」，让用户能手动继续。 */
export async function recoverDownloads(): Promise<void> {
  const rows = await db.downloads.where('state').equals('downloading').toArray()
  for (const row of rows) {
    await db.downloads.update(row.id, { state: 'paused', updatedAt: Date.now() })
  }
  if (rows.length > 0) emit()
}

export async function downloadStats(): Promise<{ count: number; bytes: number; active: number }> {
  const all = await db.downloads.toArray()
  return {
    count: all.filter((t) => t.state === 'completed').length,
    bytes: all.reduce((sum, t) => sum + t.bytes, 0),
    active: all.filter((t) => t.state === 'downloading' || t.state === 'queued').length,
  }
}
