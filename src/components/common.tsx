import { useState, type ReactNode } from 'react'
import { imgUrl } from '../lib/api'
import { metaLine as buildMeta, playbackText } from '../lib/parse'
import type { Vod } from '../lib/types'
import { Icon } from './icons'

/** 海报图。采集站的海报和主站同域，站挂则图全挂，所以占位与失败兜底必须有。 */
export function Poster({
  url,
  name,
  className = '',
  rounded = 'rounded-poster',
  ratio = 'aspect-[2/3]',
}: {
  url: string
  name: string
  className?: string
  rounded?: string
  ratio?: string
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <div className={`relative overflow-hidden bg-placeholder ${rounded} ${ratio} ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[22px] font-bold text-white/35">{name.slice(0, 1)}</span>
      </div>
      {url && state !== 'error' && (
        <img
          src={imgUrl(url)}
          alt={name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            state === 'ok' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}

/** 列表卡片：海报 + 两行片名 + 备注/评分角标。 */
export function VodCard({
  vod,
  onClick,
  showRemarks = true,
}: {
  vod: Vod
  onClick: () => void
  showRemarks?: boolean
}) {
  const meta = buildMeta(vod)
  return (
    <button onClick={onClick} className="tap w-full text-left">
      <div className="relative">
        <Poster url={vod.poster} name={vod.name} className="w-full" />
        {showRemarks && vod.remarks && (
          <span className="absolute bottom-1.5 right-1.5 max-w-[calc(100%-12px)] truncate rounded bg-black/60 px-1.5 py-px text-label-sm text-white">
            {vod.remarks}
          </span>
        )}
        {vod.score && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-px text-label-sm font-bold text-gold">
            {vod.score}
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-title-sm text-ink">{vod.name}</p>
      {meta && <p className="mt-0.5 truncate text-label-sm text-muted">{meta}</p>}
    </button>
  )
}

/** 横版卡片：继续观看用，16:9 + 播放圆钮 + 进度线。 */
export function WideVodCard({
  name,
  poster,
  subtitle,
  progress,
  onClick,
}: {
  name: string
  poster: string
  subtitle?: string
  progress?: number
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="tap w-full text-left">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-placeholder">
        {poster && (
          <img
            src={imgUrl(poster)}
            alt={name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-black/35 text-white">
            <Icon name="play" size={22} />
          </span>
        </div>
        {progress != null && progress > 0 && (
          <div className="absolute bottom-0 left-0 h-[3px] w-full bg-white/25">
            <div className="h-full bg-brand" style={{ width: `${Math.min(1, progress) * 100}%` }} />
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-title-sm text-ink">{name}</p>
      {subtitle && <p className="truncate text-label-sm text-muted">{subtitle}</p>}
    </button>
  )
}

/** 三个 Tab 页统一的标题栏：高度 56、左右 16、基线一致。 */
export function TabHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3.5 px-4">
      <h1 className="shrink-0 text-[22px] font-bold leading-[30px] text-ink">{title}</h1>
      {children}
    </div>
  )
}

/** 二级页顶栏：返回 + 标题 + 右侧操作槽位。 */
export function ScreenTopBar({
  title,
  onBack,
  right,
}: {
  title: string
  onBack?: () => void
  right?: ReactNode
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center px-1">
      {onBack ? (
        <button onClick={onBack} className="tap flex h-11 w-11 items-center justify-center text-ink">
          <Icon name="back" size={22} />
        </button>
      ) : (
        <div className="w-3" />
      )}
      <h1 className="flex-1 truncate text-title-md text-ink">{title}</h1>
      {right}
    </div>
  )
}

/** 区块标题：渐变竖条 + 标题 + 可选「更多 ›」。 */
export function SectionTitle({
  title,
  actionText,
  onAction,
  className = '',
}: {
  title: string
  actionText?: string
  onAction?: () => void
  className?: string
}) {
  return (
    <div className={`flex items-center px-4 py-2.5 ${className}`}>
      <span className="mr-2 h-[15px] w-[3px] rounded-sm hero-gradient" />
      <span className="flex-1 text-title-md text-ink">{title}</span>
      {actionText && onAction && (
        <button onClick={onAction} className="tap text-label-md text-muted">
          {actionText} ›
        </button>
      )}
    </div>
  )
}

export function LoadingBox({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex h-full min-h-[220px] w-full flex-col items-center justify-center">
      <span className="h-[26px] w-[26px] animate-spin rounded-full border-[2.5px] border-brand border-t-transparent" />
      <p className="mt-3 text-body-sm text-muted">{text}</p>
    </div>
  )
}

export function EmptyBox({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`flex h-full min-h-[200px] w-full flex-col items-center justify-center ${className}`}>
      <Icon name="movie" size={44} className="text-muted/50" />
      <p className="mt-2.5 text-body-md text-muted">{text}</p>
    </div>
  )
}

export function ErrorBox({
  message,
  onRetry,
  className = '',
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div className={`flex h-full min-h-[200px] w-full flex-col items-center justify-center px-8 ${className}`}>
      <Icon name="offline" size={44} className="text-muted/60" />
      <p className="mt-3 text-center text-body-md text-muted">{message}</p>
      <button onClick={onRetry} className="tap mt-1 px-3 py-2 text-label-lg text-brand">
        重试
      </button>
    </div>
  )
}

/** 整屏骨架：切分类/进页面时先占位，避免「空白 → 突然一片卡片」的跳变。 */
export function SkeletonGrid({ columns = 3, rows = 3, className = '' }: { columns?: number; rows?: number; className?: string }) {
  return (
    <div
      className={`grid gap-x-[9px] gap-y-3.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: columns * rows }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] w-full animate-shimmer rounded-poster bg-surface-variant" />
          <div className="mt-2 h-2.5 w-[82%] animate-shimmer rounded bg-surface-variant" />
          <div className="mt-1.5 h-2 w-1/2 animate-shimmer rounded bg-surface-variant" />
        </div>
      ))}
    </div>
  )
}

export function BackToTopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="回到顶部"
      className="tap absolute bottom-5 right-4 flex h-[42px] w-[42px] items-center justify-center rounded-full bg-surface-high/95 text-brand shadow-lg backdrop-blur"
    >
      <Icon name="up" size={20} />
    </button>
  )
}

export function DownloadedBadge({ light = false }: { light?: boolean }) {
  return (
    <Icon
      name="check"
      size={11}
      className={`shrink-0 ${light ? 'text-white/90' : 'text-brand'}`}
    />
  )
}

/** 主行动按钮（播放 / 下载），渐变底。 */
export function PrimaryActionButton({
  text,
  icon = 'play',
  onClick,
  disabled,
  className = '',
}: {
  text: string
  icon?: 'play' | 'download'
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`tap flex h-11 items-center justify-center gap-1.5 rounded-[22px] px-5 text-title-sm text-white ${
        disabled
          ? 'bg-gradient-to-r from-gray-500 to-gray-700 opacity-60'
          : 'hero-gradient shadow-[0_6px_18px_-8px_var(--brand)]'
      } ${className}`}
    >
      <Icon name={icon} size={19} />
      <span className="truncate">{text}</span>
    </button>
  )
}

export function RoundIconButton({
  name,
  label,
  onClick,
  size = 40,
  className = '',
  iconSize,
}: {
  name: 'heart' | 'heartOutline' | 'download' | 'close' | 'more'
  label: string
  onClick: () => void
  size?: number
  className?: string
  iconSize?: number
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`tap flex shrink-0 items-center justify-center rounded-full ${className}`}
    >
      <Icon name={name} size={iconSize ?? Math.round(size * 0.55)} />
    </button>
  )
}

export function ThinProgressBar({ value, height = 3 }: { value: number; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-divider" style={{ height }}>
      <div
        className="h-full bg-brand transition-[width] duration-200"
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
      />
    </div>
  )
}

/** 设置项开关：沿用 Material 的尺寸比例，但颜色跟着品牌色走。 */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors ${
        checked ? 'bg-brand' : 'bg-surface-high'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

/** 三选一分段控件（外观模式）。 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex w-full rounded-[10px] bg-surface-high p-[3px]">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`tap flex-1 rounded-lg py-2 text-center text-label-md ${
              active ? 'bg-brand text-white' : 'text-muted'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** 观看进度文案：「看到 12:30 · 第3集」。 */
export function continueHint(episodeName: string, episodeIndex: number, positionMs: number) {
  const ep = episodeName || `第${episodeIndex + 1}集`
  return `看到 ${playbackText(positionMs)} · ${ep}`
}
