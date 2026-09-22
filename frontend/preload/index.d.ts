import type { TrackerApi } from './index'

declare global {
  interface Window {
    tracker: TrackerApi
  }
}

export {}
