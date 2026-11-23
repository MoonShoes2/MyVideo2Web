import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { removeFavorite } from '../lib/repo'
import type { FavoriteRecord } from '../lib/types'
import { Icon } from '../components/icons'
import { EmptyBox, Poster, ScreenTopBar } from '../components/common'
import { PageShell, useGoBack } from '../App'

export default function Favorites() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const rows = useLiveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray(), [], [])
  const [pendingDelete, setPendingDelete] = useState<FavoriteRecord | null>(null)

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar title="我的收藏" onBack={goBack} />
        <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pb-7 pt-2 no-scrollbar">
          {rows.length === 0 ? (
            <EmptyBox text="还没有收藏任何影片" className="h-[60vh]" />
          ) : (
            <div className="grid grid-cols-3 gap-x-[10px] gap-y-[14px]">
              {rows.map((row) => (
                <button
                  key={row.vodId}
                  onClick={() => navigate(`/detail/${row.vodId}`)}
                  className="tap block text-left"
                >
                  <div className="relative">
                    <Poster url={row.poster} name={row.name} className="w-full" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDelete(row)
                      }}
                      aria-label="取消收藏"
                      className="tap absolute right-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/55 text-white"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-title-sm text-ink">{row.name}</p>
                  {row.remarks && (
                    <p className="mt-0.5 truncate text-label-sm text-muted">{row.remarks}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-10">
          <div className="w-full max-w-[340px] rounded-2xl bg-surface-high p-5">
            <h3 className="text-title-md text-ink">取消收藏</h3>
            <p className="mt-2 text-body-md text-muted">
              确定把《{pendingDelete.name}》从收藏中移除吗？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              >
                取消
              </button>
              <button
                onClick={() => {
                  void removeFavorite(pendingDelete.vodId)
                  setPendingDelete(null)
                }}
                className="tap rounded-lg px-3 py-2 text-label-lg text-danger"
              >
                移除
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
