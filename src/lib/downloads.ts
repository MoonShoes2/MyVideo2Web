import { db } from './db'
import { fetchPlaylistText, hlsUrl, segUrl } from './api'
import { getSettings } from './settings'
import { sizeText } from './parse'
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

type Listener = () => void
const listeners = new Set<Listener>()
const active = new Map<string, AbortController>()
const paused = new Set<string>()

function emit() {
  listeners.forEach((fn) => fn())
}

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

/** 单集空间预估：网页端无法预知码率，按 300MB 一集留余量。 */
const ESTIMATED_EPISODE_BYTES = 700 * 1024 * 1024

export async function spaceWarning(count: number): Promise<string | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    const free = Math.max(0, quota - usage)
    const need = ESTIMATED_EPISODE_BYTES * count
    if (free < need) {
      return `浏览器可用空间不足（剩余约 ${sizeText(free)}，需要约 ${sizeText(need)}），请清理后再试`
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
      segmentUrls: [],
      createdAt: now,
      updatedAt: now,
    }
    await db.downloads.put(task)
  }
  emit()
  runQueue()
}

let pumping = false

async function runQueue() {
  if (pumping) return
  pumping = true
  try {
    while (true) {
      const next = await db.downloads.where('state').equals('queued').first()
      if (!next) break
      await downloadOne(next.id)
    }
  } finally {
    pumping = false
  }
}

/** 下载一集：拉播放列表 → 下钻 master → 逐分片写缓存。 */
async function downloadOne(id: string) {
  const task = await db.downloads.get(id)
  if (!task || task.state === 'completed') return
  const settings = getSettings()
  if (settings.wifiOnly && onCellular()) {
    await patch(id, { state: 'paused', error: '仅 Wi-Fi 下载已开启，当前为移动网络' })
    return
  }

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
        await patch(id, {
          doneSegments: done,
          bytes,
          progress: Math.min(0.99, done / segments.length),
        })
      }
    }

    await Promise.all(Array.from({ length: SEGMENT_CONCURRENCY }, worker)).catch((e) => {
      failure.error = e as Error
    })
    if (failure.error) throw failure.error

    await patch(id, { state: 'completed', progress: 1, doneSegments: segments.length, error: undefined })
    // 让浏览器尽量别把刚下的东西清掉
    navigator.storage?.persist?.().catch(() => undefined)
  } catch (e) {
    if (paused.has(id) || (e as Error).name === 'AbortError') {
      await patch(id, { state: 'paused' })
    } else {
      await patch(id, { state: 'failed', error: (e as Error).message || '下载失败' })
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
  await patch(id, { state: 'queued', error: undefined })
  runQueue()
}

export async function remove(id: string) {
  paused.add(id)
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
