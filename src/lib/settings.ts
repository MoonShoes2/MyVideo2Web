import { useEffect, useState } from 'react'

/** 出厂接口地址。原工程指向的站点已关闭采集，Web 版换成一个在线的同协议源，仍可在设置里改。 */
export const DEFAULT_BASE_URL = 'https://cj.lziapi.com/'

export const THEME_SYSTEM = 0
export const THEME_LIGHT = 1
export const THEME_DARK = 2

export const CACHE_CAPACITY_OPTIONS = [1, 2, 5, 10]
export const DEFAULT_CACHE_GB = 1

export interface Settings {
  baseUrl: string
  themeMode: number
  autoPlayNext: boolean
  defaultSpeed: number
  skipAds: boolean
  wifiOnly: boolean
  cacheCapacityGb: number
}

const KEY_BASE_URL = 'zy.baseUrl'
const KEY_THEME = 'zy.theme'
const KEY_AUTO_NEXT = 'zy.autoPlayNext'
const KEY_SPEED = 'zy.defaultSpeed'
const KEY_SKIP_ADS = 'zy.skipAds'
const KEY_WIFI_ONLY = 'zy.wifiOnly'
const KEY_CACHE_GB = 'zy.cacheGb'

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** 允许用户把地址写成 `miuiyl.com`、`https://miuiyl.com`、带尾斜杠等多种形式。 */
export function normalizeBaseUrl(raw: string): string {
  let url = String(raw || '').trim()
  if (!url) return DEFAULT_BASE_URL
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  if (!url.endsWith('/')) url += '/'
  return url
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key)
  return raw == null ? fallback : raw === '1'
}

function readNum(key: string, fallback: number): number {
  const n = Number.parseFloat(localStorage.getItem(key) ?? '')
  return Number.isFinite(n) ? n : fallback
}

function load(): Settings {
  return {
    baseUrl: normalizeBaseUrl(localStorage.getItem(KEY_BASE_URL) || DEFAULT_BASE_URL),
    themeMode: readNum(KEY_THEME, THEME_SYSTEM),
    autoPlayNext: readBool(KEY_AUTO_NEXT, true),
    defaultSpeed: readNum(KEY_SPEED, 1),
    skipAds: readBool(KEY_SKIP_ADS, true),
    wifiOnly: readBool(KEY_WIFI_ONLY, true),
    cacheCapacityGb: readNum(KEY_CACHE_GB, DEFAULT_CACHE_GB),
  }
}

let current = load()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  if (patch.baseUrl != null) localStorage.setItem(KEY_BASE_URL, normalizeBaseUrl(patch.baseUrl))
  if (patch.themeMode != null) localStorage.setItem(KEY_THEME, String(patch.themeMode))
  if (patch.autoPlayNext != null) localStorage.setItem(KEY_AUTO_NEXT, patch.autoPlayNext ? '1' : '0')
  if (patch.defaultSpeed != null) localStorage.setItem(KEY_SPEED, String(patch.defaultSpeed))
  if (patch.skipAds != null) localStorage.setItem(KEY_SKIP_ADS, patch.skipAds ? '1' : '0')
  if (patch.wifiOnly != null) localStorage.setItem(KEY_WIFI_ONLY, patch.wifiOnly ? '1' : '0')
  if (patch.cacheCapacityGb != null) localStorage.setItem(KEY_CACHE_GB, String(patch.cacheCapacityGb))
  emit()
}

export function setBaseUrl(raw: string) {
  updateSettings({ baseUrl: normalizeBaseUrl(raw) })
}

/** 0 跟随系统 / 1 浅色 / 2 深色 → 当前是否暗色。 */
export function resolveDark(mode: number, systemDark: boolean): boolean {
  if (mode === THEME_LIGHT) return false
  if (mode === THEME_DARK) return true
  return systemDark
}

export function applyTheme(mode: number) {
  const dark = resolveDark(mode, window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document
    .querySelector('meta[name=theme-color]')
    ?.setAttribute('content', dark ? '#0E0F13' : '#F5F6F8')
}

/** 订阅设置变化：页面里用 useState + useEffect 即可，不必引入状态库。 */
export function useSettings(): Settings {
  const [value, setValue] = useState(current)
  useEffect(() => {
    const fn = () => setValue({ ...current })
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return value
}

export function useDarkMode(): boolean {
  const { themeMode } = useSettings()
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode, systemDark])
  return resolveDark(themeMode, systemDark)
}
