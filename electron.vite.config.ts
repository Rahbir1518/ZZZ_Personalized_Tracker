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
      alias: {
        '@': resolve('frontend/ui'),
        // Shipped art the UI imports. Vite hashes these into out/renderer, so
        // they travel in the asar with everything else - `resources/` itself is
        // only copied by electron-builder for the sidecar binary.
        '@resources': resolve('resources')
      }
    },
    // The renderer root is frontend/ui, so resources/ is outside it and the dev
    // server would refuse to serve from there without this.
    server: { fs: { allow: [resolve('.')] } },
    build: {
      rollupOptions: { input: { index: resolve('frontend/ui/index.html') } }
    },
    plugins: [react()]
  }
})
