/**
 * Baked in by electron.vite.config.ts's `define` at build time from the
 * `ZZZ_DIST_TRANSPORT` environment variable present when `npm run dist` (or
 * `npm run build`) ran — never read from the environment of whoever launches
 * the finished app. Empty string when unset. See sidecar.ts's
 * `resolvePrydwenTransport()`.
 */
declare const __ZZZ_DIST_TRANSPORT__: string
