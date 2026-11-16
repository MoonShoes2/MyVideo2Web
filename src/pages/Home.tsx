import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { cachedPage, fetchPage } from '../lib/repo'
import { updateTimeLabel, metaLine } from '../lib/parse'
import type { Vod } from '../lib/types'
import { useVodPager, nearBottom } from '../lib/usePager'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { imgUrl } from '../lib/api'
import { Icon } from '../components/icons'
import {
  BackToTopButton,
  continueHint,
  EmptyBox,
  ErrorBox,
  LoadingBox,
  Poster,
  TabHeader,
} from '../components/common'

export default function Home() {
  const navigate = useNavigate()
  const pager = useVodPager((page, force) => fetchPage(page, null, null, 12, force))
  const history = useLiveQuery(() => db.history.orderBy('updatedAt').reverse().limit(10).toArray(), []) ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [showTop, setShowTop] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await pager.refresh(true, true)
    setRefreshing(false)
  }, [pager])

  // 冷启动先铺上次的「最近更新」，网络回来再原地换新——采集站首屏常有 2s+ 白屏
  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await cachedPage().catch(() => null)
      if (alive && cached && cached.page.items.length > 0) pager.showFirstPage(cached.page)
      await pager.refresh(false, true).catch(() => undefined)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  usePullToRefresh(scrollRef, refresh, setPull)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setShowTop(el.scrollTop > 600)
    if (nearBottom(el, 700)) pager.loadNext()
  }

  const items = pager.items

  return (
    <div className="flex h-full flex-col">
      <TabHeader title="追影">
        <button
          onClick={() => navigate('/search')}
          className="tap ml-3 flex h-[38px] flex-1 items-center rounded-full bg-surface-high px-3 text-muted"
        >
          <Icon name="search" size={17} />
          <span className="ml-1.5 truncate text-body-sm">搜影片名</span>
        </button>
        <button
          onClick={refresh}
          aria-label="刷新"
          className="tap ml-1 flex h-9 w-9 items-center justify-center text-muted"
        >
          <Icon name="refresh" size={19} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </TabHeader>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain no-scrollbar"
        >
          <div
            className="overflow-hidden text-center text-label-sm text-muted transition-[height]"
            style={{ height: refreshing ? 28 : pull }}
          >
            <span className="inline-flex items-center gap-1.5 pt-2">
              {refreshing ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  正在刷新…
                </>
              ) : pull >= 56 ? (
                '松开刷新'
              ) : pull > 0 ? (
                '下拉刷新'
              ) : null}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-[9px] gap-y-3 px-4 pb-7">
            {history.length > 0 && (
              <>
                <div className="col-span-2 pt-1">
                  <SectionRow title="继续观看" action="全部" onAction={() => navigate('/history')} />
                </div>
                <div className="col-span-2 -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 no-scrollbar">
                  {history.map((record) => (
                    <button
                      key={record.vodId}
                      onClick={() => navigate(`/player/${record.vodId}`)}
                      className="tap w-[104px] shrink-0 text-left"
                    >
                      <div className="relative">
                        <Poster url={record.poster} name={record.name} className="w-full" />
                        <div className="absolute bottom-0 left-0 h-[3px] w-full bg-white/30">
                          <div
                            className="h-full bg-brand"
                            style={{
                              width: `${Math.min(
                                1,
                                record.durationMs > 0 ? record.positionMs / record.durationMs : 0,
                              ) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <p className="mt-1.5 truncate text-title-sm text-ink">{record.name}</p>
                      <p className="truncate text-label-sm text-muted">
                        {continueHint(record.episodeName, record.episodeIndex, record.positionMs)}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="col-span-2 pt-1">
              <SectionRow title="最近更新" />
            </div>

            {items.length === 0 ? (
              <div className="col-span-2 h-[240px]">
                {pager.error ? (
                  <ErrorBox message={pager.error} onRetry={() => pager.refresh()} />
                ) : pager.loading || pager.loadedPage === 0 ? (
                  <LoadingBox />
                ) : (
                  <EmptyBox text="暂时没有内容" />
                )}
              </div>
            ) : (
              <>
                {items.map((vod) => (
                  <FeedCard key={vod.id} vod={vod} onClick={() => navigate(`/detail/${vod.id}`)} />
                ))}
                <div className="col-span-2">
                  <FeedFooter
                    loading={pager.loadingMore}
                    error={pager.error}
                    endReached={pager.endReached}
                    onRetry={() => pager.loadNext()}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {showTop && (
          <BackToTopButton onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
        )}
      </div>
    </div>
  )
}

function SectionRow({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center pb-0.5 pt-1">
      <span className="h-[15px] w-[3px] rounded-sm hero-gradient" />
      <span className="ml-2 flex-1 text-title-md text-ink">{title}</span>
      {action && onAction && (
        <button onClick={onAction} className="tap text-label-md text-muted">
          {action} ›
        </button>
      )}
    </div>
  )
}

function FeedCard({ vod, onClick }: { vod: Vod; onClick: () => void }) {
  const meta = metaLine(vod)
  return (
    <button onClick={onClick} className="tap text-left">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-placeholder">
        {vod.poster && (
          <img
            src={imgUrl(vod.poster)}
            alt={vod.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        {vod.remarks && (
          <span className="absolute bottom-1.5 right-1.5 max-w-[calc(100%-12px)] truncate rounded bg-black/55 px-1.5 py-px text-label-sm text-white">
            {vod.remarks}
          </span>
        )}
        {vod.score && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-px text-label-sm text-gold">
            {vod.score}
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-title-sm text-ink">{vod.name}</p>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-label-sm text-muted">{meta}</span>
        <span className="shrink-0 text-label-sm text-brand">{updateTimeLabel(vod.updatedAt)}</span>
      </div>
    </button>
  )
}

function FeedFooter({
  loading,
  error,
  endReached,
  onRetry,
}: {
  loading: boolean
  error: string | null
  endReached: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex h-14 items-center justify-center">
      {loading ? (
        <span className="flex items-center gap-2 text-label-md text-muted">
          <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-brand border-t-transparent" />
          正在加载更多…
        </span>
      ) : error ? (
        <button onClick={onRetry} className="tap px-2 py-2 text-label-md text-brand">
          加载失败，点击重试
        </button>
      ) : endReached ? (
        <span className="text-label-md text-muted">没有更多了</span>
      ) : null}
    </div>
  )
}
