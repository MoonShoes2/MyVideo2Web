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

/** 首次打开时清一次过期页面缓存：原工程由 Room 自己管，这里手动扫一遍。 */
export async function prunePageCache(maxAgeMs = 3 * 24 * 3600_000) {
  const before = Date.now() - maxAgeMs
  await db.pageCache.where('savedAt').below(before).delete()
}
