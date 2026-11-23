import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'

/**
 * 构建标识：每次构建自动生成，不需要手工维护。
 *
 * 它做两件事：
 * 1. 烧进 JS（`__BUILD_ID__`），慢加载时会显示出来——手机上跑的是新是旧一眼可见；
 * 2. 同时写成 `dist/version.json`，运行中的页面定期拉它比对，
 *    发现不一致就提示「有新版本」并一键清 SW 重载。这能从根上解决
 *    「PWA 装到桌面后长年跑旧代码」这个反复出现的问题。
 */
const BUILD_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)

// 开发期把 /api 转给本地代理服务（server/index.mjs，端口 8787）。
// 生产期由同一个 Node 服务直接托管 dist，不存在跨域。
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      apply: 'build',
      closeBundle() {
        writeFileSync('dist/version.json', JSON.stringify({ build: BUILD_ID }))
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5173,
    // 监听所有网卡：手机等局域网设备可直接访问 http://<内网IP>:5173
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
})
