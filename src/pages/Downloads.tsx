import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearCompleted,
  listDownloads,
  pause,
  remove,
  resume,
  subscribeDownloads,
} from '../lib/downloads'
import { sizeText } from '../lib/parse'
import type { DownloadTask } from '../lib/types'
import { Icon } from '../components/icons'
import { EmptyBox, Poster, ScreenTopBar } from '../components/common'
import { PageShell, useGoBack } from '../App'

const STATE_LABEL: Record<DownloadTask['state'], string> = {
  queued: '排队中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  failed: '下载失败',
}

export default function Downloads() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const load = () => listDownloads().then(setTasks).catch(() => undefined)
    load()
    return subscribeDownloads(load)
  }, [])

  const active = tasks.filter((t) => t.state !== 'completed')
  const completed = tasks.filter((t) => t.state === 'completed')
  const totalBytes = completed.reduce((sum, t) => sum + t.bytes, 0)
  const allDone = completed.length === 0

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar
          title="离线下载"
          onBack={goBack}
          right={
            !allDone ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="tap px-3 py-2 text-label-md text-muted"
              >
                清理已完成
              </button>
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 no-scrollbar">
          <div className="mb-3 rounded-card bg-surface px-4 py-3">
            <p className="text-title-sm text-ink">
              已缓存 {completed.length} 集 · {sizeText(totalBytes)}
            </p>
            <p className="mt-1 text-label-sm text-muted">
              视频分片存放在浏览器缓存中，断网也能播放；清理浏览器数据会一并删除。
            </p>
          </div>

          {tasks.length === 0 ? (
            <EmptyBox text="还没有下载任务，去详情页挑几集吧" className="h-[50vh]" />
          ) : (
            <div className="space-y-2">
              {active.map((task) => (
                <DownloadRow
                  key={task.id}
                  task={task}
                  onPlay={() => navigate(`/player/${task.vodId}?source=${task.sourceIndex}&episode=${task.episodeIndex}`)}
                  onToggle={() => (task.state === 'downloading' || task.state === 'queued' ? pause(task.id) : resume(task.id))}
                  onRemove={() => remove(task.id)}
                />
              ))}
              {completed.map((task) => (
                <DownloadRow
                  key={task.id}
                  task={task}
                  onPlay={() => navigate(`/player/${task.vodId}?source=${task.sourceIndex}&episode=${task.episodeIndex}`)}
                  onRemove={() => remove(task.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-10">
          <div className="w-full max-w-[340px] rounded-2xl bg-surface-high p-5">
            <h3 className="text-title-md text-ink">清理已完成的下载？</h3>
            <p className="mt-2 text-body-sm text-muted">
              会删除已缓存的 {completed.length} 集分片（约 {sizeText(totalBytes)}），之后需要重新下载才能离线观看。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmClear(false)}
                className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  await clearCompleted()
                  setConfirmClear(false)
                }}
                className="tap rounded-lg px-3 py-2 text-label-lg text-danger"
              >
                清理
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

function DownloadRow({
  task,
  onPlay,
  onToggle,
  onRemove,
}: {
  task: DownloadTask
  onPlay: () => void
  onToggle?: () => void
  onRemove: () => void
}) {
  const done = task.state === 'completed'
  const percent = Math.round(task.progress * 100)
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface p-2.5">
      <button onClick={onPlay} className="tap w-[72px] shrink-0">
        <Poster url={task.poster} name={task.vodName} ratio="aspect-video" rounded="rounded-lg" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-title-sm text-ink">{task.vodName}</p>
        <p className="truncate text-label-sm text-muted">
          {task.episodeName}
          {done
            ? ` · ${sizeText(task.bytes)}`
            : ` · ${STATE_LABEL[task.state]}${task.totalSegments ? ` ${percent}%` : ''}`}
        </p>
        {!done && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-divider">
              <div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-label-sm text-muted">{percent}%</span>
          </div>
        )}
        {task.error && !done && <p className="mt-1 truncate text-label-sm text-danger">{task.error}</p>}
      </div>
      {onToggle && (
        <button
          onClick={onToggle}
          aria-label={task.state === 'downloading' ? '暂停' : '继续'}
          className="tap flex h-9 w-9 items-center justify-center rounded-full bg-surface-high text-ink"
        >
          <Icon name={task.state === 'downloading' || task.state === 'queued' ? 'pause' : 'play'} size={18} />
        </button>
      )}
      <button
        onClick={onRemove}
        aria-label="删除"
        className="tap flex h-9 w-9 items-center justify-center rounded-full text-muted"
      >
        <Icon name="trash" size={18} />
      </button>
    </div>
  )
}
