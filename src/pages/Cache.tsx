import { useEffect, useState } from 'react'
import { clearPageCache } from '../lib/repo'
import { clearCompleted, listDownloads } from '../lib/downloads'
import { sizeText } from '../lib/parse'
import { CACHE_CAPACITY_OPTIONS, updateSettings, useSettings } from '../lib/settings'
import { Icon } from '../components/icons'
import { ScreenTopBar } from '../components/common'
import { Dialog } from './Settings'
import { PageShell, useGoBack } from '../App'

export default function CachePage() {
  const goBack = useGoBack()
  const settings = useSettings()
  const [completed, setCompleted] = useState({ count: 0, bytes: 0 })
  const [usage, setUsage] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingClear, setPendingClear] = useState<boolean | null>(null)

  useEffect(() => {
    listDownloads()
      .then((rows) => {
        const done = rows.filter((t) => t.state === 'completed')
        setCompleted({ count: done.length, bytes: done.reduce((s, t) => s + t.bytes, 0) })
      })
      .catch(() => undefined)
    navigator.storage?.estimate?.().then(({ usage: used = 0 }) => setUsage(used)).catch(() => undefined)
  }, [])

  const clear = async (isPlayback: boolean) => {
    setPendingClear(null)
    if (isPlayback) {
      // 浏览器不允许单独清 HTTP 缓存；这里先清页面缓存，并明确告知用户边界。
      await clearPageCache()
      setNotice('浏览器无法单独清除播放分片，已清空页面缓存；完整清理请在浏览器设置中清除站点数据。')
    } else {
      await clearCompleted()
      setNotice(null)
      const rows = await listDownloads()
      const done = rows.filter((t) => t.state === 'completed')
      setCompleted({ count: done.length, bytes: done.reduce((s, t) => s + t.bytes, 0) })
    }
  }

  return (
    <PageShell>
      <div className="flex h-full flex-col overflow-y-auto bg-bg no-scrollbar">
        <ScreenTopBar title="缓存管理" onBack={goBack} />

        <SettingsGroup title="播放缓存">
          <CacheRow
            title="已用空间"
            subtitle="边看边缓存，回看无需重新加载"
            value={sizeText(usage)}
          />
          <div className="px-4 py-2.5">
            <p className="text-title-sm text-ink">缓存容量</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {CACHE_CAPACITY_OPTIONS.map((gb) => {
                const active = settings.cacheCapacityGb === gb
                return (
                  <button
                    key={gb}
                    onClick={() => {
                      updateSettings({ cacheCapacityGb: gb })
                      setNotice(`浏览器按自身配额自动淘汰缓存，${gb}GB 为目标档位。`)
                    }}
                    className={`tap rounded-lg py-2 text-label-md ${
                      active ? 'bg-brand text-white' : 'bg-surface-high text-ink'
                    }`}
                  >
                    {gb}GB
                  </button>
                )
              })}
            </div>
          </div>
          {notice && <p className="px-4 py-1 text-label-sm text-brand">{notice}</p>}
          <CacheRow
            title="清理播放缓存"
            subtitle="只清除播放分片，不影响已下载内容"
            action="清理"
            danger
            onAction={() => setPendingClear(true)}
            last
          />
        </SettingsGroup>

        <SettingsGroup title="下载缓存">
          <CacheRow
            title="已用空间"
            subtitle="已下载内容不会自动清理"
            value={sizeText(completed.bytes)}
          />
          <CacheRow
            title="清理下载缓存"
            subtitle="删除后需要重新下载"
            action="清理"
            danger
            onAction={() => setPendingClear(false)}
            last
          />
          <p className="px-4 py-3 text-label-sm text-muted">
            已下载的影片请前往「离线下载」页面管理。
          </p>
        </SettingsGroup>

        <div className="h-7" />
      </div>

      {pendingClear != null && (
        <Dialog title={pendingClear ? '清理播放缓存' : '清理下载缓存'} onClose={() => setPendingClear(null)}>
          <p className="text-body-md text-muted">
            {pendingClear
              ? '将删除已缓存的播放分片，之前看过的内容需要重新加载。'
              : '将删除全部已下载的影片，删除后需要重新下载才能离线观看。'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setPendingClear(null)} className="tap rounded-lg px-3 py-2 text-label-lg text-muted">
              取消
            </button>
            <button onClick={() => void clear(pendingClear)} className="tap rounded-lg px-3 py-2 text-label-lg text-danger">
              清理
            </button>
          </div>
        </Dialog>
      )}
    </PageShell>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="px-[30px] pb-1.5 pt-3.5 text-label-md text-muted">{title}</p>
      <div className="mx-4 overflow-hidden rounded-card bg-surface">{children}</div>
    </section>
  )
}

function CacheRow({
  title,
  subtitle,
  value,
  action,
  danger,
  onAction,
  last,
}: {
  title: string
  subtitle: string
  value?: string
  action?: string
  danger?: boolean
  onAction?: () => void
  last?: boolean
}) {
  return (
    <div>
      <div className={`flex min-h-[56px] items-center px-4 py-2.5 ${onAction ? 'tap cursor-pointer' : ''}`} onClick={onAction}>
        <div className="min-w-0 flex-1">
          <p className="text-title-sm text-ink">{title}</p>
          <p className="mt-0.5 truncate text-label-sm text-muted">{subtitle}</p>
        </div>
        {value && <span className="ml-3 shrink-0 text-label-md text-muted">{value}</span>}
        {action && (
          <span className={`ml-3 shrink-0 text-label-md ${danger ? 'text-danger' : 'text-brand'}`}>
            {action}
          </span>
        )}
        {onAction && <Icon name="chevron" size={18} className="ml-1 text-muted/70" />}
      </div>
      {!last && <div className="ml-4 h-px bg-divider" />}
    </div>
  )
}
