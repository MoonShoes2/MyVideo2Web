import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import type { Vod } from '../lib/types'
import { EmptyBox, Poster, ScreenTopBar } from '../components/common'
import { PageShell, useGoBack } from '../App'

export default function Favorites() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const rows = useLiveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray(), [], [])

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar
          title={`我的收藏${rows.length ? `（${rows.length}）` : ''}`}
          onBack={goBack}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 no-scrollbar">
          {rows.length === 0 ? (
            <EmptyBox text="还没有收藏任何影片" className="h-[60vh]" />
          ) : (
            <div className="grid grid-cols-3 gap-x-[9px] gap-y-3">
              {rows.map((row) => (
                <button
                  key={row.vodId}
                  onClick={() => navigate(`/detail/${row.vodId}`)}
                  className="tap text-left"
                >
                  <div className="relative">
                    <Poster url={row.poster} name={row.name} className="w-full" />
                    {row.remarks && (
                      <span className="absolute bottom-1.5 right-1.5 max-w-[calc(100%-12px)] truncate rounded bg-black/60 px-1.5 py-px text-label-sm text-white">
                        {row.remarks}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-title-sm text-ink">{row.name}</p>
                  {row.meta && <p className="truncate text-label-sm text-muted">{row.meta}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}

/** 收藏/历史里只需要卡片字段，这里拼回 Vod 形态给卡片组件复用。 */
export function toLiteVod(row: { vodId?: number; id?: number; name: string; poster: string; remarks: string }): Vod {
  return {
    id: row.vodId ?? row.id ?? 0,
    name: row.name,
    poster: row.poster,
    remarks: row.remarks,
    year: '',
    area: '',
    language: '',
    categoryName: '',
    tags: [],
    actors: [],
    director: '',
    score: null,
    summary: '',
    updatedAt: '',
    totalEpisodes: 0,
    playFrom: '',
    playUrls: '',
  }
}
