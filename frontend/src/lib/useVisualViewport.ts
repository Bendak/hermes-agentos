import { useEffect } from 'react'

/**
 * Pin the app shell to the *visual* viewport.
 *
 * On Android Chrome, `100dvh` lags behind the real visible area around the
 * on-screen keyboard, the URL bar and permission bubbles: the shell keeps a
 * stale height and leaves a dead band at the bottom (the composer appears
 * pushed up). Measuring `visualViewport` is the only reliable source there.
 *
 * Sets `--app-height` (px) on <html>; the CSS falls back to 100dvh when the
 * API is missing.
 */
export function useVisualViewport() {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    let frame = 0
    let lastH = -1
    let lastT = -1

    const apply = () => {
      frame = 0
      const height = vv ? vv.height : window.innerHeight
      if (!height || Number.isNaN(height)) return
      const px = Math.round(height)
      // The visual viewport can PAN inside the layout viewport (Android
      // keyboard focus-reveal, pinch zoom). A fixed shell stays glued to the
      // layout viewport, so it must follow the pan too — otherwise the top is
      // clipped by offsetTop and the dead band reappears at the bottom.
      const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0
      if (Math.abs(px - lastH) >= 2) {
        lastH = px
        root.style.setProperty('--app-height', `${px}px`)
      }
      if (top !== lastT) {
        lastT = top
        root.style.setProperty('--app-top', `${top}px`)
      }
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(apply)
    }

    apply()
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    if (vv) {
      vv.addEventListener('resize', schedule)
      vv.addEventListener('scroll', schedule)
    }
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      if (vv) {
        vv.removeEventListener('resize', schedule)
        vv.removeEventListener('scroll', schedule)
      }
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
    }
  }, [])
}
