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
  },
});
