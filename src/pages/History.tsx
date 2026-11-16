import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { clearHistory, removeHistory } from '../lib/repo'
import { historyTimeLabel, isFinished, playbackText } from '../lib/parse'
import { Icon } from '../components/icons'
import { EmptyBox, Poster, ScreenTopBar } from '../components/common'
import { PageShell, useGoBack } from '../App'

export default function History() {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const rows = useLiveQuery(() => db.history.orderBy('updatedAt').reverse().toArray(), [], [])
  const [confirming, setConfirming] = useState(false)

  return (
    <PageShell>
      <div className="flex h-full flex-col bg-bg">
        <ScreenTopBar
          title="观看历史"
          onBack={goBack}
          right={
            rows.length > 0 ? (
              <button
                onClick={() => setConfirming(true)}
                className="tap px-3 py-2 text-label-md text-muted"
              >
                清空
              </button>
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {rows.length === 0 ? (
            <EmptyBox text="还没有观看记录" className="h-[60vh]" />
          ) : (
            <div className="pb-7">
              {rows.map((record) => {
                const episode = record.episodeName || `第${record.episodeIndex + 1}集`
                const progress =
                  record.durationMs > 0 ? Math.min(1, record.positionMs / record.durationMs) : 0
                return (
                  <div key={record.vodId} className="flex items-center px-3 py-2.5">
                    <button
                      onClick={() => navigate(`/detail/${record.vodId}`)}
                      className="tap relative w-[96px] shrink-0"
                    >
                      <Poster
                        url={record.poster}
                        name={record.name}
                        ratio="aspect-video"
                        rounded="rounded-[9px]"
                      />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-white">
                          <Icon name="play" size={16} />
                        </span>
                      </span>
                      <span className="absolute bottom-0 left-0 h-[3px] w-full bg-white/25">
                        <span className="block h-full bg-brand" style={{ width: `${progress * 100}%` }} />
                      </span>
                    </button>
                    <button
                      onClick={() => navigate(`/player/${record.vodId}`)}
                      className="tap min-w-0 flex-1 px-3 text-left"
                    >
                      <p className="truncate text-body-lg font-semibold text-ink">{record.name}</p>
                      <p className="truncate text-body-sm text-muted">
                        {isFinished(record)
                          ? `${episode} · 已看完`
                          : `${episode} · 看到 ${playbackText(record.positionMs)}`}
                      </p>
                      <p className="truncate text-label-sm text-muted">
                        {historyTimeLabel(record.updatedAt)}
                      </p>
                    </button>
                    <button
                      onClick={() => removeHistory(record.vodId)}
                      aria-label="删除"
                      className="tap flex h-10 w-10 shrink-0 items-center justify-center text-muted"
                    >
                      <Icon name="trash" size={19} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-10">
          <div className="w-full max-w-[340px] rounded-2xl bg-surface-high p-5">
            <h3 className="text-title-md text-ink">清空观看历史？</h3>
            <p className="mt-2 text-body-sm text-muted">清空后所有续播进度都会丢失，且无法恢复。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  await clearHistory()
                  setConfirming(false)
                }}
                className="tap rounded-lg px-3 py-2 text-label-lg text-danger"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
