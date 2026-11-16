/**
 * Screen Orientation API 的 lock/unlock 还没进 TS 的 DOM 标准类型库，
 * 但 Chrome/Edge Android 与主流浏览器都已实现，这里补上声明合并。
 * 参考：https://developer.mozilla.org/docs/Web/API/ScreenOrientation
 */
interface ScreenOrientation {
  lock(orientation: 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary'): Promise<void>
  unlock(): void
}
