import { useEffect, useRef } from 'react'

/**
 * 下拉刷新（触屏）。原生工程用 Material3 的 PullToRefreshBox；
 * Web 端没有等价物，这里按同样的阈值（约 56px）自己实现一套。
 */
export function usePullToRefresh(
  ref: React.RefObject<HTMLElement>,
  onRefresh: () => Promise<void>,
  setPull: (v: number) => void,
) {
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startY = 0
    let pulling = false
    let distance = 0

    const start = (e: TouchEvent) => {
      if (el.scrollTop > 0) return
      startY = e.touches[0].clientY
      pulling = true
      distance = 0
    }
    const move = (e: TouchEvent) => {
      if (!pulling) return
      const delta = e.touches[0].clientY - startY
      if (delta <= 0) {
        setPull(0)
        return
      }
      if (el.scrollTop > 0) {
        pulling = false
        setPull(0)
        return
      }
      distance = Math.min(88, delta * 0.5)
      setPull(distance)
      if (delta > 12) e.preventDefault()
    }
    const end = async () => {
      if (!pulling) return
      pulling = false
      if (distance >= 56) {
        setPull(18)
        await refreshRef.current().catch(() => undefined)
      }
      setPull(0)
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [ref, setPull])
}
