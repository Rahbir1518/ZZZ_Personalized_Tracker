import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

// frontend/  -> Electron main, preload, and the React UI
// backend/   -> the Python FastAPI sidecar (not built by Vite)
export default defineConfig(({ mode }) => {
  // Reads .env / .env.local / .env.[mode] / .env.[mode].local from the repo
  // root — all gitignored (*.env, .env.*). Real environment variables (e.g.
  // set with `$env:ZZZ_DIST_TRANSPORT = '...'`) still win if both are set;
  // this is just the alternative to typing that every time. Empty prefix so
  // it reads ZZZ_DIST_TRANSPORT specifically, not only VITE_-prefixed keys
  // (those are the ones Vite would expose to renderer code automatically —
  // this one is main-process-only and injected below by hand instead).
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const distTransport = process.env['ZZZ_DIST_TRANSPORT'] ?? fileEnv['ZZZ_DIST_TRANSPORT'] ?? ''

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: { input: { index: resolve('frontend/main/index.ts') } }
      },
      // Baked into the packaged build at `npm run dist` time — not read from
      // the *end user's* environment, which packaged apps don't inherit from
      // the machine that built them. This is what makes "which Prydwen
      // transport does this installer ship with" a decision made once, here,
      // rather than something that could vary per launch. See sidecar.ts's
      // resolvePrydwenTransport() for how it's consumed, and the README's
      // "Switching Prydwen transport modes" for how to set it — either a
      // `.env` file (`ZZZ_DIST_TRANSPORT=primp`) or a real env var.
      define: {
        __ZZZ_DIST_TRANSPORT__: JSON.stringify(distTransport)
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
  }
})
