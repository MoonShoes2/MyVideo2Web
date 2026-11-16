import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { listDownloads, subscribeDownloads } from '../lib/downloads'
import { historyTimeLabel, playbackText, isFinished } from '../lib/parse'
import { removeHistory } from '../lib/repo'
import type { DownloadTask } from '../lib/types'
import { Icon } from '../components/icons'
import { Poster, SectionTitle, TabHeader } from '../components/common'

const RECENT_HISTORY_COUNT = 3

export default function Mine() {
  const navigate = useNavigate()
  const favoriteCount = useLiveQuery(() => db.favorites.count(), [], 0)
  const historyCount = useLiveQuery(() => db.history.count(), [], 0)
  const history = useLiveQuery(() => db.history.orderBy('updatedAt').reverse().toArray(), [], [])
  const [downloads, setDownloads] = useState<DownloadTask[]>([])

  useEffect(() => {
    const load = () => listDownloads().then(setDownloads).catch(() => undefined)
    load()
    return subscribeDownloads(load)
  }, [])

  const completed = downloads.filter((d) => d.state === 'completed').length
  const running = downloads.filter((d) => d.state === 'downloading' || d.state === 'queued')
  const percent = running.length
    ? Math.round((running.reduce((s, d) => s + d.progress, 0) / running.length) * 100)
    : 0
  const downloadBadge = running.length
    ? `正在下载 ${running.length} 集${percent > 0 ? ` · ${percent}%` : ''}`
    : String(completed)

  const recent = history.slice(0, RECENT_HISTORY_COUNT)

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <TabHeader title="我的" />

      <div className="mx-4 overflow-hidden rounded-card bg-surface">
        <MineRow
          icon="heartOutline"
          title="我的收藏"
          badge={String(favoriteCount)}
          onClick={() => navigate('/favorites')}
        />
        <MineRow
          icon="history"
          title="观看历史"
          badge={String(historyCount)}
          onClick={() => navigate('/history')}
        />
        <MineRow
          icon="download"
          title="离线下载"
          badge={downloadBadge}
          highlight={running.length > 0}
          onClick={() => navigate('/downloads')}
        />
        <MineRow icon="settings" title="设置" onClick={() => navigate('/settings')} last />
      </div>

      {recent.length > 0 && (
        <>
          <SectionTitle title="继续观看" actionText="全部" onAction={() => navigate('/history')} />
          <div className="mx-4 overflow-hidden rounded-card">
            {recent.map((record, index) => {
              const episode = record.episodeName || `第${record.episodeIndex + 1}集`
              const finished = isFinished(record)
              return (
                <div
                  key={record.vodId}
                  className={`flex min-h-[76px] items-center bg-surface pl-3 pr-1 ${
                    index === 0 ? 'rounded-t-card' : ''
                  } ${index === recent.length - 1 ? 'rounded-b-card' : ''}`}
                >
                  <button
                    onClick={() => navigate(`/detail/${record.vodId}`)}
                    className="tap w-24 shrink-0"
                  >
                    <Poster
                      url={record.poster}
                      name={record.name}
                      ratio="aspect-video"
                      rounded="rounded-[9px]"
                    />
                  </button>
                  <button
                    onClick={() => navigate(`/player/${record.vodId}`)}
                    className="tap flex h-full min-h-[76px] flex-1 flex-col justify-center px-3 text-left"
                  >
                    <p className="truncate text-body-lg font-semibold text-ink">{record.name}</p>
                    <p className="truncate text-body-sm text-muted">
                      {finished
                        ? `${episode} · 已看完`
                        : `${episode} · 看到 ${playbackText(record.positionMs)}`}
                    </p>
                    <p className="truncate text-label-sm text-muted">
                      {historyTimeLabel(record.updatedAt)}
                    </p>
                  </button>
                  <button
                    onClick={() => removeHistory(record.vodId)}
                    aria-label="删除"
                    className="tap flex h-10 w-10 shrink-0 items-center justify-center text-muted"
                  >
                    <Icon name="trash" size={20} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="h-7" />
    </div>
  )
}

function MineRow({
  icon,
  title,
  badge,
  highlight,
  last,
  onClick,
}: {
  icon: 'heartOutline' | 'history' | 'download' | 'settings'
  title: string
  badge?: string
  highlight?: boolean
  last?: boolean
  onClick: () => void
}) {
  return (
    <div>
      <button onClick={onClick} className="tap flex h-[52px] w-full items-center px-3.5">
        <Icon name={icon} size={20} className="text-brand" />
        <span className="ml-3 flex-1 text-left text-title-sm text-ink">{title}</span>
        {badge && (
          <span
            className={`ml-2 max-w-[60%] truncate text-label-md ${
              highlight ? 'text-brand' : 'text-muted'
            }`}
          >
            {badge}
          </span>
        )}
        <Icon name="chevron" size={18} className="ml-1 text-muted/70" />
      </button>
      {!last && <div className="ml-[46px] h-px bg-divider" />}
    </div>
  )
}
