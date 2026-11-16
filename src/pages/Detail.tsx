import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { ApiException, imgUrl } from '../lib/api'
import { cachedDetail, fetchDetail, toggleFavorite } from '../lib/repo'
import {
  metaLine,
  parsePlaySources,
  playbackText,
  progressOf,
  sourceDisplayName,
} from '../lib/parse'
import { enqueue, offlineVod, spaceWarning } from '../lib/downloads'
import type { Episode, PlaySource, Vod } from '../lib/types'
import { Icon } from '../components/icons'
import {
  DownloadedBadge,
  EmptyBox,
  ErrorBox,
  LoadingBox,
  Poster,
  PrimaryActionButton,
  ScreenTopBar,
  SectionTitle,
} from '../components/common'
import { PageShell, useGoBack } from '../App'

export default function Detail() {
  const { vodId: vodIdParam } = useParams()
  const vodId = Number(vodIdParam)
  const navigate = useNavigate()
  const goBack = useGoBack()

  const [vod, setVod] = useState<Vod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [showPoster, setShowPoster] = useState(false)
  const [webEpisode, setWebEpisode] = useState<Episode | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  const history = useLiveQuery(() => db.history.get(vodId), [vodId], undefined)
  const favoriteRow = useLiveQuery(() => db.favorites.get(vodId), [vodId], undefined)
  const watchedRows = useLiveQuery(
    () => db.episodeHistory.where('vodId').equals(vodId).toArray(),
    [vodId],
    [],
  )
  const downloadRows = useLiveQuery(
    () => db.downloads.where('vodId').equals(vodId).toArray(),
    [vodId],
    [],
  )

  const sources = useMemo(
    () => (vod ? parsePlaySources(vod.playFrom, vod.playUrls) : []),
    [vod],
  )
  const episodes = sources[sourceIndex]?.episodes ?? []
  const downloaded = useMemo(() => {
    const set = new Set<number>()
    downloadRows
      .filter((d) => d.state === 'completed' && d.sourceIndex === sourceIndex)
      .forEach((d) => set.add(d.episodeIndex))
    return set
  }, [downloadRows, sourceIndex])
  const watched = useMemo(() => {
    const map: Record<number, number> = {}
    watchedRows
      .filter((r) => r.sourceIndex === sourceIndex)
      .forEach((r) => {
        map[r.episodeIndex] = progressOf(r)
      })
    return map
  }, [watchedRows, sourceIndex])

  const applyDetail = (detail: Vod, historySource?: number) => {
    const parsed = parsePlaySources(detail.playFrom, detail.playUrls)
    const preferred =
      historySource != null && historySource >= 0 && historySource < parsed.length
        ? historySource
        : parsed.findIndex((s) => !s.webOnly) >= 0
          ? parsed.findIndex((s) => !s.webOnly)
          : 0
    setSourceIndex(preferred < 0 ? 0 : preferred)
    setVod(detail)
    setLoading(false)
    setError(null)
  }

  useEffect(() => {
    if (!vodId || vodId <= 0) {
      setLoading(false)
      setError('影片信息有误')
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    ;(async () => {
      const cached = await cachedDetail(vodId).catch(() => null)
      if (alive && cached) applyDetail(cached)
      try {
        const detail = await fetchDetail(vodId)
        if (alive) applyDetail(detail)
      } catch (e) {
        if (!alive) return
        if (cached) return
        const offline = await offlineVod(vodId).catch(() => null)
        if (!alive) return
        if (offline) applyDetail(offline)
        else {
          setLoading(false)
          setError(e instanceof ApiException ? e.message : '加载失败，请检查网络后重试')
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vodId, reloadKey])

  // 历史里的线路优先：用户上次在哪条线路看的，就默认停在哪条
  useEffect(() => {
    if (history && sources.length > 0 && history.sourceIndex < sources.length) {
      setSourceIndex(history.sourceIndex)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history?.vodId, sources.length])

  const showToast = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(null), 2200)
  }

  const resumeLabel = (() => {
    if (!history) return null
    if (history.durationMs > 0 && history.positionMs >= (history.durationMs * 95) / 100) return null
    const ep = history.episodeName || `第${history.episodeIndex + 1}集`
    return `继续观看 ${ep} ${playbackText(history.positionMs)}`
  })()

  const play = (source: number, episode: number) => {
    const target = sources[source]
    if (target?.webOnly) {
      setWebEpisode(target.episodes[episode] ?? null)
      return
    }
    navigate(`/player/${vodId}?source=${source}&episode=${episode}`)
  }

  const openDownloadSheet = () => {
    const source = sources[sourceIndex]
    if (!source || source.webOnly) {
      showToast('网页线路不支持下载，请切换其他线路')
      return
    }
    if (source.episodes.length === 0) return
    setSelected(new Set())
    setSheetOpen(true)
  }

  const confirmDownload = async () => {
    if (!vod) return
    const source = sources[sourceIndex]
    const picked = source.episodes.filter((e) => selected.has(e.index))
    if (picked.length === 0) return
    const warning = await spaceWarning(picked.length)
    if (warning) {
      showToast(warning)
      return
    }
    await enqueue(vod, sourceIndex, source.name, picked)
    setSheetOpen(false)
    showToast(`已加入下载队列（${picked.length} 集）`)
  }

  const content = (() => {
    if (loading && !vod) return <LoadingBox />
    if (!vod && error) return <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />
    if (!vod) return <LoadingBox />
    return (
      <DetailContent
        vod={vod}
        sources={sources}
        sourceIndex={sourceIndex}
        episodes={episodes}
        downloaded={downloaded}
        watched={watched}
        historySource={history?.sourceIndex}
        historyEpisode={history?.episodeIndex}
        favorite={favoriteRow != null}
        resumeLabel={resumeLabel}
        onSelectSource={setSourceIndex}
        onPlay={play}
        onContinue={() => navigate(`/player/${vodId}`)}
        onDownload={openDownloadSheet}
        onFavorite={() => toggleFavorite(vod)}
        onPoster={() => setShowPoster(true)}
      />
    )
  })()

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar title={vod?.name || ''} onBack={goBack} />
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{content}</div>
      </div>

      {showPoster && vod && <PosterPreview url={vod.poster} name={vod.name} onClose={() => setShowPoster(false)} />}

      {webEpisode && (
        <Modal onClose={() => setWebEpisode(null)} title={webEpisode.name}>
          <p className="text-body-md text-muted">该线路是网页播放页，应用内无法直接播放。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              onClick={async () => {
                await navigator.clipboard.writeText(webEpisode.url).catch(() => undefined)
                showToast('链接已复制')
                setWebEpisode(null)
              }}
            >
              复制链接
            </button>
            <button
              className="tap rounded-lg px-3 py-2 text-label-lg text-brand"
              onClick={() => {
                window.open(webEpisode.url, '_blank', 'noopener')
                setWebEpisode(null)
              }}
            >
              浏览器打开
            </button>
          </div>
        </Modal>
      )}

      {sheetOpen && vod && (
        <DownloadSheet
          episodes={episodes}
          downloaded={downloaded}
          selected={selected}
          onToggle={(index) => {
            if (downloaded.has(index)) return
            setSelected((prev) => {
              const next = new Set(prev)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
          }}
          onToggleAll={() => {
            const all = episodes.filter((e) => !downloaded.has(e.index)).map((e) => e.index)
            setSelected((prev) => (all.every((i) => prev.has(i)) ? new Set() : new Set(all)))
          }}
          onConfirm={confirmDownload}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-8">
          <div className="rounded-lg bg-black/85 px-4 py-2.5 text-center text-body-sm text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </PageShell>
  )
}

function DetailContent({
  vod,
  sources,
  sourceIndex,
  episodes,
  downloaded,
  watched,
  historySource,
  historyEpisode,
  favorite,
  resumeLabel,
  onSelectSource,
  onPlay,
  onContinue,
  onDownload,
  onFavorite,
  onPoster,
}: {
  vod: Vod
  sources: PlaySource[]
  sourceIndex: number
  episodes: Episode[]
  downloaded: Set<number>
  watched: Record<number, number>
  historySource?: number
  historyEpisode?: number
  favorite: boolean
  resumeLabel: string | null
  onSelectSource: (i: number) => void
  onPlay: (source: number, episode: number) => void
  onContinue: () => void
  onDownload: () => void
  onFavorite: () => void
  onPoster: () => void
}) {
  const meta = metaLine(vod)
  const cast = [
    vod.actors.length > 0 ? '主演：' + vod.actors.slice(0, 8).join(' / ') : '',
    vod.director ? '导演：' + vod.director : '',
  ].filter(Boolean)

  return (
    <div className="pb-7">
      <div className="flex px-4 pt-3.5">
        <button onClick={onPoster} className="tap w-[108px] shrink-0">
          <Poster url={vod.poster} name={vod.name} rounded="rounded-[10px]" />
        </button>
        <div className="ml-3.5 min-w-0 flex-1">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-title-lg text-ink">{vod.name}</h2>
              {meta && <p className="mt-1.5 line-clamp-2 text-body-sm text-muted">{meta}</p>}
              {vod.remarks && <p className="mt-1 truncate text-body-sm text-muted">{vod.remarks}</p>}
              {vod.score && (
                <div className="mt-1.5 flex items-center">
                  <Icon name="star" size={14} className="text-gold" />
                  <span className="ml-1 text-title-sm font-bold text-gold">{vod.score}</span>
                </div>
              )}
            </div>
            <button
              onClick={onFavorite}
              aria-label={favorite ? '取消收藏' : '收藏'}
              className={`tap flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-surface-high ${
                favorite ? 'text-gold' : 'text-ink'
              }`}
            >
              <Icon name={favorite ? 'heart' : 'heartOutline'} size={19} />
            </button>
          </div>
          {vod.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {vod.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-surface-high px-2 py-1 text-label-sm text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center px-4 py-3">
        <PrimaryActionButton
          text={!episodes.length ? '暂无播放源' : resumeLabel || '立即播放'}
          disabled={!episodes.length}
          onClick={() => (resumeLabel ? onContinue() : onPlay(sourceIndex, 0))}
          className="min-w-0 flex-1"
        />
        <button
          onClick={onDownload}
          aria-label="下载"
          className="tap ml-2.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-high text-ink"
        >
          <Icon name="download" size={22} />
        </button>
      </div>

      {vod.summary && (
        <>
          <SectionTitle title="剧情简介" />
          <Synopsis text={vod.summary} />
        </>
      )}

      {cast.length > 0 && (
        <p className="line-clamp-3 px-4 py-1 text-body-sm text-muted">{cast.join('　·　')}</p>
      )}

      {sources.length === 0 ? (
        <EmptyBox text="暂无播放源，换个时间再来看看" className="h-[180px] pt-6" />
      ) : (
        <>
          {sources.length > 1 && (
            <>
              <SectionTitle title={`线路（${sources.length} 条）`} />
              <div className="flex gap-2 overflow-x-auto px-4 no-scrollbar">
                {sources.map((source, index) => {
                  const active = index === sourceIndex
                  return (
                    <button
                      key={`${source.name}-${index}`}
                      onClick={() => onSelectSource(index)}
                      className={`tap shrink-0 rounded-2xl px-3.5 py-[7px] text-label-lg ${
                        active ? 'bg-brand/15 text-brand' : 'bg-surface-high text-ink'
                      }`}
                    >
                      {sourceDisplayName(source)}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <SectionTitle title={`选集（${episodes.length} 集）`} />
          <EpisodeGrid
            episodes={episodes}
            sourceIndex={sourceIndex}
            historySource={historySource}
            historyEpisode={historyEpisode}
            downloaded={downloaded}
            watched={watched}
            onPlay={onPlay}
          />
        </>
      )}
    </div>
  )
}

function Synopsis({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="px-4">
      <p className={`text-body-md leading-[19px] text-muted ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
      <div className="flex justify-end">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="tap pt-1.5 text-label-md text-brand"
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
    </div>
  )
}

/** 集名越长列数越少：综艺那套「20261024第3期上·偷题猜词纯享」在 4 列下会被截得一模一样。 */
function episodeColumns(episodes: Episode[]): number {
  const longest = episodes.reduce((max, e) => Math.max(max, e.name.length), 0)
  if (longest > 16) return 2
  if (longest > 9) return 3
  return 4
}

function EpisodeGrid({
  episodes,
  sourceIndex,
  historySource,
  historyEpisode,
  downloaded,
  watched,
  onPlay,
}: {
  episodes: Episode[]
  sourceIndex: number
  historySource?: number
  historyEpisode?: number
  downloaded: Set<number>
  watched: Record<number, number>
  onPlay: (source: number, episode: number) => void
}) {
  const columns = episodeColumns(episodes)
  return (
    <div className="grid gap-2 px-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {episodes.map((episode) => {
        const playing = historySource === sourceIndex && historyEpisode === episode.index
        const progress = watched[episode.index]
        return (
          <button
            key={episode.index}
            onClick={() => onPlay(sourceIndex, episode.index)}
            className={`tap relative flex min-h-[46px] items-center justify-center rounded-lg px-1 py-1.5 ${
              playing
                ? 'bg-brand text-white'
                : progress != null
                  ? 'bg-surface-high/55 text-ink/45'
                  : 'bg-surface-high text-ink'
            }`}
          >
            <span className="line-clamp-3 text-center text-label-lg">{episode.name}</span>
            {downloaded.has(episode.index) && (
              <span className="absolute right-1 top-1">
                <DownloadedBadge light={playing} />
              </span>
            )}
            {progress != null && !playing && (
              <span
                className="absolute bottom-0 left-0 h-[2px] bg-brand/55"
                style={{ width: `${progress * 100}%` }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function DownloadSheet({
  episodes,
  downloaded,
  selected,
  onToggle,
  onToggleAll,
  onConfirm,
  onClose,
}: {
  episodes: Episode[]
  downloaded: Set<number>
  selected: Set<number>
  onToggle: (index: number) => void
  onToggleAll: () => void
  onConfirm: () => void
  onClose: () => void
}) {
  const columns = episodeColumns(episodes)
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/55" onClick={onClose}>
      <div
        className="max-h-[70vh] overflow-y-auto rounded-t-2xl bg-surface-high p-4 pb-6 no-scrollbar animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <span className="flex-1 text-title-md text-ink">选择下载集数</span>
          <button onClick={onToggleAll} className="tap px-1.5 py-1.5 text-label-md text-brand">
            全选
          </button>
        </div>
        <div
          className="mt-2.5 grid max-h-[360px] gap-2 overflow-y-auto no-scrollbar"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {episodes.map((episode) => {
            const done = downloaded.has(episode.index)
            const active = selected.has(episode.index)
            return (
              <button
                key={episode.index}
                onClick={() => onToggle(episode.index)}
                className={`tap flex min-h-[40px] items-center justify-center rounded-lg px-1 py-1 text-center text-label-md ${
                  done
                    ? 'bg-surface-high/50 text-muted'
                    : active
                      ? 'bg-brand/18 text-brand'
                      : 'bg-surface-high text-ink'
                }`}
              >
                <span className="line-clamp-2">{episode.name}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex items-center">
          <span className="flex-1 text-body-sm text-muted">已选 {selected.size} 集</span>
          <PrimaryActionButton
            text="下载"
            icon="download"
            disabled={selected.size === 0}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-8" onClick={onClose}>
      <div
        className="w-full max-w-[360px] rounded-2xl bg-surface-high p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-title-md text-ink">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}

function PosterPreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={onClose}>
      <img
        src={imgUrl(url)}
        alt={name}
        className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain animate-fade-in"
      />
      <button
        onClick={onClose}
        aria-label="关闭"
        className="tap absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
      >
        <Icon name="close" size={22} />
      </button>
    </div>
  )
}
