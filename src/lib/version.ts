/**
 * 构建标识与版本检查。
 *
 * 痛点：PWA 装到桌面后极容易长年跑旧 JS（旧 Service Worker / 浏览器 HTTP 缓存），
 * 排查时只能靠猜「用户到底跑的是哪个版本」。所以：
 * - `BUILD_ID` 由构建时注入，慢加载时显示在界面上，截图即可判定新旧；
 * - `checkForUpdate()` 拉线上 `version.json` 与本进程的 ID 比对，
 *   不一致就说明有新版本，提示用户一键清 SW 重载。
 */
export const BUILD_ID = __BUILD_ID__

/** 短标记：只显示后 6 位，避免界面太啰嗦。 */
export const BUILD_TAG = BUILD_ID.slice(-6)

export const MEDIA_CACHE = 'zy-media-v1'

/**
 * 强制更新：注销 Service Worker + 清掉非媒体缓存 + 重载。
 *
 * 保留 `zy-media-v1`（已下载的离线分片），否则更新一次就把用户的下载清空了。
 */
export async function hardReload(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((regs ?? []).map((r) => r.unregister()))
  } catch {
    /* 忽略：没有 SW 权限也能重载 */
  }
  try {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== MEDIA_CACHE).map((k) => caches.delete(k)))
  } catch {
    /* 忽略 */
  }
  try {
    sessionStorage.removeItem('sw-reloaded')
  } catch {
    /* 忽略 */
  }
  window.location.reload()
}
