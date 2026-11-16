/**
 * 离线播放的关键一环。
 *
 * 下载器把播放列表与分片按「同源代理地址」写进 zy-media-v1；
 * 播放时 hls.js 请求的还是同一批地址，这里直接命中缓存，
 * 于是断网也能播，播放层完全不用改。
 */
const MEDIA_CACHE = 'zy-media-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const isMedia = url.pathname === '/api/hls' || url.pathname === '/api/seg'
  if (isMedia) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE)
        const hit = await cache.match(request, { ignoreVary: true })
        if (hit) return hit
        try {
          return await fetch(request)
        } catch {
          return new Response('离线且未缓存该分片', { status: 504 })
        }
      })(),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cached = await caches.match('/index.html')
          return cached || new Response('离线', { status: 504 })
        }
      })(),
    )
  }
})
