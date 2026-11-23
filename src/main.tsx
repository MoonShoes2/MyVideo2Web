import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { prunePageCache } from './lib/db'
import { recoverDownloads } from './lib/downloads'
import { applyTheme, getSettings } from './lib/settings'

applyTheme(getSettings().themeMode)
prunePageCache().catch(() => undefined)
recoverDownloads().catch(() => undefined)

// Service Worker 负责离线播放：命中下载时写进 Cache Storage 的播放列表与分片。
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller

  // 新版本 SW 接管后自动刷新一次：PWA 长期不关会一直跑旧 SW（旧版缓存优先，
  // 会命过期的播放列表导致一直转圈）。首次安装（原本无 controller）不刷新。
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return
    if (sessionStorage.getItem('sw-reloaded') === '1') return
    reloading = true
    sessionStorage.setItem('sw-reloaded', '1')
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // 版本号：每次改动 sw.js 都升一下，避开边缘缓存导致的「旧 SW 不更新」。
      .register('/sw.js?v=20261123b')
      .then((reg) => {
        // 主动检查更新，避免等浏览器按自己的节奏才拉新版本
        reg.update().catch(() => undefined)
      })
      .catch((e) => console.warn('[sw] 注册失败', e))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
