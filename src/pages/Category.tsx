import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  buildFilterUrl,
  fetchCategories,
  fetchFilterGroups,
  fetchFilterList,
  fetchPage,
  type FilterGroup,
} from '../lib/repo'
import type { Category, VodPage } from '../lib/types'
import { useVodPager, nearBottom } from '../lib/usePager'
import { Icon } from '../components/icons'
import {
  BackToTopButton,
  EmptyBox,
  ErrorBox,
  SkeletonGrid,
  TabHeader,
  VodCard,
} from '../components/common'

const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, name: '电影', parentId: 0 },
  { id: 2, name: '电视剧', parentId: 0 },
  { id: 3, name: '综艺', parentId: 0 },
  { id: 4, name: '动漫', parentId: 0 },
  { id: 20, name: '短剧', parentId: 0 },
]

const ALL_LABEL = '全部'

export default function CategoryPage() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>(FALLBACK_CATEGORIES)
  const [selectedId, setSelectedId] = useState(1)
  const [groups, setGroups] = useState<FilterGroup[]>([])
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(false)
  const [showTop, setShowTop] = useState(false)

  const typeIdRef = useRef(1)
  const filterUrlRef = useRef<string | null>(null)
  const nextUrlRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const filtersUnavailable = useRef(false)

  const pager = useVodPager(async (page, force): Promise<VodPage> => {
    const filterUrl = filterUrlRef.current
    if (!filterUrl) return fetchPage(page, typeIdRef.current, null, 12, force)
    if (page <= 1) {
      const result = await fetchFilterList(filterUrl, force)
      nextUrlRef.current = result.nextUrl
      return { items: result.items, page, hasMore: result.hasMore, total: result.total }
    }
    const next = nextUrlRef.current
    if (!next) return { items: [], page, hasMore: false, total: 0 }
    const result = await fetchFilterList(next)
    nextUrlRef.current = result.nextUrl
    return { items: result.items, page, hasMore: result.hasMore, total: result.total }
  })

  const topCategories = useMemo(() => categories.filter((c) => c.parentId === 0), [categories])
  const selectedTopId = useMemo(() => {
    const found = categories.find((c) => c.id === selectedId)
    return found ? (found.parentId === 0 ? found.id : found.parentId) : selectedId
  }, [categories, selectedId])
  const subCategories = useMemo(
    () => categories.filter((c) => c.parentId === selectedTopId),
    [categories, selectedTopId],
  )

  const loadFilters = async (typeId: number, force = false) => {
    if (!force && filtersUnavailable.current) return
    const result = await fetchFilterGroups(typeId, force)
    if (typeIdRef.current !== typeId) return
    if (result.length === 0) filtersUnavailable.current = true
    setGroups(result)
    // 字典缩水导致已选条件不存在时，回到「全部」，否则会停在一个点不亮任何 chip 的状态
    setSelection((prev) => {
      const next: Record<string, string> = {}
      for (const [label, name] of Object.entries(prev)) {
        if (result.some((g) => g.label === label && g.options.some((o) => o.name === name))) {
          next[label] = name
        }
      }
      return next
    })
  }

  useEffect(() => {
    pager.refresh()
    loadFilters(1)
    ;(async () => {
      try {
        const remote = await fetchCategories()
        if (remote.length === 0) return
        setCategories(remote)
        if (!remote.some((c) => c.id === selectedId) || remote.some((c) => c.parentId === selectedId)) {
          const target = remote.some((c) => c.id === selectedId)
            ? remote.find((c) => c.parentId === selectedId)?.id ?? selectedId
            : remote[0].id
          typeIdRef.current = target
          setSelectedId(target)
          pager.refresh()
          loadFilters(target)
        }
      } catch {
        /* 接口挂了就继续用兜底字典，不该出现一行空白 chips */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 筛选条件变化 → 重建筛选地址并重新拉第一页
  useEffect(() => {
    filterUrlRef.current = buildFilterUrl(selection, groups)
    nextUrlRef.current = null
    pager.refresh()
    scrollRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const selectCategory = (categoryId: number) => {
    // 两级分类源：选父分类自动落到第一个子分类（父 id 查询 API 基本是空的）
    const target = categories.find((c) => c.parentId === categoryId)?.id ?? categoryId
    if (target === selectedId) return
    typeIdRef.current = target
    setSelectedId(target)
    setSelection({})
    setGroups([])
    filterUrlRef.current = null
    nextUrlRef.current = null
    pager.refresh()
    scrollRef.current?.scrollTo({ top: 0 })
    loadFilters(target)
  }

  const pickFilter = (group: FilterGroup, name: string) => {
    setSelection((prev) => {
      const next = { ...prev }
      if (name === ALL_LABEL) delete next[group.label]
      else next[group.label] = name
      return next
    })
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setShowTop(el.scrollTop > 600)
    if (nearBottom(el, 700)) pager.loadNext()
  }

  const summary = Object.values(selection).join(' · ')

  return (
    <div className="flex h-full flex-col">
      <TabHeader title="分类" />

      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
        {topCategories.map((c) => (
          <Chip
            key={c.id}
            text={c.name}
            selected={c.id === selectedTopId}
            onClick={() => selectCategory(c.id)}
          />
        ))}
      </div>

      {subCategories.length > 0 && (
        <div className="mt-2 flex shrink-0 gap-[7px] overflow-x-auto px-4 no-scrollbar">
          {subCategories.map((c) => (
            <FilterChip
              key={c.id}
              text={c.name}
              selected={c.id === selectedId}
              onClick={() => selectCategory(c.id)}
            />
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-2.5 flex shrink-0 items-center px-4 py-1 text-left"
          >
            <Icon name="tune" size={15} className={summary ? 'text-brand' : 'text-muted'} />
            <span className={`ml-1.5 text-label-lg ${summary ? 'text-brand' : 'text-ink'}`}>筛选</span>
            {summary ? (
              <span className="ml-2 min-w-0 flex-1 truncate text-label-sm text-muted">{summary}</span>
            ) : (
              <span className="flex-1" />
            )}
            <span className="text-label-md text-muted">{expanded ? '收起' : '展开'}</span>
          </button>

          {expanded &&
            groups.map((group) => (
              <div key={group.label} className="mt-1.5 flex shrink-0 items-center">
                <span className="w-[46px] shrink-0 pl-4 text-label-sm text-muted">{group.label}</span>
                <div className="flex flex-1 gap-[7px] overflow-x-auto pr-4 no-scrollbar">
                  {group.options.map((option) => (
                    <FilterChip
                      key={option.name}
                      text={option.name}
                      selected={option.name === (selection[group.label] ?? ALL_LABEL)}
                      onClick={() => pickFilter(group, option.name)}
                    />
                  ))}
                </div>
              </div>
            ))}
        </>
      )}

      <div className="relative mt-2.5 min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto no-scrollbar">
          <div className="px-4 pb-7">
            {pager.items.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-x-[9px] gap-y-3">
                  {pager.items.map((vod) => (
                    <VodCard key={vod.id} vod={vod} onClick={() => navigate(`/detail/${vod.id}`)} />
                  ))}
                </div>
                {(pager.loading || pager.error) && (
                  <div className="flex h-[46px] items-center justify-center">
                    {pager.error ? (
                      <button
                        onClick={() => pager.loadNext()}
                        className="tap px-2 py-2 text-label-md text-muted"
                      >
                        加载失败，点击重试
                      </button>
                    ) : (
                      <span className="text-label-md text-muted">加载中…</span>
                    )}
                  </div>
                )}
              </>
            ) : pager.error ? (
              <ErrorBox message={pager.error} onRetry={() => pager.refresh()} />
            ) : pager.loading || pager.loadedPage === 0 ? (
              <SkeletonGrid columns={3} rows={3} className="pt-1" />
            ) : (
              <EmptyBox
                text={Object.keys(selection).length === 0 ? '这个分类还没有内容' : '没有符合条件的内容'}
              />
            )}
          </div>
        </div>

        {showTop && pager.items.length > 0 && (
          <BackToTopButton onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
        )}
      </div>
    </div>
  )
}

function Chip({ text, selected, onClick }: { text: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap shrink-0 rounded-2xl px-3.5 py-[7px] text-label-lg ${
        selected ? 'bg-brand text-white' : 'bg-surface-high text-ink'
      }`}
    >
      {text}
    </button>
  )
}

function FilterChip({ text, selected, onClick }: { text: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap shrink-0 rounded-[11px] px-[11px] py-[5px] text-label-md ${
        selected ? 'bg-brand/15 text-brand' : 'bg-surface-high text-ink'
      }`}
    >
      {text}
    </button>
  )
}
