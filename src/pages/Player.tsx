import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import { db } from '../lib/db'
import { hlsUrl, probePlaylist, toPlayableUrl } from '../lib/api'
import {
  cachedDetail,
  fetchDetail,
  getHistory,
  saveProgress,
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
import { getSettings, PLAYER_SPEED_OPTIONS, useSettings } from '../lib/settings'
import { BUILD_TAG, hardReload } from '../lib/version'
import type { PlaySource, Vod } from '../lib/types'
import { Icon } from '../components/icons'
import { DownloadedBadge } from '../components/common'

/** 是否以「已安装应用」方式运行（从桌面图标打开），而不是浏览器标签页。 */
function isInstalledPwa(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      // iOS 加到主屏幕后没有 display-mode，靠这个标记
      (navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

const BOOST_SPEED = 2
/** 起播无进展上限：连续这么久拿不到任何新数据才判超时（有进展会不断续命）。 */
const STARTUP_STALL_MS = 20_000
/** 直连路线探测时长：超时就当直连不通，直接走同源代理。 */
const DIRECT_PROBE_TIMEOUT_MS = 3_500
const BOOST_DELAY_MS = 450
const CONTROLS_AUTO_HIDE_MS = 4000
const PROGRESS_SAVE_INTERVAL_MS = 5000
const SCREEN_SEEK_SPAN_MS = 5 * 60_000
const MIN_BRIGHTNESS = 0.02
/** 片尾广告离片尾多近就算「这一集播完了」——此时直接进下一集，而不是 seek 到片尾 */
const TAIL_AD_THRESHOLD_MS = 1_500
/** 原生把双击判定窗口从系统的 300ms 放宽到 500ms，兼容长按加速抬手后的点击。 */
const DOUBLE_TAP_WINDOW_MS = 500

/** 播放错误文案：对齐原生的「人话错误」，不把 hls.js / MediaError 的码直接丢给用户。 */
function describePlaybackError(kind: 'network' | 'media' | 'unsupported' | 'other'): string {
  switch (kind) {
    case 'network':
      return '网络连接失败，请检查网络后重试'
    case 'media':
      return '播放地址已失效或解码失败，试试切换线路'
    case 'unsupported':
      return '当前浏览器不支持该播放格式'
    default:
      return '播放失败，请重试或切换线路'
  }
}

function describeMediaError(code?: number): string {
  switch (code) {
    case 1:
      return '播放被中断，请重试'
    case 2:
    case 4:
      return describePlaybackError('media')
    case 3:
      return describePlaybackError('media')
    default:
      return describePlaybackError('other')
  }
}

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
  // 播放中途的错误：vod 已加载，不能复用 loadError 的全屏「加载失败」页，
  // 否则用户只会看到一块黑屏（原生这一段是 PlaybackErrorOverlay）。
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [showBufferSpinner, setShowBufferSpinner] = useState(false)
  const [playing, setPlaying] = useState(false)
  // 首帧就绪：起播前的黑屏期显示品牌色加载圈（对齐原生 LoadingOverlay）
  const [firstFrame, setFirstFrame] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [bufferedMs, setBufferedMs] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [locked, setLocked] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [hud, setHud] = useState<Hud | null>(null)
  const [pulse, setPulse] = useState<{ playing: boolean; seq: number } | null>(null)
  const [boosting, setBoosting] = useState(false)
  const [brightness, setBrightness] = useState(1)
  const [seekPreview, setSeekPreview] = useState<number | null>(null)
  const [adRanges, setAdRanges] = useState<AdRange[]>([])
  const [adSkipping, setAdSkipping] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  // 起播等待秒数：秒数在跳 = 网络在等；秒数冻结 = 主线程/渲染进程卡死（诊断用）
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec((v) => v + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])
  // 起播阶段日志：卡住时把「走到哪一步」显示出来，不用再靠猜。
  // 日志也不动了 = 进程已经死，而不是网络在等。
  const [stages, setStages] = useState<string[]>([])
  const markStage = useCallback((s: string) => {
    setStages((prev) => (prev[prev.length - 1] === s ? prev : [...prev.slice(-3), s]))
  }, [])
  const [downloaded, setDownloaded] = useState<Record<number, number[]>>({})
  const [watched, setWatched] = useState<Record<number, Record<number, number>>>({})
  // 给 hls 挂载 effect 读最新的下载状态（effect 只看 episode.url，不想因下载变化重挂）
  const downloadedRef = useRef(downloaded)
  downloadedRef.current = downloaded

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // ── 方向记忆：对齐原版 OrientationStore（true = 竖屏片源） ──
  // 播放器要等元数据才知道画面比例；先按本地记忆定方向，同一部剧下次进来不再翻转闪动。
  const ORIENTATION_KEY = 'zhuiying.orientation'
  const readOrientation = (id: number): boolean | null => {
    try {
      const map = JSON.parse(localStorage.getItem(ORIENTATION_KEY) || '{}')
      const v = map[`vod_${id}`]
      return typeof v === 'boolean' ? v : null
    } catch {
      return null
    }
  }
  const rememberOrientation = (id: number, portrait: boolean) => {
    try {
      const map = JSON.parse(localStorage.getItem(ORIENTATION_KEY) || '{}')
      const key = `vod_${id}`
      if (map[key] === portrait) return
      map[key] = portrait
      localStorage.setItem(ORIENTATION_KEY, JSON.stringify(map))
    } catch {
      /* 存储不可用时忽略：方向判断退化为每次现场算 */
    }
  }
  const [videoPortrait, setVideoPortrait] = useState<boolean | null>(() => readOrientation(vodId))

  // 是否以「已安装应用」运行：这决定全屏/转屏逻辑要不要插手。
  // 安装态窗口本身就是全屏，任何额外的 requestFullscreen / orientation.lock
  // 都会引起窗口尺寸变化，正是 PWA 独有的那部分差异。
  const installedPwa = isInstalledPwa()
  // 是否真正进入过全屏（只有浏览器标签页会用到）
  const wasFullscreenRef = useRef(false)
  // 用户主动切回竖屏时置位：避免 fullscreenchange 把「退出全屏」误判成系统返回
  const manualUnlockRef = useRef(false)
  // 主动离开标记：顶栏返回 / 组件卸载时我们主动退出全屏，
  // fullscreenchange 会因此再触发一次，用这个标记避免重复 navigate。
  const leavingRef = useRef(false)
  // 当前是否横屏：只用于决定按钮文案（旋转 / 竖屏）和切换方向
  const [landscapeView, setLandscapeView] = useState(false)
  useEffect(() => {
    const sync = () => setLandscapeView((screen.orientation?.type ?? '').startsWith('landscape'))
    sync()
    screen.orientation?.addEventListener?.('change', sync)
    return () => screen.orientation?.removeEventListener?.('change', sync)
  }, [])

  const hlsRef = useRef<Hls | null>(null)
  const tailAdHandledRef = useRef(false)
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

  /**
   * 手动转屏：横屏 ↔ 竖屏。
   *
   * 原来是「横屏片源自动转」，但装成 PWA 后窗口本身就是全屏，转屏会让整个窗口
   * 重新布局、Android 随之重建 video 的渲染表面；在灌首片的瞬间做这件事会把首帧
   * 卡死（浏览器标签页里没这个毛病，因为那时 requestFullscreen 常常直接被拒）。
   * 所以改成完全手动：转不转、什么时候转，由用户决定。
   */
  const toggleOrientation = useCallback(async () => {
    const el = stageRef.current
    try {
      if (landscapeView) {
        manualUnlockRef.current = true
        try {
          screen.orientation?.unlock?.()
        } catch {
          /* 没有锁定过时 unlock 会抛，忽略 */
        }
        if (!installedPwa && document.fullscreenElement) {
          await document.exitFullscreen().catch(() => undefined)
        }
        showToast('已切回竖屏')
        return
      }
      // 浏览器标签页里要先进元素全屏，锁方向才有意义；PWA 窗口本身已全屏
      if (!installedPwa && el && !document.fullscreenElement) {
        await el.requestFullscreen()
        wasFullscreenRef.current = true
      }
      manualUnlockRef.current = false
      if (!screen.orientation?.lock) {
        showToast('请把手机横过来')
        return
      }
      await screen.orientation.lock('landscape')
    } catch {
      showToast('这个环境不支持自动旋转，请把手机横过来')
    }
  }, [landscapeView, installedPwa, showToast])

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
      markStage('详情 ✓')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vodId])

  useEffect(() => {
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
    setFirstFrame(false)
    setPositionMs(0)
    setDurationMs(0)
    setSeekPreview(null)
    setPlaybackError(null)
    tailAdHandledRef.current = false

    const startAt = startPositionMs / 1000
    const onMeta = () => {
      // 尺寸确定后判定片源方向并记忆（对齐原版 onVideoSizeChanged → OrientationStore）
      if (video.videoWidth && video.videoHeight) {
        const portrait = video.videoHeight >= video.videoWidth
        setVideoPortrait(portrait)
        rememberOrientation(vodId, portrait)
      }
      if (startAt > 0 && Math.abs(video.currentTime - startAt) > 1) video.currentTime = startAt
      video.playbackRate = speed
      video.play().catch(() => setNeedsTap(true))
    }
    video.addEventListener('loadedmetadata', onMeta, { once: true })

    // 起播看门狗（心跳式）：只有在「完全没有任何进展」时才判超时。
    // 直接按固定 20 秒判死会误伤——Cloudflare 回源慢的时候 21 秒才出画面，
    // 那是真的在推进，不该弹错误。所以任何一步有动静就刷新时间戳。
    let cancelled = false
    let lastProgress = Date.now()
    const bumpProgress = () => {
      lastProgress = Date.now()
    }
    const watchdog = window.setInterval(() => {
      if (cancelled) return
      if (video.readyState >= 2 || video.currentTime > 0) return
      if (Date.now() - lastProgress > STARTUP_STALL_MS) {
        setPlaybackError('播放超时，地址可能已失效，试试切换线路')
      }
    }, 1000)

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        backBufferLength: 30,
        // 各段超时压到 8 秒：一条路线挂了要能尽快换另一条，
        // 而不是让用户对着转圈等 15 秒才发现走不通。
        manifestLoadingTimeOut: 8000,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 0,
        levelLoadingMaxRetry: 0,
        fragLoadingMaxRetry: 1,
      })
      hlsRef.current = hls
      // 两条取流路线：
      //   直连 —— 手机直连 CDN，几百毫秒，但不一定通（被墙/CORS/防盗链）
      //   代理 —— 同源 /api/hls，绕开跨域，但 Cloudflare 边缘回源国内 CDN 经常挂住
      // 谁都不保证可用，所以做成阶梯：探测定首条，挂了就换另一条，两条都挂再重试一轮。
      // 已下载的集必须走代理，否则命中不了离线缓存。
      const directUrl = toPlayableUrl(url)
      const proxyUrl = hlsUrl(url)
      const offlineEpisode = downloadedRef.current[sourceIndex]?.includes(episodeIndex) ?? false
      // https 页面里请求 http 源属于混合内容，会被浏览器直接拦掉
      const canDirect = /^https:/i.test(directUrl) && !offlineEpisode
      const routes = canDirect ? [directUrl, proxyUrl] : [proxyUrl]
      let routeIdx = 0
      // 每条路线各自记失败次数，换路线时优先挑「还没失败过」的那条
      const routeFails: number[] = routes.map(() => 0)
      let retryRounds = 0
      let networkRetries = 0
      let mediaRetries = 0

      const loadRoute = () => {
        const target = routes[routeIdx]
        const isDirect = target === directUrl
        bumpProgress()
        markStage(isDirect ? '直连' : '代理')
        hls.loadSource(target)
      }

      /** 找一条不是当前、且还没失败过的路线。 */
      const nextRoute = (): number => {
        for (let i = 0; i < routes.length; i += 1) {
          if (i !== routeIdx && routeFails[i] === 0) return i
        }
        return -1
      }

      hls.attachMedia(video)
      // 先探测路线再 loadSource：直连能通就走直连，不通直接改代理，
      // 不再让 hls.js 自己耗一个超时周期才发现要回退。
      void (async () => {
        markStage(canDirect ? '探测直连…' : '走代理')
        if (canDirect && !(await probePlaylist(directUrl, DIRECT_PROBE_TIMEOUT_MS))) {
          routeIdx = 1
        }
        if (cancelled) return
        loadRoute()
      })()
      // 每一步有进展就续命，避免慢但正常的加载被误判
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        bumpProgress()
        markStage('列表 ✓')
        video.playbackRate = speed
        video.play().catch(() => setNeedsTap(true))
      })
      hls.on(Hls.Events.LEVEL_LOADED, bumpProgress)
      hls.on(Hls.Events.FRAG_LOADED, () => {
        bumpProgress()
        markStage('分片 ✓')
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // 分片失败通常只是这一个分片的问题，原地重试更划算；
          // 换路线等于把已拿到的播放列表整条丢掉重来，白白多等一个超时。
          if (data.frag) {
            if (networkRetries++ < 1) {
              hls.startLoad()
              return
            }
            setPlaybackError(describePlaybackError('network'))
            return
          }
          // 播放列表/子列表拿不到 → 横向换路线，再原地重试一轮，最后交给用户
          routeFails[routeIdx] += 1
          const alt = nextRoute()
          if (alt >= 0) {
            routeIdx = alt
            loadRoute()
            return
          }
          // 两条都挂过一轮，再从头来一轮；还不行就把错误交给用户（重试 / 换线路）
          if (retryRounds++ < 1) {
            routeFails.fill(0)
            routeIdx = 0
            loadRoute()
            return
          }
          setPlaybackError(describePlaybackError('network'))
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) {
          hls.recoverMediaError()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setPlaybackError(describePlaybackError('media'))
        } else {
          setPlaybackError(describePlaybackError('other'))
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // 原生 HLS（iOS Safari）：<video> 直接吃 m3u8 不需要 CORS，
      // 所以优先直连 CDN，避免又走一遍慢代理；http 源在 https 页面会被拦。
      const nativeDirect = toPlayableUrl(url)
      const useDirect = /^https:/i.test(nativeDirect)
      markStage(useDirect ? '直连' : '代理')
      video.src = useDirect ? nativeDirect : hlsUrl(url)
      video.play().catch(() => setNeedsTap(true))
    } else {
      setLoadError('当前浏览器不支持 HLS 播放')
    }

    return () => {
      cancelled = true
      window.clearInterval(watchdog)
      video.removeEventListener('loadedmetadata', onMeta)
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.url, playToken, sourceIndex, episodeIndex])

  // ── 播放器事件 ──
  // 关键：初次渲染是「正在获取播放地址」全屏加载页，<video> 还没挂载，
  // 若在 [] 阶段绑定会拿到 null 且永不重绑，play/pause/waiting 全部丢失。
  // 用 vod 驱动：详情解析成功、video 进入 DOM 后再绑定一次。
  useEffect(() => {
    const video = videoRef.current
    if (!video || !vod) return
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
    const onPlaying = () => {
      setBuffering(false)
      setFirstFrame(true)
      markStage('首帧 ✓')
    }
    // 兜底：媒体已经有首帧数据（loadeddata 已触发）就说明画面可以出来了，
    // 哪怕 playing 事件因为自动播放被拦等原因没派发，也不能让加载层赖着不走。
    const onFirstData = () => {
      if (video.readyState >= 2) {
        setFirstFrame(true)
        markStage('首帧 ✓')
      }
    }
    const onError = () => {
      // hls.js 的致命错误由它自己的 ERROR 事件处理；这里兜底原生 HLS / 直接 mp4。
      if (!hlsRef.current) setPlaybackError(describeMediaError(video.error?.code))
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('loadedmetadata', onDuration)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('loadeddata', onFirstData)
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
      video.removeEventListener('loadeddata', onFirstData)
      video.removeEventListener('error', onError)
    }
  }, [vod])

  // 倍速跟随设置/用户选择
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  // ── 进度保存：每 5 秒一次，切集/退出时补一次 ──
  const persistProgress = useCallback(() => {
    const { vod: currentVod, sources: currentSources, sourceIndex: si, episodeIndex: ei } = stateRef.current
    const video = videoRef.current
    // 原生只在正在播放时落库，暂停/缓冲期间的同一帧不重复写
    if (!currentVod || !video || video.paused) return
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

  // 统一的「返回上一页」：保存进度后返回。横屏片源在系统返回键退出全屏时复用它。
  const leavePlayer = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    wasFullscreenRef.current = false
    persistProgress()
    navigate(-1)
  }, [persistProgress, navigate])

  useEffect(() => {
    const timer = window.setInterval(persistProgress, PROGRESS_SAVE_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      persistProgress()
    }
  }, [persistProgress])

  // 缓冲圈延迟点亮：短促的 seek 抖动不闪圈（原生 BUFFER_SPINNER_DELAY_MS = 300）
  useEffect(() => {
    if (!buffering || playbackError != null) {
      setShowBufferSpinner(false)
      return
    }
    const timer = window.setTimeout(() => setShowBufferSpinner(true), 300)
    return () => window.clearTimeout(timer)
  }, [buffering, playbackError])

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
      // 原生 AD_SKIP_LEAD_MS = 300：提前一点触发，避免慢设备上闪出广告首帧
      const range =
        inRange(adRanges, pos) ??
        adRanges.find((r) => pos >= r.startMs - 300 && pos < r.startMs) ??
        null
      if (!range) return

      // 片尾广告 = 这一集已经播完；仅在开启自动连播时推进下一集（对齐原生）
      const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0
      if (
        settings.autoPlayNext &&
        duration > 0 &&
        range.endMs >= duration - TAIL_AD_THRESHOLD_MS &&
        !tailAdHandledRef.current
      ) {
        tailAdHandledRef.current = true
        nextEpisode(true)
        return
      }

      // 先暂停再 seek，等 seeked 后恢复播放：避免慢设备上闪一帧广告
      setAdSkipping(true)
      video.pause()
      const skippedSeconds = Math.max(1, Math.round((range.endMs - pos) / 1000))
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        video.play().catch(() => undefined)
        setAdSkipping(false)
        showToast(`已跳过 ${skippedSeconds} 秒广告`)
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.min((range.endMs + 250) / 1000, video.duration || Infinity)
    }, 100)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adRanges, settings.autoPlayNext, showToast])

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
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined)
    } else {
      el.requestFullscreen
        ?.()
        .then(() => {
          // 横屏片源锁 landscape，竖屏片源（短剧）锁 portrait
          if (videoPortrait === false) return screen.orientation?.lock?.('landscape')
          if (videoPortrait === true) return screen.orientation?.lock?.('portrait')
        })
        .catch(() => undefined)
    }
  }

  // StrictMode 开发模式会 mount→unmount→remount；每次挂载都重置主动离开标记，
  // 否则第一次 unmount 置的 true 会残留到 remount，导致返回按钮/自动返回全部失效。
  useEffect(() => {
    leavingRef.current = false
    wasFullscreenRef.current = false
  }, [])

  // 离开全屏时解除方向锁；卸载时兜底还原（对齐原版 exitPlayer 回竖屏）
  useEffect(() => {
    const unlock = () => {
      try {
        screen.orientation?.unlock?.()
      } catch {
        /* 未锁定时 unlock 会抛错，忽略 */
      }
    }
    const onFsChange = () => {
      // 安装态窗口本身就在全屏里，它的 fullscreenchange 不代表用户按了返回，
      // 不能据此退出播放页（否则转屏一次就把人踢回详情页）。
      if (installedPwa || manualUnlockRef.current) return
      if (document.fullscreenElement) {
        // 进入全屏（横屏片源自动转的），记下来；系统返回键退出时据此判断
        wasFullscreenRef.current = true
        return
      }
      unlock()
      // 横屏片源在系统返回键 / 手势下会被浏览器先退出全屏（Web 收不到返回事件），
      // 表现为「点一次返回变竖屏继续播」。这里检测到从全屏退出就直接回上一页。
      // 用 wasFullscreen 而不是 videoPortrait：拿不到视频宽高时也能正确识别。
      // leavingRef 排除我们主动退出的情况（顶栏返回、组件卸载）。
      if (!leavingRef.current && wasFullscreenRef.current && vod && !loading) {
        leavePlayer()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leavePlayer, videoPortrait, vod, loading, installedPwa])

  // 真正的组件卸载：标记主动离开并收尾全屏/方向锁，避免触发上面的自动返回
  useEffect(() => {
    return () => {
      leavingRef.current = true
      try {
        screen.orientation?.unlock?.()
      } catch {
        /* 未锁定时 unlock 会抛错，忽略 */
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    }
  }, [])

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
    setPlaybackError(null)
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

  /** 播放中失败后的两个出口：重试当前集 / 切到下一条可用线路。 */
  const retryPlayback = () => {
    setPlaybackError(null)
    setPlayToken((t) => t + 1)
    bumpControls()
  }

  const switchLine = () => {
    const next = sources.findIndex((_, i) => i !== sourceIndex)
    if (next < 0) {
      showToast('当前没有可切换的线路')
      return
    }
    const episode = Math.min(episodeIndex, (sources[next]?.episodes.length ?? 1) - 1)
    jumpTo(next, Math.max(0, episode))
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
      setBoosting(true)
      // 原生 boost 时控制层整体让位，只留「2× 快进中」胶囊
      setControlsVisible(false)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
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
      setBoosting(false)
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
    if (now - g.lastTap < DOUBLE_TAP_WINDOW_MS) {
      if (g.singleTapTimer) window.clearTimeout(g.singleTapTimer)
      g.lastTap = 0
      const willPlay = video.paused
      if (willPlay) video.play().catch(() => undefined)
      else video.pause()
      setPulse({ playing: willPlay, seq: now })
      window.setTimeout(() => setPulse(null), 620)
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

  // 原生加载态文案：正在获取播放地址…（带品牌色转圈）
  if (loading && !vod && !loadError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
        <p className="mt-4 text-body-md text-white/70">
          正在获取播放地址…{elapsedSec > 3 ? ` (${elapsedSec}s · ${BUILD_TAG})` : ''}
        </p>
        {elapsedSec > 3 && stages.length > 0 && (
          <p className="mt-1.5 max-w-[86%] text-center text-[11px] leading-[16px] text-white/35">
            {stages.join(' · ')}
          </p>
        )}
        {/* 等太久就别让用户干瞪眼：给一个自己动手的出口 */}
        {elapsedSec >= 8 && (
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => void hardReload()}
              className="tap rounded-lg bg-white/12 px-4 py-2 text-label-lg text-white"
            >
              清理缓存并重试
            </button>
            <button
              onClick={() => navigate(-1)}
              className="tap rounded-lg bg-white/8 px-4 py-2 text-label-lg text-white/80"
            >
              返回
            </button>
          </div>
        )}
      </div>
    )
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
          // 与播放 effect 里的 onMeta 重复执行是安全的：判定是幂等的
          if (v.videoWidth && v.videoHeight) {
            const portrait = v.videoHeight >= v.videoWidth
            setVideoPortrait(portrait)
            rememberOrientation(vodId, portrait)
          }
          if (startPositionMs > 0 && Math.abs(v.currentTime - startPositionMs / 1000) > 1) {
            v.currentTime = startPositionMs / 1000
          }
        }}
        onDoubleClick={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      />

      {/* 播放中失败：vod 已在手，用浮层给出人话错误 + 重试 / 换线路两个出口 */}
      {playbackError && (
        <div className="absolute inset-0 z-[45] flex items-center justify-center bg-black/80 px-10">
          <div className="rounded-xl bg-black/78 px-5 py-4 text-center">
            <Icon name="offline" size={46} className="text-white/55" />
            <p className="mt-2 text-body-sm text-white/75">{playbackError}</p>
            <div className="mt-4 flex justify-center gap-6">
              <button onClick={retryPlayback} className="tap text-label-lg text-white">
                重试
              </button>
              <button onClick={switchLine} className="tap text-label-lg text-brand">
                换线路
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 亮度遮罩：网页改不了屏幕背光，用一层黑幕等价表达「画面变暗」 */}
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity"
        style={{ opacity: 1 - brightness }}
      />

      {pulse && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse-icon flex h-[76px] w-[76px] items-center justify-center rounded-full bg-black/45 text-white">
            {/* 原生 pulseShowPlay = !willPlay：要播放→画两道杠(可暂停)，要暂停→画三角(可播放) */}
            <Icon name={pulse.playing ? 'pause' : 'play'} size={38} />
          </div>
        </div>
      )}

      {/* 长按加速提示：固定在左上角，不挡画面中心（对齐原生 SpeedBoostChip） */}
      {boosting && (
        <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-xl bg-black/62 px-2.5 py-1 text-label-md text-white">
          {formatSpeed(BOOST_SPEED)}× 快进中
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

      {/* 起播前加载：详情/线路已就绪但首帧还没到，显示品牌色转圈（原生 LoadingOverlay） */}
      {vod && !firstFrame && !needsTap && !loadError && !playbackError && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black">
          <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
          <p className="mt-4 text-body-md text-white/70">
            正在获取播放地址…{elapsedSec > 3 ? ` (${elapsedSec}s · ${BUILD_TAG})` : ''}
          </p>
          {elapsedSec > 3 && stages.length > 0 && (
            <p className="mt-1.5 max-w-[86%] text-center text-[11px] leading-[16px] text-white/35">
              {stages.join(' · ')}
            </p>
          )}
          {/* 等太久就别让用户干瞪眼：给一个自己动手的出口 */}
          {elapsedSec >= 8 && (
            <div className="pointer-events-auto mt-6 flex gap-3">
              <button
                onClick={() => void hardReload()}
                className="tap rounded-lg bg-white/14 px-4 py-2 text-label-lg text-white"
              >
                清理缓存并重试
              </button>
              <button
                onClick={leavePlayer}
                className="tap rounded-lg bg-white/8 px-4 py-2 text-label-lg text-white/80"
              >
                返回
              </button>
            </div>
          )}
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

      {/* 播放中缓冲才用白色圈；起播前由上面的品牌色 LoadingOverlay 独占，避免两个圈同时转 */}
      {showBufferSpinner && firstFrame && !loadError && !playbackError && (
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
          setBoosting(false)
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
              onBack={leavePlayer}
              onToggleLock={() => {
                setLocked((v) => !v)
                setControlsVisible(true)
                showToast(locked ? '已解锁' : '已锁定，点击右上角解锁')
              }}
            />
          </div>

          {!locked && seekPreview == null && (
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
                onRotate={() => void toggleOrientation()}
                landscape={landscapeView}
              />
            </div>
          )}

          {/* 横滑拖进度时，控制层隐藏也要浮出真实进度条（对齐原生 SeekPreviewOverlay） */}
          {seekPreview != null && !locked && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-8">
              <PlayerProgress
                positionMs={seekPreview}
                durationMs={durationMs}
                bufferedMs={bufferedMs}
                onSeek={() => undefined}
              />
              <div className="-mt-1 flex items-center justify-between text-label-md text-white/85">
                <span>{playbackText(seekPreview)}</span>
                <span>{durationMs > 0 ? playbackText(durationMs) : '--:--'}</span>
              </div>
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
            {PLAYER_SPEED_OPTIONS.map((option) => (
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
  onBack,
  onToggleLock,
}: {
  title: string
  episodeName: string
  locked: boolean
  onBack: () => void
  onToggleLock: () => void
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
  onRotate,
  landscape,
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
  onRotate: () => void
  landscape: boolean
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
        <button
          onClick={onRotate}
          className="tap ml-1 rounded-md bg-white/15 px-2 py-1 text-label-md"
          aria-label={landscape ? '切回竖屏' : '横屏播放'}
        >
          {landscape ? '竖屏' : '旋转'}
        </button>
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
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) setPanelSource(sourceIndex)
  }, [visible, sourceIndex])

  useEffect(() => {
    if (!visible) return
    // 打开面板定位到当前集，并在上方留 3 行方便前后翻（对齐原生 PlaylistPanel）
    window.setTimeout(() => {
      const grid = gridRef.current
      if (!grid) return
      const anchor = panelSource === sourceIndex ? episodeIndex : 0
      grid.scrollTop = Math.max(0, anchor - 3) * 56
    }, 60)
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
        <div
          ref={gridRef}
          className="mt-2.5 grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto no-scrollbar"
        >
          {episodes.map((ep, index) => {
            const selected = panelSource === sourceIndex && index === episodeIndex
            const progress = watchedHere[ep.index]
            return (
              <button
                key={ep.index}
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
