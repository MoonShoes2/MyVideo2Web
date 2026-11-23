import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchPage, hotWords } from '../lib/repo'
import { addSearchKeyword, clearSearchHistory, loadSearchHistory } from '../lib/searchHistory'
import { useVodPager, nearBottom } from '../lib/usePager'
import { Icon } from '../components/icons'
import { EmptyBox, ErrorBox, LoadingBox, VodCard } from '../components/common'
import { useGoBack } from '../App'

export default function Search() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [keywords, setKeywords] = useState<string[]>(() => loadSearchHistory())
  const [hot, setHot] = useState<string[]>([])
  const [showResults, setShowResults] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef('')

  const pager = useVodPager((page, force) =>
    fetchPage(page, null, queryRef.current, 12, force),
  )

  useEffect(() => {
    inputRef.current?.focus()
    hotWords(10).then(setHot).catch(() => undefined)
  }, [])

  const submit = (keyword?: string) => {
    const q = (keyword ?? input).trim()
    if (!q) return
    if (keyword != null) setInput(q)
    setKeywords(addSearchKeyword(q))
    queryRef.current = q
    setQuery(q)
    setShowResults(true)
    pager.refresh()
    inputRef.current?.blur()
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (el && nearBottom(el, 600)) pager.loadNext()
  }

  return (
    <div className="app-shell">
      <div className="flex shrink-0 items-center pl-1 pr-3 pb-2 pt-1.5">
        <button onClick={goBack} className="tap flex h-11 w-11 items-center justify-center text-ink">
          <Icon name="back" size={22} />
        </button>
        <div className="flex h-10 flex-1 items-center rounded-[20px] bg-surface-high px-3">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="搜索影片名"
            className="ml-2 min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-muted"
          />
          {input && (
            <button
              onClick={() => setInput('')}
              aria-label="清除"
              className="tap flex h-[26px] w-[26px] items-center justify-center text-muted"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {!showResults ? (
          <div className="pb-8">
            <section className="px-4">
              <div className="flex items-center py-2">
                <Icon name="history" size={16} className="text-muted" />
                <span className="ml-1.5 flex-1 text-title-sm text-ink">搜索历史</span>
                {keywords.length > 0 && (
                  <button
                    onClick={() => setKeywords(clearSearchHistory())}
                    className="tap px-0.5 py-1 text-label-md text-muted"
                  >
                    清空
                  </button>
                )}
              </div>
              {keywords.length === 0 ? (
                <p className="pt-2 text-body-sm text-muted">还没有搜索过影片</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((k) => (
                    <button
                      key={k}
                      onClick={() => submit(k)}
                      className="tap max-w-[220px] truncate rounded-2xl bg-surface-high px-3.5 py-[7px] text-body-sm text-ink"
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {hot.length > 0 && <HotSection words={hot} onPick={submit} />}
          </div>
        ) : (
          <div className="min-h-full">
            {pager.loading && pager.items.length === 0 ? (
              <LoadingBox />
            ) : pager.error && pager.items.length === 0 ? (
              <ErrorBox message={pager.error} onRetry={() => pager.refresh()} />
            ) : pager.items.length === 0 && !pager.loading ? (
              <EmptyBox text={`没有找到「${query}」相关的影片`} />
            ) : (
              <div className="px-3 pb-6">
                <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
                  {pager.items.map((vod) => (
                    <VodCard
                      key={vod.id}
                      vod={vod}
                      showRemarks={false}
                      onClick={() => navigate(`/detail/${vod.id}`)}
                    />
                  ))}
                </div>
                <div className="flex h-12 items-center justify-center">
                  {pager.loadingMore ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  ) : pager.error ? (
                    <button onClick={() => pager.loadNext()} className="tap px-2 py-2 text-body-sm text-brand">
                      加载失败，点击重试
                    </button>
                  ) : pager.endReached && pager.items.length > 0 ? (
                    <span className="text-body-sm text-muted">没有更多了</span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function HotSection({ words, onPick }: { words: string[]; onPick: (w: string) => void }) {
  const perColumn = Math.ceil(words.length / 2)
  const columns = [words.slice(0, perColumn), words.slice(perColumn)]
  return (
    <section className="px-4">
      <div className="flex items-center pb-2 pt-[18px]">
        <Icon name="fire" size={16} className="text-[#F4511E]" />
        <span className="ml-1.5 text-title-sm text-ink">热门搜索</span>
      </div>
      <div className="flex gap-3">
        {columns.map((column, ci) => (
          <div key={ci} className="flex-1">
            {column.map((word, ri) => {
              const rank = ci * perColumn + ri + 1
              const top3 = rank <= 3
              return (
                <button
                  key={word}
                  onClick={() => onPick(word)}
                  className="tap flex w-full items-center py-[9px] text-left"
                >
                  <span
                    className={`w-4 shrink-0 text-right text-label-md ${
                      top3 ? 'font-bold text-[#F4511E]' : 'text-muted'
                    }`}
                  >
                    {rank}
                  </span>
                  <span
                    className={`ml-2 min-w-0 flex-1 truncate text-body-md text-ink ${
                      top3 ? 'font-semibold' : ''
                    }`}
                  >
                    {word}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
