import { useEffect, useState } from 'react'

/** 出厂地址与原生 build.gradle.kts 的 apiBaseUrl 保持一致；设置页可改。 */
export const DEFAULT_BASE_URL = 'https://lzizy.net/api.php/provide/vod/'

/** 采集接口固定路径，与 api.ts 的 API_PATH 一致（放这里避免 settings→api 循环依赖）。 */
export const VOD_API_PATH = 'api.php/provide/vod/'

/**
 * 设置页展示用的完整接口地址：把 baseUrl（根路径）拼上固定路径显示给用户。
 * 内部请求仍走 normalizeBaseUrl + 代理拼接，显示与存储分离。
 */
export function displayApiUrl(baseUrl: string): string {
  const root = normalizeBaseUrl(baseUrl)
  return root.replace(/\/$/, '') + '/' + VOD_API_PATH
}

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

/** 设置页「默认倍速」：原生只到 2.0x（SettingsScreen.kt:62-69）。 */
export const SETTINGS_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]
/** 播放器倍速菜单：原生含 3.0x（PlayerScreen.kt:164），与设置页不是同一份数组。 */
export const PLAYER_SPEED_OPTIONS = [...SETTINGS_SPEED_OPTIONS, 3]

/** 允许用户把地址写成 `miuiyl.com`、`https://miuiyl.com`、带尾斜杠等多种形式。 */
export function normalizeBaseUrl(raw: string): string {
  let url = String(raw || '').trim()
  if (!url) return DEFAULT_BASE_URL
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  // 原生 MaccmsApi.normalizeBaseUrl：粘贴完整端点时从 api.php 起整段截掉，避免路径重复
  const index = url.indexOf('api.php')
  if (index > 0) url = url.slice(0, index)
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
