import Dexie, { type Table } from 'dexie'
import type {
  DownloadTask,
  EpisodeHistoryRecord,
  FavoriteRecord,
  HistoryRecord,
  PageCacheRecord,
} from './types'

/**
 * 本地库用 IndexedDB：对应原工程的 Room。
 * 表结构与 `data/local/Entities.kt` 保持一致，只是把「时间戳 / 布尔」这类类型换成了 JS 原生。
 */
class ZyDatabase extends Dexie {
  declare favorites: Table<FavoriteRecord, number>
  declare history: Table<HistoryRecord, number>
  declare episodeHistory: Table<EpisodeHistoryRecord, [number, number, number]>
  declare pageCache: Table<PageCacheRecord, string>
  declare downloads: Table<DownloadTask, string>

  constructor() {
    super('zhuiying')
    // 表名必须与上面的属性名一致：Dexie 按 store 名挂属性，episode_history 不会变成 episodeHistory
    this.version(1).stores({
      favorites: 'vodId, addedAt',
      history: 'vodId, updatedAt',
      episodeHistory: '[vodId+sourceIndex+episodeIndex], vodId, updatedAt',
      pageCache: 'key, savedAt',
      downloads: 'id, vodId, state, createdAt, [vodId+sourceIndex+episodeIndex]',
    })
  }
}

export const db = new ZyDatabase()

/**
 * 页面缓存 LRU：对应原生 CacheStore 的 300 条 / 15MB / 3 天上限。
 * 每次写入后与启动时各跑一次，避免长年使用后无限膨胀。
 */
export async function prunePageCache(
  maxAgeMs = 3 * 24 * 3600_000,
  maxRows = 300,
  maxBytes = 15 * 1024 * 1024,
) {
  const before = Date.now() - maxAgeMs
  await db.pageCache.where('savedAt').below(before).delete()

  let rows = await db.pageCache.orderBy('savedAt').toArray()
  if (rows.length > maxRows) {
    await db.pageCache.bulkDelete(rows.slice(0, rows.length - maxRows).map((r) => r.key))
    rows = rows.slice(rows.length - maxRows)
  }

  let total = rows.reduce((sum, row) => sum + (row.json?.length ?? 0), 0)
  const drop: string[] = []
  for (const row of rows) {
    if (total <= maxBytes) break
    drop.push(row.key)
    total -= row.json?.length ?? 0
  }
  if (drop.length > 0) await db.pageCache.bulkDelete(drop)
}
