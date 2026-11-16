import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发期把 /api 转给本地代理服务（server/index.mjs，端口 8787）。
// 生产期由同一个 Node 服务直接托管 dist，不存在跨域。
export default defineConfig({
  plugins: [react()],
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
