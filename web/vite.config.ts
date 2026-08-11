import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base 使用相對路徑 './'，同時支援：
//   1. GitHub Pages 專案站台（https://<user>.github.io/<repo>/）
//   2. 本機 vite preview 與直接開啟檔案
// 搭配 HashRouter，重新整理不會 404。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Vite 8's default Oxc minifier currently mis-compiles the React/ECharts
    // module boundary in production (chart routes fail with React error #130).
    // Terser keeps the optimized bundle while preserving the runtime values.
    minify: 'terser',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // 將較大的第三方套件切成獨立 chunk，改善瀏覽器快取
        manualChunks(id) {
          if (id.includes('/node_modules/echarts') || id.includes('/node_modules/zrender')) return 'echarts';
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router')
          ) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', 'e2e/**'],
    // 預設的 forks pool 在含空白與非 ASCII 字元的 Windows 專案路徑下無法啟動
    // worker（Timeout waiting for worker to respond），整份測試會大量誤報失敗。
    // threads 在 jsdom 下行為一致，且此專案實測快約一個量級。
    pool: 'threads',
  },
});
