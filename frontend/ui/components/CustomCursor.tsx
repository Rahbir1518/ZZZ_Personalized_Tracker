/**
 * The pointer itself: solid white on a dark surface, solid black on a light
 * one, always.
 *
 * A native `cursor: url(...)` image can't do that — it's a static bitmap, and
 * nothing about it can react to what's underneath it frame to frame. The only
 * way to get true "always readable" inversion is `mix-blend-mode: difference`
 * on a real element: difference(white, black) = white, difference(white,
 * white) = black, per pixel, live. So the native cursor is switched off
 * everywhere (see `cursor: none` in zzz.css) and this renders the two supplied
 * glyphs — solid white PNGs, alpha-only shape — as a `position: fixed` image
 * that tracks the pointer and blends against whatever it's sitting over.
 *
 * Which glyph to show is read from `--cursor-role`, a plain CSS custom
 * property (not a real `cursor` value, so it survives `cursor: none`) set
 * next to every interactive element exactly where `cursor: var(--cursor-
 * clickable)` used to be set. Reusing that existing per-element styling means
 * this file is the only thing that had to learn about blend modes — nothing
 * elsewhere changed except which property name it sets.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import cursorDefault from '@resources/cursor-default.png'
import cursorClickable from '@resources/cursor-clickable.png'
import './CustomCursor.css'

type Role = 'default' | 'clickable' | 'text' | 'disabled' | 'off'

/** The glyph's own tip, in its native pixel coordinates (see scripts/build-cursors.md). */
const HOTSPOT: Record<'default' | 'clickable', readonly [number, number]> = {
  default: [6, 2],
  clickable: [10, 2]
}

const ASSET: Record<'default' | 'clickable', string> = {
  default: cursorDefault,
  clickable: cursorClickable
}

export function CustomCursor(): React.JSX.Element | null {
  const imgRef = useRef<HTMLImageElement>(null)
  const [role, setRole] = useState<Role>('off')
  const point = useRef({ x: -100, y: -100 })
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const measure = (): void => {
      frame.current = null
      const img = imgRef.current
      if (img !== null) {
        img.style.transform = `translate3d(${point.current.x}px, ${point.current.y}px, 0)`
      }

      // The real hit-test, not React's event target: an overlay's scrim, a
      // portalled panel, whatever is visually on top at this pixel wins, the
      // same thing the browser itself would use to decide what a click hits.
      const target = document.elementFromPoint(point.current.x, point.current.y)
      const raw =
        target === null ? '' : getComputedStyle(target).getPropertyValue('--cursor-role').trim()
      setRole(raw === 'clickable' || raw === 'text' || raw === 'disabled' ? raw : 'default')
    }

    const onMove = (event: MouseEvent): void => {
      point.current = { x: event.clientX, y: event.clientY }
      // Coalesce to one measurement per frame; elementFromPoint is not free,
      // and mousemove fires far more often than the screen repaints.
      if (frame.current === null) frame.current = requestAnimationFrame(measure)
    }

    // `relatedTarget === null` on a window-level `mouseout` is how the DOM
    // says the pointer left the page entirely (a native title bar, another
    // window) rather than just moving between two elements inside it.
    const onWindowLeave = (event: MouseEvent): void => {
      if (event.relatedTarget === null) setRole('off')
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onWindowLeave)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onWindowLeave)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])

  // 'text' hands off to the native I-beam over inputs; 'disabled' hands off
  // to the native not-allowed slash, which already says "can't click this"
  // better than an inverted arrow would. 'off' is outside the window.
  if (role === 'text' || role === 'disabled' || role === 'off') return null

  const kind = role === 'clickable' ? 'clickable' : 'default'
  const [hx, hy] = HOTSPOT[kind]

  return createPortal(
    <img
      ref={imgRef}
      className="custom-cursor"
      src={ASSET[kind]}
      alt=""
      style={{ marginLeft: -hx, marginTop: -hy }}
    />,
    document.body
  )
}
