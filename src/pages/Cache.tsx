import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { clearPageCache } from '../lib/repo'
import { clearCompleted, listDownloads } from '../lib/downloads'
import { sizeText } from '../lib/parse'
import { ScreenTopBar } from '../components/common'
import { Dialog } from './Settings'
import { PageShell, useGoBack } from '../App'

export default function CachePage() {
  const goBack = useGoBack()
  const navigate = useNavigate()
  const pageCacheCount = useLiveQuery(() => db.pageCache.count(), [], 0)
  const favoriteCount = useLiveQuery(() => db.favorites.count(), [], 0)
  const historyCount = useLiveQuery(() => db.history.count(), [], 0)
  const [completed, setCompleted] = useState({ count: 0, bytes: 0 })
  const [usage, setUsage] = useState<{ quota: number; usage: number } | null>(null)
  const [confirm, setConfirm] = useState<null | 'pages' | 'downloads' | 'all'>(null)

  const refresh = () => {
    listDownloads()
      .then((rows) => {
        const done = rows.filter((t) => t.state === 'completed')
        setCompleted({ count: done.length, bytes: done.reduce((s, t) => s + t.bytes, 0) })
      })
      .catch(() => undefined)
    navigator.storage
      ?.estimate?.()
      .then(({ quota = 0, usage: used = 0 }) => setUsage({ quota, usage: used }))
      .catch(() => undefined)
  }

  useEffect(refresh, [])

  const doClear = async () => {
    if (confirm === 'pages' || confirm === 'all') await clearPageCache()
    if (confirm === 'downloads' || confirm === 'all') await clearCompleted()
    setConfirm(null)
    refresh()
  }

  return (
    <PageShell>
      <div className="flex h-full flex-col overflow-y-auto bg-bg no-scrollbar">
        <ScreenTopBar title="缓存管理" onBack={goBack} />

        <section>
          <p className="px-[30px] pb-1.5 pt-3.5 text-label-md text-muted">存储占用</p>
          <div className="mx-4 rounded-card bg-surface px-4 py-3">
            <p className="text-title-md text-ink">
              {usage ? `${sizeText(usage.usage)} / ${sizeText(usage.quota)}` : '统计中…'}
            </p>
            <p className="mt-1 text-label-sm text-muted">
              浏览器为该站点分配的总空间。视频分片、页面缓存与片库数据都算在这里。
            </p>
            {usage && usage.quota > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-divider">
                <div
                  className="h-full bg-brand"
                  style={{ width: `${Math.min(100, (usage.usage / usage.quota) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </section>

        <section>
          <p className="px-[30px] pb-1.5 pt-3.5 text-label-md text-muted">明细</p>
          <div className="mx-4 overflow-hidden rounded-card bg-surface">
            <CacheRow
              title="页面缓存"
              subtitle="分类列表、搜索结果的原始响应（最长留 3 天）"
              value={`${pageCacheCount} 项`}
              action="清空"
              onAction={() => setConfirm('pages')}
            />
            <CacheRow
              title="离线下载"
              subtitle={`已缓存 ${completed.count} 集`}
              value={sizeText(completed.bytes)}
              action={completed.count > 0 ? '清理' : undefined}
              onAction={() => setConfirm('downloads')}
              onOpen={() => navigate('/downloads')}
            />
            <CacheRow
              title="播放缓存"
              subtitle="播放过的分片由浏览器自动缓存，无法逐条统计"
              value="—"
            />
            <CacheRow
              title="收藏与观看记录"
              subtitle="本地片库数据，清理后不可恢复"
              value={`收藏 ${favoriteCount} · 历史 ${historyCount}`}
              action="查看"
              onAction={() => navigate('/history')}
              last
            />
          </div>
        </section>

        <div className="mx-4 mt-5">
          <button
            onClick={() => setConfirm('all')}
            className="tap w-full rounded-card bg-surface py-3 text-center text-title-sm text-danger"
          >
            清理全部缓存
          </button>
          <p className="mt-3 px-1 text-label-sm text-muted">
            清理只影响本机缓存，不会删除收藏与观看记录；离线下载清理后需重新下载才能离线观看。
          </p>
        </div>
        <div className="h-7" />
      </div>

      {confirm && (
        <Dialog
          title={
            confirm === 'pages' ? '清空页面缓存？' : confirm === 'downloads' ? '清理离线下载？' : '清理全部缓存？'
          }
          onClose={() => setConfirm(null)}
        >
          <p className="text-body-sm text-muted">
            {confirm === 'all'
              ? '将清空页面缓存与全部已下载的分片。收藏和观看记录不受影响。'
              : confirm === 'pages'
                ? '清空后列表需要重新联网加载一次。'
                : `将删除已缓存的 ${completed.count} 集分片（约 ${sizeText(completed.bytes)}）。`}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className="tap rounded-lg px-3 py-2 text-label-lg text-muted">
              取消
            </button>
            <button onClick={doClear} className="tap rounded-lg px-3 py-2 text-label-lg text-danger">
              确认清理
            </button>
          </div>
        </Dialog>
      )}
    </PageShell>
  )
}

function CacheRow({
  title,
  subtitle,
  value,
  action,
  onAction,
  onOpen,
  last,
}: {
  title: string
  subtitle: string
  value: string
  action?: string
  onAction?: () => void
  onOpen?: () => void
  last?: boolean
}) {
  return (
    <div>
      <div className="flex min-h-[56px] items-center px-4 py-2.5">
        <button onClick={onOpen} className={`min-w-0 flex-1 text-left ${onOpen ? 'tap' : ''}`}>
          <p className="text-title-sm text-ink">{title}</p>
          <p className="mt-0.5 line-clamp-2 text-label-sm text-muted">{subtitle}</p>
        </button>
        <span className="ml-3 shrink-0 text-label-md text-muted">{value}</span>
        {action && onAction && (
          <button onClick={onAction} className="tap ml-2 shrink-0 px-1 py-2 text-label-md text-brand">
            {action}
          </button>
        )}
      </div>
      {!last && <div className="ml-4 h-px bg-divider" />}
    </div>
  )
}
