import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import { db } from '../lib/db'
import { hlsUrl } from '../lib/api'
import {
  cachedDetail,
  fetchDetail,
  getHistory,
  saveProgress,
  toggleFavorite,
  trimHistory,
} from '../lib/repo'
import {
  formatSpeed,
  parsePlaySources,
  playbackText,
  progressOf,
  sourceDisplayName,
} from '../lib/parse'
import { offlineVod } from '../lib/downloads'
import { resolveAdRanges, inRange, type AdRange } from '../lib/ads'
import { getSettings, SPEED_OPTIONS, useSettings } from '../lib/settings'
import type { PlaySource, Vod } from '../lib/types'
import { Icon } from '../components/icons'
import { DownloadedBadge } from '../components/common'

const BOOST_SPEED = 2
const BOOST_DELAY_MS = 450
const CONTROLS_AUTO_HIDE_MS = 4000
const PROGRESS_SAVE_INTERVAL_MS = 5000
const SCREEN_SEEK_SPAN_MS = 5 * 60_000
const MIN_BRIGHTNESS = 0.02

interface Hud {
  type: 'brightness' | 'volume'
  value: number
}

export default function Player() {
  const { vodId: vodIdParam } = useParams()
  const vodId = Number(vodIdParam)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const settings = useSettings()

  const [vod, setVod] = useState<Vod | null>(null)
  const [sources, setSources] = useState<PlaySource[]>([])
  const [sourceIndex, setSourceIndex] = useState(0)
  const [episodeIndex, setEpisodeIndex] = useState(0)
  const [startPositionMs, setStartPositionMs] = useState(0)
  const [playToken, setPlayToken] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [bufferedMs, setBufferedMs] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [locked, setLocked] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const [hud, setHud] = useState<Hud | null>(null)
  const [pulse, setPulse] = useState<{ playing: boolean; seq: number } | null>(null)
  const [brightness, setBrightness] = useState(1)
  const [seekPreview, setSeekPreview] = useState<number | null>(null)
  const [adRanges, setAdRanges] = useState<AdRange[]>([])
  const [adSkipping, setAdSkipping] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  const [downloaded, setDownloaded] = useState<Record<number, number[]>>({})
  const [watched, setWatched] = useState<Record<number, Record<number, number>>>({})

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const positionRef = useRef(0)
  const durationRef = useRef(0)
  const stateRef = useRef({ sourceIndex: 0, episodeIndex: 0, vod: null as Vod | null, sources: [] as PlaySource[] })
  const hideTimer = useRef<number | null>(null)
  const hudTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  const source = sources[sourceIndex]
  const episode = source?.episodes[episodeIndex]
  const hasNext = (source?.episodes.length ?? 0) > episodeIndex + 1
  const displayPosition = seekPreview ?? positionMs

  stateRef.current = { sourceIndex, episodeIndex, vod, sources }

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }, [])

  // ── 初始加载：最新的直链 → 下载索引 → 详情缓存，三级兜底 ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      trimHistory().catch(() => undefined)
      let detail: Vod | null = null
      try {
        detail = await fetchDetail(vodId, true)
      } catch (e) {
        detail = (await offlineVod(vodId).catch(() => null)) ?? (await cachedDetail(vodId).catch(() => null))
        if (!detail && alive) {
          setLoadError((e as Error).message || '加载失败')
          setLoading(false)
          return
        }
      }
      if (!alive || !detail) return
      // 网页线路播放器放不了，直接剔除；可播线路下标与详情页一致
      const parsed = parsePlaySources(detail.playFrom, detail.playUrls).filter((s) => !s.webOnly)
      if (parsed.length === 0) {
        setVod(detail)
        setLoadError('该影片暂无可用播放源')
        setLoading(false)
        return
      }
      const history = await getHistory(vodId).catch(() => null)
      const pSource = Number(params.get('source'))
      const pEpisode = Number(params.get('episode'))
      const si = Math.min(Math.max(Number.isFinite(pSource) && pSource >= 0 ? pSource : history?.sourceIndex ?? 0, 0), parsed.length - 1)
      const eps = parsed[si].episodes
      const ei = Math.min(
        Math.max(Number.isFinite(pEpisode) && pEpisode >= 0 ? pEpisode : history?.episodeIndex ?? 0, 0),
        eps.length - 1,
      )
      const sameEpisode =
        history != null && history.sourceIndex === si && history.episodeIndex === ei
      const finished = history != null && history.durationMs > 0 && history.positionMs >= (history.durationMs * 95) / 100
      setVod(detail)
      setSources(parsed)
      setSourceIndex(si)
      setEpisodeIndex(ei)
      setStartPositionMs(sameEpisode && !finished ? history!.positionMs : 0)
      setSpeed(getSettings().defaultSpeed)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vodId])

  useEffect(() => {
    db.favorites.get(vodId).then((row) => setFavorite(row != null))
    db.episodeHistory
      .where('vodId')
      .equals(vodId)
      .toArray()
      .then((rows) => {
        const map: Record<number, Record<number, number>> = {}
        rows.forEach((r) => {
          map[r.sourceIndex] = { ...(map[r.sourceIndex] ?? {}), [r.episodeIndex]: progressOf(r) }
        })
        setWatched(map)
      })
    const loadDownloads = () =>
      db.downloads
        .where('vodId')
        .equals(vodId)
        .toArray()
        .then((rows) => {
          const map: Record<number, number[]> = {}
          rows
            .filter((t) => t.state === 'completed')
            .forEach((t) => {
              map[t.sourceIndex] = [...(map[t.sourceIndex] ?? []), t.episodeIndex]
            })
          setDownloaded(map)
        })
    loadDownloads()
  }, [vodId])

  // ── 挂载 hls.js（或原生 HLS） ──
  useEffect(() => {
    const video = videoRef.current
    const url = episode?.url
    if (!video || !url) return

    hlsRef.current?.destroy()
    hlsRef.current = null
    setBuffering(false)
    setPositionMs(0)
    setDurationMs(0)
    setSeekPreview(null)

    const startAt = startPositionMs / 1000
    const onMeta = () => {
      if (startAt > 0 && Math.abs(video.currentTime - startAt) > 1) video.currentTime = startAt
      video.playbackRate = speed
      video.play().catch(() => setNeedsTap(true))
    }
    video.addEventListener('loadedmetadata', onMeta, { once: true })

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 30, backBufferLength: 30 })
      hlsRef.current = hls
      hls.loadSource(hlsUrl(url))
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.playbackRate = speed
        video.play().catch(() => setNeedsTap(true))
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else {
          setLoadError('播放失败，请切换线路或稍后重试')
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl(url)
      video.play().catch(() => setNeedsTap(true))
    } else {
      setLoadError('当前浏览器不支持 HLS 播放')
    }

    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.url, playToken])

  // ── 播放器事件 ──
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      positionRef.current = video.currentTime * 1000
      setPositionMs(video.currentTime * 1000)
      if (video.buffered.length > 0) {
        setBufferedMs(video.buffered.end(video.buffered.length - 1) * 1000)
      }
    }
    const onDuration = () => {
      durationRef.current = Number.isFinite(video.duration) ? video.duration * 1000 : 0
      setDurationMs(durationRef.current)
    }
    const onPlay = () => {
      setPlaying(true)
      setNeedsTap(false)
    }
    const onPause = () => setPlaying(false)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onError = () => {
      if (!hlsRef.current) setLoadError('播放失败，请切换线路或稍后重试')
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('loadedmetadata', onDuration)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('loadedmetadata', onDuration)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }
  }, [])

  // 倍速跟随设置/用户选择
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  // ── 进度保存：每 5 秒一次，切集/退出时补一次 ──
  const persistProgress = useCallback(() => {
    const { vod: currentVod, sources: currentSources, sourceIndex: si, episodeIndex: ei } = stateRef.current
    const video = videoRef.current
    if (!currentVod || !video) return
    const src = currentSources[si]
    const ep = src?.episodes[ei]
    if (!src || !ep) return
    const position = video.currentTime * 1000
    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0
    if (position <= 0 || duration <= 0) return
    saveProgress({
      vod: currentVod,
      sourceIndex: si,
      sourceName: src.name,
      episodeIndex: ei,
      episodeName: ep.name,
      positionMs: position,
      durationMs: duration,
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(persistProgress, PROGRESS_SAVE_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      persistProgress()
    }
  }, [persistProgress])

  // ── 广告区间 ──
  useEffect(() => {
    setAdRanges([])
    setAdSkipping(false)
    const url = episode?.url
    if (!url || !settings.skipAds) return
    let alive = true
    let attempt = 0
    let timer = 0
    const run = async () => {
      const ranges = await resolveAdRanges(url)
      if (!alive) return
      if (ranges != null) {
        setAdRanges(ranges)
        return
      }
      if (++attempt > 5) return
      timer = window.setTimeout(run, 3000 * attempt)
    }
    run()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [episode?.url, settings.skipAds])

  // 播到广告区间就跳过去（不重写播放列表，总时长不变）
  useEffect(() => {
    if (adRanges.length === 0) return
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused || video.seeking) return
      const pos = video.currentTime * 1000
      const range = inRange(adRanges, pos)
      if (!range) return
      setAdSkipping(true)
      video.currentTime = Math.min((range.endMs + 250) / 1000, video.duration || Infinity)
      window.setTimeout(() => setAdSkipping(false), 700)
    }, 200)
    return () => window.clearInterval(timer)
  }, [adRanges])

  // ── 控制层自动隐藏 ──
  const bumpControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      setControlsVisible(false)
      setSpeedMenuOpen(false)
    }, CONTROLS_AUTO_HIDE_MS)
  }, [])

  useEffect(() => {
    if (!controlsVisible || locked || panelOpen || speedMenuOpen) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      return
    }
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_AUTO_HIDE_MS)
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [controlsVisible, locked, panelOpen, speedMenuOpen, playing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        video.currentTime = Math.max(0, video.currentTime - 5)
        bumpControls()
      } else if (e.key === 'ArrowRight') {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
        bumpControls()
      } else if (e.key === 'ArrowUp') {
        video.volume = Math.min(1, video.volume + 0.1)
        setHud({ type: 'volume', value: video.volume })
        bumpControls()
      } else if (e.key === 'ArrowDown') {
        video.volume = Math.max(0, video.volume - 0.1)
        setHud({ type: 'volume', value: video.volume })
        bumpControls()
      } else if (e.key === 'm') {
        video.muted = !video.muted
        showToast(video.muted ? '已静音' : '已取消静音')
      } else if (e.key === 'f') {
        toggleFullscreen()
      } else if (e.key === 'Escape') {
        if (panelOpen) setPanelOpen(false)
        else if (speedMenuOpen) setSpeedMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, speedMenuOpen])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => undefined)
    else video.pause()
    bumpControls()
  }

  const toggleFullscreen = () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else el.requestFullscreen?.().catch(() => undefined)
  }

  const jumpTo = (si: number, ei: number, resumeMs = 0) => {
    const src = sources[si]
    const ep = src?.episodes[ei]
    if (!src || !ep) return
    // 一换集就把「看到哪」落到新一集，离线加载失败也不会停在上一集
    if (vod) {
      saveProgress({
        vod,
        sourceIndex: si,
        sourceName: src.name,
        episodeIndex: ei,
        episodeName: ep.name,
        positionMs: resumeMs,
        durationMs: 0,
      }).catch(() => undefined)
    }
    setSourceIndex(si)
    setEpisodeIndex(ei)
    setStartPositionMs(resumeMs)
    setPlayToken((t) => t + 1)
    setPanelOpen(false)
    setLoadError(null)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    bumpControls()
  }

  const nextEpisode = (auto = false) => {
    if (!hasNext) {
      if (!auto) showToast('已经是最后一集')
      return
    }
    jumpTo(sourceIndex, episodeIndex + 1)
  }

  const onEnded = () => {
    persistProgress()
    if (settings.autoPlayNext && hasNext) {
      nextEpisode(true)
      return
    }
    setControlsVisible(true)
  }

  // ── 手势 ──
  const gesture = useRef({
    down: false,
    startX: 0,
    startY: 0,
    totalX: 0,
    totalY: 0,
    axis: null as null | 'seek' | 'vertical',
    baseBrightness: 1,
    baseVolume: 1,
    seekBase: 0,
    boosted: false,
    ignore: false,
    lastTap: 0,
    singleTapTimer: 0,
    longPressTimer: 0,
  })

  const clearHudLater = () => {
    if (hudTimer.current) window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => setHud(null), 700)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return
    const video = videoRef.current
    if (!video) return
    const g = gesture.current
    g.down = true
    g.startX = e.clientX
    g.startY = e.clientY
    g.totalX = 0
    g.totalY = 0
    g.axis = null
    g.boosted = false
    g.ignore = false
    g.baseBrightness = brightness
    g.baseVolume = video.volume
    g.seekBase = video.currentTime * 1000
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    if (g.longPressTimer) window.clearTimeout(g.longPressTimer)
    g.longPressTimer = window.setTimeout(() => {
      if (!g.down) return
      g.boosted = true
      g.axis = null
      setSeekPreview(null)
      setHud(null)
      if (video.paused) video.play().catch(() => undefined)
      video.playbackRate = BOOST_SPEED
    }, BOOST_DELAY_MS)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const video = videoRef.current
    if (!g.down || !video || g.boosted || g.ignore) return
    const rect = e.currentTarget.getBoundingClientRect()
    g.totalX = e.clientX - g.startX
    g.totalY = e.clientY - g.startY
    if (!g.axis && (Math.abs(g.totalX) > 18 || Math.abs(g.totalY) > 18)) {
      g.axis = Math.abs(g.totalX) > Math.abs(g.totalY) ? 'seek' : 'vertical'
      if (g.longPressTimer) window.clearTimeout(g.longPressTimer)
    }
    if (g.axis === 'seek') {
      const span = Math.min(durationMs, SCREEN_SEEK_SPAN_MS)
      if (span <= 0) return
      const delta = (g.totalX / rect.width) * span
      const target = Math.min(Math.max(g.seekBase + delta, 0), durationMs)
      setSeekPreview(target)
    } else if (g.axis === 'vertical') {
      const fraction = -g.totalY / rect.height
      if (e.clientX - rect.left < rect.width / 2) {
        const value = Math.min(1, Math.max(MIN_BRIGHTNESS, g.baseBrightness + fraction))
        setBrightness(value)
        setHud({ type: 'brightness', value })
        clearHudLater()
      } else {
        const value = Math.min(1, Math.max(0, g.baseVolume + fraction))
        video.volume = value
        setHud({ type: 'volume', value })
        clearHudLater()
      }
    }
  }

  const onPointerUp = (_e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const video = videoRef.current
    if (!video) return
    if (g.longPressTimer) window.clearTimeout(g.longPressTimer)
    g.down = false

    if (g.boosted) {
      g.boosted = false
      video.playbackRate = speed
      setControlsVisible(false)
      // 长按抬手后紧跟的一下点击不能算双击
      g.lastTap = Date.now()
      return
    }

    if (g.axis === 'seek' && seekPreview != null) {
      video.currentTime = seekPreview / 1000
      setPositionMs(seekPreview)
      setSeekPreview(null)
      g.axis = null
      return
    }
    if (g.axis === 'vertical') {
      g.axis = null
      return
    }
    if (g.ignore) {
      g.ignore = false
      return
    }

    // 单击 / 双击判定：双击播放暂停，单击显隐控制层
    const now = Date.now()
    if (now - g.lastTap < 300) {
      if (g.singleTapTimer) window.clearTimeout(g.singleTapTimer)
      g.lastTap = 0
      const willPlay = video.paused
      if (willPlay) video.play().catch(() => undefined)
      else video.pause()
      setPulse({ playing: willPlay, seq: now })
      window.setTimeout(() => setPulse(null), 640)
      return
    }
    g.lastTap = now
    {
      g.singleTapTimer = window.setTimeout(() => {
        setControlsVisible((v) => !v)
        bumpControls()
      }, 260)
    }
  }

  // 点击底部控制条时不要把控制层收掉
  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientY - rect.top > rect.height - 110) return
    onPointerDown(e)
  }

  const seekTo = (ms: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = ms / 1000
    setPositionMs(ms)
  }

  if (loadError && !vod) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black px-10 text-center">
        <Icon name="offline" size={46} className="text-white/55" />
        <p className="mt-3 text-body-md text-white/70">{loadError}</p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => navigate(-1)}
            className="tap rounded-lg bg-white/10 px-4 py-2 text-label-lg text-white"
          >
            返回
          </button>
          <button
            onClick={() => window.location.reload()}
            className="tap rounded-lg bg-brand px-4 py-2 text-label-lg text-white"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 select-none bg-black"
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        playsInline
        onEnded={onEnded}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          const d = Number.isFinite(v.duration) ? v.duration * 1000 : 0
          setDurationMs(d)
          if (startPositionMs > 0 && Math.abs(v.currentTime - startPositionMs / 1000) > 1) {
            v.currentTime = startPositionMs / 1000
          }
        }}
        onDoubleClick={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      />

      {/* 亮度遮罩：网页改不了屏幕背光，用一层黑幕等价表达「画面变暗」 */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity"
        style={{ opacity: 1 - brightness }}
      />

      {pulse && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse-icon flex h-[76px] w-[76px] items-center justify-center rounded-full bg-black/45 text-white">
            <Icon name={pulse.playing ? 'play' : 'pause'} size={38} />
          </div>
        </div>
      )}

      {hud && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center rounded-xl bg-black/72 px-5 py-3.5 text-white">
            <Icon name={hud.type === 'brightness' ? 'brightness' : 'volume'} size={24} />
            <div className="mt-2 h-[3px] w-[110px] overflow-hidden rounded-full bg-white/30">
              <div className="h-full bg-white" style={{ width: `${hud.value * 100}%` }} />
            </div>
            <span className="mt-1.5 text-label-md">{Math.round(hud.value * 100)}%</span>
          </div>
        </div>
      )}

      {needsTap && !playing && !loadError && (
        <button
          onClick={() => {
            setNeedsTap(false)
            videoRef.current?.play().catch(() => setNeedsTap(true))
          }}
          className="tap absolute inset-0 z-10 flex items-center justify-center"
          aria-label="播放"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white shadow-lg">
            <Icon name="play" size={30} />
          </span>
        </button>
      )}

      {buffering && !loadError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/80 border-t-transparent" />
        </div>
      )}

      {adSkipping && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
          <span className="rounded-lg bg-black/70 px-3 py-1.5 text-label-lg text-white">正在跳过广告…</span>
        </div>
      )}

      {/* 手势层：控制条区域除外，底部留给自己 */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current.down = false
          gesture.current.boosted = false
          setSeekPreview(null)
        }}
      />

      {!loading && (
        <>
          <div
            className={`absolute inset-x-0 top-0 transition-opacity duration-200 ${
              controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <PlayerTopBar
              title={vod?.name ?? ''}
              episodeName={episode?.name ?? ''}
              locked={locked}
              onBack={() => {
                persistProgress()
                navigate(-1)
              }}
              onToggleLock={() => {
                setLocked((v) => !v)
                setControlsVisible(true)
                showToast(locked ? '已解锁' : '已锁定，点击右上角解锁')
              }}
              onFavorite={
                vod
                  ? () => {
                      toggleFavorite(vod)
                      setFavorite((v) => !v)
                    }
                  : undefined
              }
              favorite={favorite}
            />
          </div>

          {locked && (
            <button
              onClick={() => {
                setLocked(false)
                setControlsVisible(true)
                showToast('已解锁')
              }}
              className="tap absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90"
              aria-label="解锁"
            >
              <Icon name="lock" size={22} />
            </button>
          )}

          {!locked && (
            <div
              className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
                controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <PlayerBottomBar
                positionMs={displayPosition}
                durationMs={durationMs}
                bufferedMs={bufferedMs}
                playing={playing}
                speed={speed}
                onSeek={seekTo}
                onTogglePlay={togglePlay}
                onPrev={() => {
                  if (episodeIndex > 0) jumpTo(sourceIndex, episodeIndex - 1)
                  else showToast('已经是第一集')
                }}
                onNext={() => nextEpisode()}
                onSpeed={() => setSpeedMenuOpen((v) => !v)}
                onPlaylist={() => setPanelOpen(true)}
                onFullscreen={toggleFullscreen}
              />
            </div>
          )}
        </>
      )}

      {speedMenuOpen && (
        <div className="absolute inset-0 z-40" onClick={() => setSpeedMenuOpen(false)}>
          <div
            className="absolute bottom-[92px] right-6 overflow-hidden rounded-xl bg-[#1A1C22]/95 py-1.5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => {
                  setSpeed(option)
                  setSpeedMenuOpen(false)
                }}
                className={`tap block w-full px-[22px] py-[9px] text-left text-body-md ${
                  option === speed ? 'font-semibold text-brand' : 'text-white'
                }`}
              >
                {formatSpeed(option)}×
              </button>
            ))}
          </div>
        </div>
      )}

      <PlaylistPanel
        visible={panelOpen}
        sources={sources}
        sourceIndex={sourceIndex}
        episodeIndex={episodeIndex}
        downloaded={downloaded}
        watched={watched}
        onSelect={(si, ei) => jumpTo(si, ei)}
        onClose={() => setPanelOpen(false)}
      />

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-50 flex justify-center">
          <span className="rounded-lg bg-black/80 px-3.5 py-2 text-label-lg text-white">{toast}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────── 子组件 ───────────────────────────

function PlayerTopBar({
  title,
  episodeName,
  locked,
  favorite,
  onBack,
  onToggleLock,
  onFavorite,
}: {
  title: string
  episodeName: string
  locked: boolean
  favorite: boolean
  onBack: () => void
  onToggleLock: () => void
  onFavorite?: () => void
}) {
  return (
    <div className="flex items-center bg-gradient-to-b from-black/66 to-transparent px-2 py-1.5 text-white">
      {!locked && (
        <>
          <ControlIcon name="back" label="返回" onClick={onBack} />
          <div className="ml-1.5 min-w-0 flex-1">
            <p className="truncate text-title-sm">{title}</p>
            {episodeName && <p className="truncate text-label-sm text-white/70">{episodeName}</p>}
          </div>
          {onFavorite && (
            <ControlIcon
              name={favorite ? 'heart' : 'heartOutline'}
              label={favorite ? '取消收藏' : '收藏'}
              onClick={onFavorite}
              className={favorite ? 'text-gold' : ''}
            />
          )}
        </>
      )}
      {locked && <div className="flex-1" />}
      {/* 锁定按钮位置固定：肌肉记忆不用重建 */}
      <ControlIcon name={locked ? 'lock' : 'unlock'} label={locked ? '解锁' : '锁定'} onClick={onToggleLock} />
    </div>
  )
}

function PlayerBottomBar({
  positionMs,
  durationMs,
  bufferedMs,
  playing,
  speed,
  onSeek,
  onTogglePlay,
  onPrev,
  onNext,
  onSpeed,
  onPlaylist,
  onFullscreen,
}: {
  positionMs: number
  durationMs: number
  bufferedMs: number
  playing: boolean
  speed: number
  onSeek: (ms: number) => void
  onTogglePlay: () => void
  onPrev: () => void
  onNext: () => void
  onSpeed: () => void
  onPlaylist: () => void
  onFullscreen: () => void
}) {
  return (
    <div className="bg-gradient-to-t from-black/80 to-transparent px-3.5 pt-5 pb-2.5 text-white">
      <PlayerProgress
        positionMs={positionMs}
        durationMs={durationMs}
        bufferedMs={bufferedMs}
        onSeek={onSeek}
      />
      <div className="flex items-center">
        <span className="text-label-md">{playbackText(positionMs)}</span>
        <span className="text-label-md text-white/70">
          {' / '}
          {durationMs > 0 ? playbackText(durationMs) : '--:--'}
        </span>
        <div className="flex-1" />
        <ControlIcon name="prev" label="上一集" onClick={onPrev} />
        <ControlIcon name={playing ? 'pause' : 'play'} label={playing ? '暂停' : '播放'} onClick={onTogglePlay} size={44} />
        <ControlIcon name="next" label="下一集" onClick={onNext} />
        <button
          onClick={onSpeed}
          className="tap ml-2.5 rounded-md bg-white/15 px-2 py-1 text-label-md"
        >
          {formatSpeed(speed)}×
        </button>
        <div className="w-2" />
        <ControlIcon name="playlist" label="选集" onClick={onPlaylist} />
        <ControlIcon name="fullscreen" label="全屏" onClick={onFullscreen} />
      </div>
    </div>
  )
}

/** 进度条：视觉 3px、触摸区 22px；已缓冲段与已播放段分开画。 */
function PlayerProgress({
  positionMs,
  durationMs,
  bufferedMs,
  onSeek,
}: {
  positionMs: number
  durationMs: number
  bufferedMs: number
  onSeek: (ms: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(0)
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, (dragging ? preview : positionMs) / durationMs)) : 0
  const bufferedRatio = durationMs > 0 ? Math.min(1, bufferedMs / durationMs) : 0

  const valueAt = (clientX: number) => {
    const el = ref.current
    if (!el || durationMs <= 0) return 0
    const rect = el.getBoundingClientRect()
    return Math.min(durationMs, Math.max(0, ((clientX - rect.left) / rect.width) * durationMs))
  }

  return (
    <div
      ref={ref}
      className="relative h-[22px] w-full cursor-pointer"
      onPointerDown={(e) => {
        if (durationMs <= 0) return
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        setDragging(true)
        setPreview(valueAt(e.clientX))
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        setPreview(valueAt(e.clientX))
      }}
      onPointerUp={(e) => {
        if (!dragging) return
        const target = valueAt(e.clientX)
        setDragging(false)
        onSeek(target)
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/22">
        <div className="absolute left-0 top-0 h-full rounded-full bg-white/38" style={{ width: `${bufferedRatio * 100}%` }} />
        <div className="absolute left-0 top-0 h-full rounded-full bg-brand" style={{ width: `${ratio * 100}%` }} />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}

function PlaylistPanel({
  visible,
  sources,
  sourceIndex,
  episodeIndex,
  downloaded,
  watched,
  onSelect,
  onClose,
}: {
  visible: boolean
  sources: PlaySource[]
  sourceIndex: number
  episodeIndex: number
  downloaded: Record<number, number[]>
  watched: Record<number, Record<number, number>>
  onSelect: (sourceIndex: number, episodeIndex: number) => void
  onClose: () => void
}) {
  const [panelSource, setPanelSource] = useState(sourceIndex)
  const currentRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (visible) setPanelSource(sourceIndex)
  }, [visible, sourceIndex])

  useEffect(() => {
    if (visible) {
      // 打开面板就定位到当前这一集，集数多的剧不用从第一集翻到第 60 集
      window.setTimeout(() => {
        currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 60)
    }
  }, [visible, panelSource, episodeIndex, sourceIndex])

  if (!visible) return null
  const episodes = sources[panelSource]?.episodes ?? []
  const downloadedHere = new Set(downloaded[panelSource] ?? [])
  const watchedHere = watched[panelSource] ?? {}

  return (
    <div className="absolute inset-0 z-40 flex animate-fade-in">
      <div className="flex-1 bg-black/25" onClick={onClose} />
      <div className="flex h-full w-[360px] max-w-[86%] flex-col bg-[#1A1C22]/95 p-3.5 text-white">
        <div className="flex items-center">
          <span className="flex-1 text-title-md">选集</span>
          <ControlIcon name="close" label="关闭" onClick={onClose} size={32} />
        </div>
        {sources.length > 1 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar">
            {sources.map((s, index) => (
              <button
                key={`${s.name}-${index}`}
                onClick={() => setPanelSource(index)}
                className={`tap shrink-0 rounded-[14px] px-3 py-1.5 text-label-md ${
                  index === panelSource ? 'bg-brand text-white' : 'bg-white/8 text-white/70'
                }`}
              >
                {sourceDisplayName(s)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2.5 grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto no-scrollbar">
          {episodes.map((ep, index) => {
            const selected = panelSource === sourceIndex && index === episodeIndex
            const progress = watchedHere[ep.index]
            return (
              <button
                key={ep.index}
                ref={selected ? currentRef : undefined}
                onClick={() => onSelect(panelSource, index)}
                className={`tap relative flex h-12 items-center justify-center rounded-lg px-1 ${
                  selected
                    ? 'bg-brand text-white'
                    : progress != null
                      ? 'bg-white/5 text-white/45'
                      : 'bg-white/8 text-white/70'
                }`}
              >
                <span className="line-clamp-2 text-center text-label-md">{ep.name}</span>
                {downloadedHere.has(ep.index) && (
                  <span className="absolute right-1 top-1">
                    <DownloadedBadge light={selected} />
                  </span>
                )}
                {progress != null && !selected && (
                  <span
                    className="absolute bottom-0 left-0 h-[2px] bg-brand/55"
                    style={{ width: `${progress * 100}%` }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ControlIcon({
  name,
  label,
  onClick,
  size = 38,
  className = '',
}: {
  name: 'back' | 'lock' | 'unlock' | 'play' | 'pause' | 'next' | 'prev' | 'playlist' | 'close' | 'fullscreen' | 'heart' | 'heartOutline'
  label: string
  onClick: () => void
  size?: number
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`tap flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
    >
      <Icon name={name} size={Math.round(size * 0.58)} />
    </button>
  )
}
