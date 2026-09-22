import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// frontend/  -> Electron main, preload, and the React UI
// backend/   -> the Python FastAPI sidecar (not built by Vite)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('frontend/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('frontend/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'frontend/ui',
    resolve: {
      alias: { '@': resolve('frontend/ui') }
    },
    build: {
      rollupOptions: { input: { index: resolve('frontend/ui/index.html') } }
    },
    plugins: [react()]
  }
})
