import { useCallback, useMemo, useRef, useState } from 'react'
import type { Vod, VodPage } from './types'

export interface VodPager {
  items: Vod[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  endReached: boolean
  total: number
  loadedPage: number
  refresh: (force?: boolean, keepContent?: boolean) => Promise<void>
  showFirstPage: (page: VodPage) => void
  loadNext: () => Promise<void>
}

/**
 * 列表分页器：对应原工程 `ui/components/Paging.kt` 的 VodPager。
 *
 * 请求代次（generation）是关键：切分类/切筛选会立刻发新请求，
 * 上一轮的响应回来时代次已变，直接丢弃——否则用户会一直看到旧分类的列表。
 */
export function useVodPager(
  fetcher: (page: number, force: boolean) => Promise<VodPage>,
): VodPager {
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  const [items, setItems] = useState<Vod[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [endReached, setEndReached] = useState(false)
  const [total, setTotal] = useState(0)
  const [loadedPage, setLoadedPage] = useState(0)
  const generation = useRef(0)

  const refresh = useCallback(async (force = false, keepContent = false) => {
    const gen = ++generation.current
    if (!keepContent) {
      setItems([])
      setLoadedPage(0)
      setEndReached(false)
    }
    setError(null)
    setLoading(true)
    setLoadingMore(false)
    try {
      const page = await fetchRef.current(1, force)
      if (gen !== generation.current) return
      if (page.items.length > 0 || !keepContent) {
        const seen = new Set<number>()
        const fresh = page.items.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
        setItems(fresh)
        setLoadedPage(1)
        setTotal(page.total)
        setEndReached(!page.hasMore)
      }
    } catch (e) {
      if (gen !== generation.current) return
      setError((e as Error).message || '加载失败')
      if (!keepContent) {
        setItems([])
        setLoadedPage(0)
        setEndReached(false)
      }
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [])

  const showFirstPage = useCallback((page: VodPage) => {
    generation.current++
    const seen = new Set<number>()
    setItems(page.items.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))))
    setLoadedPage(1)
    setTotal(page.total)
    setEndReached(!page.hasMore)
    setError(null)
    setLoading(false)
    setLoadingMore(false)
  }, [])

  const loadNext = useCallback(async () => {
    if (loading || endReached) return
    const gen = generation.current
    setLoading(true)
    setLoadingMore(true)
    setError(null)
    try {
      const next = loadedPage + 1
      const page = await fetchRef.current(next, false)
      if (gen !== generation.current) return
      setItems((prev) => {
        const known = new Set(prev.map((v) => v.id))
        return [...prev, ...page.items.filter((v) => !known.has(v.id))]
      })
      setLoadedPage(next)
      setTotal(page.total)
      setEndReached(!page.hasMore)
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message || '加载失败')
    } finally {
      if (gen === generation.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [loading, endReached, loadedPage])

  return useMemo(
    () => ({
      items,
      loading,
      loadingMore,
      error,
      endReached,
      total,
      loadedPage,
      refresh,
      showFirstPage,
      loadNext,
    }),
    [items, loading, loadingMore, error, endReached, total, loadedPage, refresh, showFirstPage, loadNext],
  )
}

/** 滚动到接近底部时提前拉下一页（对应 LoadMoreOnScroll）。 */
export function nearBottom(el: HTMLElement | null, bufferPx = 600): boolean {
  if (!el) return false
  return el.scrollTop + el.clientHeight >= el.scrollHeight - bufferPx
}
