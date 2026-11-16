/** 领域模型：与原工程 data/model/Models.kt 一一对应。 */

export interface Category {
  id: number
  name: string
  parentId: number
}

export interface Vod {
  id: number
  name: string
  poster: string
  remarks: string
  year: string
  area: string
  language: string
  categoryName: string
  tags: string[]
  actors: string[]
  director: string
  score: string | null
  summary: string
  updatedAt: string
  totalEpisodes: number
  playFrom: string
  playUrls: string
}

export interface VodPage {
  items: Vod[]
  page: number
  hasMore: boolean
  total: number
}

export interface Episode {
  name: string
  url: string
  index: number
}

export interface PlaySource {
  name: string
  episodes: Episode[]
  webOnly: boolean
}

/** 原始接口 DTO：字段全给默认值，脏数据不炸整页。 */
export interface VodDto {
  vod_id?: number | string | null
  vod_name?: string | null
  vod_pic?: string | null
  vod_remarks?: string | null
  vod_year?: string | null
  vod_area?: string | null
  vod_lang?: string | null
  vod_class?: string | null
  vod_actor?: string | null
  vod_director?: string | null
  vod_score?: string | null
  vod_content?: string | null
  vod_blurb?: string | null
  vod_time?: string | null
  vod_total?: number | string | null
  vod_play_from?: string | null
  vod_play_url?: string | null
  type_name?: string | null
}

export interface ClassDto {
  type_id?: number | string | null
  type_pid?: number | string | null
  type_name?: string | null
}

export interface VodResponse {
  code?: number | string | null
  msg?: string | null
  page?: number | string | null
  pagecount?: number | string | null
  total?: number | string | null
  list?: VodDto[] | null
  class?: ClassDto[] | null
}

/** 本地片库：收藏 / 观看历史 / 逐集记录。 */
export interface FavoriteRecord {
  vodId: number
  name: string
  poster: string
  remarks: string
  meta: string
  addedAt: number
}

export interface HistoryRecord {
  vodId: number
  name: string
  poster: string
  remarks: string
  sourceIndex: number
  sourceName: string
  episodeIndex: number
  episodeName: string
  positionMs: number
  durationMs: number
  updatedAt: number
}

export interface EpisodeHistoryRecord {
  vodId: number
  sourceIndex: number
  episodeIndex: number
  positionMs: number
  durationMs: number
  updatedAt: number
}

export interface PageCacheRecord {
  key: string
  json: string
  savedAt: number
}

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'

export interface DownloadTask {
  id: string
  vodId: number
  vodName: string
  poster: string
  remarks: string
  sourceIndex: number
  sourceName: string
  episodeIndex: number
  episodeName: string
  url: string
  state: DownloadState
  /** 0..1；完成即 1。 */
  progress: number
  doneSegments: number
  totalSegments: number
  bytes: number
  /** 已缓存的分片地址（同源代理地址），删除时按它清 Cache Storage。 */
  segmentUrls: string[]
  error?: string
  createdAt: number
  updatedAt: number
}

export const HISTORY_LIMIT = 200
