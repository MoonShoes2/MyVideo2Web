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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw] 注册失败', e))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
