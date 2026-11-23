import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { imgUrl } from '../lib/api'
import { clearHistory, removeHistory } from '../lib/repo'
import { playbackText, progressOf } from '../lib/parse'
import { Icon } from '../components/icons'
import { EmptyBox, ScreenTopBar, ThinProgressBar } from '../components/common'
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
                className="tap px-3 py-2 text-label-md text-danger"
              >
                清空
              </button>
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto pt-1 no-scrollbar">
          {rows.length === 0 ? (
            <EmptyBox text="还没有观看记录" className="h-[60vh]" />
          ) : (
            <div className="pb-4">
              {rows.map((record) => {
                const progress = progressOf(record)
                return (
                  <div key={record.vodId}>
                    <div
                      className="flex cursor-pointer items-center px-4 py-3"
                      onClick={() => navigate(`/player/${record.vodId}`)}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/detail/${record.vodId}`)
                        }}
                        className="tap h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-placeholder"
                      >
                        {record.poster && (
                          <img
                            src={imgUrl(record.poster)}
                            alt={record.name}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </button>
                      <div className="ml-3 min-w-0 flex-1">
                        <p className="truncate text-title-sm text-ink">{record.name}</p>
                        <p className="mt-0.5 truncate text-label-sm text-muted">
                          {record.episodeName || '第1集'}
                        </p>
                        <p className="mt-[3px] truncate text-label-sm text-muted">
                          看到 {playbackText(record.positionMs)} / {playbackText(record.durationMs)}
                        </p>
                        {progress > 0.01 && (
                          <div className="mt-1.5">
                            <ThinProgressBar value={progress} />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void removeHistory(record.vodId)
                        }}
                        aria-label="删除记录"
                        className="tap ml-2 flex h-7 w-7 shrink-0 items-center justify-center text-muted"
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </div>
                    <div className="ml-[124px] h-px bg-divider" />
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
            <h3 className="text-title-md text-ink">清空观看历史</h3>
            <p className="mt-2 text-body-md text-muted">
              清空后将无法从上次进度继续播放，确定清空吗？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="tap rounded-lg px-3 py-2 text-label-lg text-muted"
              >
                取消
              </button>
              <button
                onClick={() => {
                  void clearHistory()
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
