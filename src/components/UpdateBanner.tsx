import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BUILD_ID, hardReload } from '../lib/version'

/**
 * 新版本提示。
 *
 * PWA 装到桌面后经常整晚不重启，即便线上发了新版它也不会自己换。
 * 这里定期拉 `/version.json`（服务端 no-cache）与当前进程的构建号比对，
 * 不一致就提示用户点一下更新——这是唯一能覆盖「已经装死的旧实例」的办法。
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false)
  const [closed, setClosed] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { build?: string }
        if (!cancelled && data.build && data.build !== BUILD_ID) setStale(true)
      } catch {
        /* 离线或接口不通时保持安静 */
      }
    }
    void check()
    const timer = window.setInterval(check, 5 * 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // 播放页是全屏沉浸的，别在这里弹
  if (!stale || closed || pathname.startsWith('/player')) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="mx-auto flex max-w-[480px] items-center gap-3 rounded-xl bg-surface-high px-3.5 py-2.5 shadow-lg">
        <span className="min-w-0 flex-1 text-label-md text-ink">发现新版本，更新后体验更稳</span>
        <button
          onClick={() => void hardReload()}
          className="tap shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-label-md text-white"
        >
          立即更新
        </button>
        <button
          onClick={() => setClosed(true)}
          aria-label="忽略"
          className="tap shrink-0 px-1 text-muted"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
