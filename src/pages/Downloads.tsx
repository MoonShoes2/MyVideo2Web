import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearAllDownloads,
  listDownloads,
  pause,
  pauseAll,
  remove,
  resume,
  resumeAll,
  retryDownload,
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

interface DownloadGroup {
  key: string
  vodId: number
  vodName: string
  poster: string
  sourceIndex: number
  sourceName: string
  items: DownloadTask[]
}

/** 与原生一致：按「影片 + 线路」分组，同一部剧的多集收在一张卡片里。 */
function groupTasks(tasks: DownloadTask[]): DownloadGroup[] {
  const map = new Map<string, DownloadGroup>()
  for (const task of tasks) {
    const key = `${task.vodId}:${task.sourceIndex}`
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        vodId: task.vodId,
        vodName: task.vodName,
        poster: task.poster,
        sourceIndex: task.sourceIndex,
        sourceName: task.sourceName,
        items: [],
      }
      map.set(key, group)
    }
    group.items.push(task)
  }
  return Array.from(map.values())
}

function groupStatus(group: DownloadGroup): string {
  const count = group.items.length
  const done = group.items.filter((t) => t.state === 'completed').length
  if (group.items.every((t) => t.state === 'completed')) return `已完成 · ${done}/${count} 集`
  if (group.items.some((t) => t.state === 'failed')) return `下载失败 · ${done}/${count} 集`
  if (group.items.some((t) => t.error === '等待 Wi-Fi 网络')) return `等待中 · ${done}/${count} 集`
  if (group.items.some((t) => t.state === 'paused')) return `已暂停 · ${done}/${count} 集`
  return `下载中 · ${done}/${count} 集`
}

export default function Downloads() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingGroupDelete, setPendingGroupDelete] = useState<DownloadGroup | null>(null)

  useEffect(() => {
    const load = () => listDownloads().then(setTasks).catch(() => undefined)
    load()
    return subscribeDownloads(load)
  }, [])

  const groups = useMemo(() => groupTasks(tasks), [tasks])
  const activeGroups = groups.filter((g) => g.items.some((t) => t.state !== 'completed'))
  const finishedGroups = groups.filter((g) => g.items.every((t) => t.state === 'completed'))
  const completed = tasks.filter((t) => t.state === 'completed')
  const totalBytes = completed.reduce((sum, t) => sum + t.bytes, 0)
  const activeTasks = activeGroups.flatMap((g) => g.items.filter((t) => t.state !== 'completed'))
  const hasRunning = activeTasks.some((t) => t.state === 'downloading' || t.state === 'queued')

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAllRunning = () => {
    const ids = activeTasks.map((t) => t.id)
    if (hasRunning) void pauseAll(ids)
    else void resumeAll(ids)
  }

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar
          title="我的下载"
          onBack={goBack}
          right={
            <div className="flex items-center">
              {activeTasks.length > 0 && (
                <button onClick={toggleAllRunning} className="tap px-2 py-2 text-label-md text-muted">
                  {hasRunning ? '全部暂停' : '全部继续'}
                </button>
              )}
              {tasks.length > 0 && (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="tap px-2 py-2 text-label-md text-muted"
                >
                  清空全部下载
                </button>
              )}
            </div>
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
            <EmptyBox text="还没有下载内容。在影片详情页点「下载」即可离线缓存。" className="h-[50vh]" />
          ) : (
            <div className="space-y-2.5">
              {tasks.some((t) => t.error === '等待 Wi-Fi 网络') && (
                <div className="rounded-card bg-surface px-4 py-3 text-body-md text-ink">
                  当前为移动网络，下载任务将等待 Wi-Fi 连接后继续
                </div>
              )}
              {activeGroups.length > 0 && (
                <p className="px-1 pt-1 text-label-md text-muted">正在下载</p>
              )}
              {activeGroups.map((group) => (
                <DownloadGroupCard
                  key={group.key}
                  group={group}
                  collapsed={collapsed.has(group.key)}
                  onToggleCollapse={() => toggleCollapse(group.key)}
                  onOpenDetail={() => navigate(`/detail/${group.vodId}`)}
                  onPlay={(task) =>
                    navigate(
                      `/player/${task.vodId}?source=${task.sourceIndex}&episode=${task.episodeIndex}`,
                    )
                  }
                  onToggle={(task) =>
                    task.state === 'downloading' || task.state === 'queued'
                      ? void pause(task.id)
                      : void resume(task.id)
                  }
                  onRetry={(task) => void retryDownload(task.id)}
                  onRemove={(task) => void remove(task.id)}
                  onDeleteGroup={() => setPendingGroupDelete(group)}
                />
              ))}
              {finishedGroups.length > 0 && (
                <p className="px-1 pt-2 text-label-md text-muted">已下载</p>
              )}
              {finishedGroups.map((group) => (
                <DownloadGroupCard
                  key={group.key}
                  group={group}
                  collapsed={collapsed.has(group.key)}
                  onToggleCollapse={() => toggleCollapse(group.key)}
                  onOpenDetail={() => navigate(`/detail/${group.vodId}`)}
                  onPlay={(task) =>
                    navigate(
                      `/player/${task.vodId}?source=${task.sourceIndex}&episode=${task.episodeIndex}`,
                    )
                  }
                  onToggle={(task) => void resume(task.id)}
                  onRetry={(task) => void retryDownload(task.id)}
                  onRemove={(task) => void remove(task.id)}
                  onDeleteGroup={() => setPendingGroupDelete(group)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-10">
          <div className="w-full max-w-[340px] rounded-2xl bg-surface-high p-5">
            <h3 className="text-title-md text-ink">清空全部下载</h3>
            <p className="mt-2 text-body-sm text-muted">
              将删除所有已下载内容（约 {sizeText(totalBytes)}），此操作不可恢复。
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
                  await clearAllDownloads()
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

      {pendingGroupDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-10">
          <div className="w-full max-w-[340px] rounded-2xl bg-surface-high p-5">
            <h3 className="text-title-md text-ink">删除整部剧的下载？</h3>
            <p className="mt-2 text-body-sm text-muted">
              将删除《{pendingGroupDelete.vodName}》共 {pendingGroupDelete.items.length} 集的离线缓存，此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingGroupDelete(null)}
                className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  for (const task of pendingGroupDelete.items) await remove(task.id)
                  setPendingGroupDelete(null)
                }}
                className="tap rounded-lg px-3 py-2 text-label-lg text-danger"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

function DownloadGroupCard({
  group,
  collapsed,
  onToggleCollapse,
  onOpenDetail,
  onPlay,
  onToggle,
  onRetry,
  onRemove,
  onDeleteGroup,
}: {
  group: DownloadGroup
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenDetail: () => void
  onPlay: (task: DownloadTask) => void
  onToggle: (task: DownloadTask) => void
  onRetry: (task: DownloadTask) => void
  onRemove: (task: DownloadTask) => void
  onDeleteGroup: () => void
}) {
  const doneCount = group.items.filter((t) => t.state === 'completed').length
  const bytes = group.items.reduce((s, t) => s + t.bytes, 0)
  const percent = Math.round(
    (group.items.reduce((s, t) => s + t.progress, 0) / Math.max(1, group.items.length)) * 100,
  )
  const running = group.items.filter((t) => t.state === 'downloading' || t.state === 'queued')
  const paused = group.items.filter((t) => t.state === 'paused')
  const single = group.items.length === 1

  return (
    <div className="rounded-card bg-surface p-3">
      <div className="flex items-start gap-3">
        <button onClick={onOpenDetail} className="tap w-[70px] shrink-0">
          <Poster url={group.poster} name={group.vodName} ratio="aspect-video" rounded="rounded-lg" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            onClick={single ? onOpenDetail : onToggleCollapse}
            className="tap flex w-full items-center text-left"
          >
            <span className="min-w-0 flex-1 truncate text-title-sm text-ink">{group.vodName}</span>
            {!single && (
              <Icon
                name="chevron"
                size={18}
                className={`ml-1 shrink-0 text-muted ${collapsed ? '' : 'rotate-90'}`}
              />
            )}
          </button>
          <p className="mt-0.5 truncate text-label-sm text-muted">
            {group.sourceName || '默认线路'} · {doneCount}/{group.items.length} 集 · {sizeText(bytes)}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-divider">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 truncate text-label-sm text-muted">{groupStatus(group)}</p>
        </div>
      </div>

      {!collapsed && (
        <>
          <div
            className={`mt-3 space-y-2 border-t border-divider/70 pt-2.5 ${
              single ? '' : 'pl-[100px] pr-3'
            }`}
          >
            {group.items.map((task) => (
              <DownloadRow
                key={task.id}
                task={task}
                onPlay={() => onPlay(task)}
                onToggle={() => onToggle(task)}
                onRetry={() => onRetry(task)}
                onRemove={() => onRemove(task)}
              />
            ))}
          </div>
          {group.items.length > 1 && (
            <div className="mt-3 flex items-center justify-end gap-3 border-t border-divider/70 pt-2.5">
              {running.length > 0 ? (
                <button
                  onClick={() => void pauseAll(running.map((t) => t.id))}
                  className="tap px-1 py-1 text-label-md text-brand"
                >
                  全部暂停
                </button>
              ) : paused.length > 0 ? (
                <button
                  onClick={() => void resumeAll(paused.map((t) => t.id))}
                  className="tap px-1 py-1 text-label-md text-brand"
                >
                  全部继续
                </button>
              ) : null}
              <button onClick={onDeleteGroup} className="tap px-1 py-1 text-label-md text-danger">
                删除整组
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DownloadRow({
  task,
  onPlay,
  onToggle,
  onRetry,
  onRemove,
}: {
  task: DownloadTask
  onPlay: () => void
  onToggle: () => void
  onRetry: () => void
  onRemove: () => void
}) {
  const done = task.state === 'completed'
  const percent = Math.round(task.progress * 100)
  const speed = task.speedBytesPerSecond ? `${sizeText(task.speedBytesPerSecond)}/s` : ''

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-variant/55 p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-title-sm text-ink">{task.episodeName}</p>
        <p className="truncate text-label-sm text-muted">
          {done
            ? `已完成 · ${sizeText(task.bytes)}`
            : `${STATE_LABEL[task.state]}${task.totalSegments ? ` · ${percent}%` : ''}${speed ? ` · ${speed}` : ''}`}
        </p>
        {!done && (
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-divider">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        )}
        {task.error && !done && <p className="mt-1 truncate text-label-sm text-danger">{task.error}</p>}
      </div>

      {done ? (
        <IconButton name="play" label="播放" onClick={onPlay} />
      ) : (
        <IconButton
          name={task.state === 'downloading' || task.state === 'queued' ? 'pause' : 'play'}
          label={task.state === 'downloading' || task.state === 'queued' ? '暂停' : '继续'}
          onClick={onToggle}
        />
      )}
      {task.state === 'failed' && <IconButton name="refresh" label="重试" onClick={onRetry} />}
      <IconButton name="trash" label="删除" onClick={onRemove} />
    </div>
  )
}

function IconButton({
  name,
  label,
  onClick,
}: {
  name: 'play' | 'pause' | 'refresh' | 'trash'
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted"
    >
      <Icon name={name} size={18} />
    </button>
  )
}
