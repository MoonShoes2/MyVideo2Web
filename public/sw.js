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

  // 播放列表：必须网络优先。m3u8 里的分片地址带签名、会过期，
  // 命中旧缓存会让 hls.js 一直去拉失效地址，表现就是「播放卡死」。
  if (url.pathname === '/api/hls') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(MEDIA_CACHE)
          const hit = await cache.match(request, { ignoreVary: true })
          return hit || new Response('离线且未缓存播放列表', { status: 504 })
        }
      })(),
    )
    return
  }

  // 分片：缓存优先（下载器写入的离线分片），但只认成功响应，
  // 避免中断下载留下的坏条目被当成有效数据反复返回。
  if (url.pathname === '/api/seg') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE)
        const hit = await cache.match(request, { ignoreVary: true })
        if (hit && hit.ok && (hit.headers.get('content-length') ?? '1') !== '0') return hit
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
