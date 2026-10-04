import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Tracks the visible area, which shrinks when the on-screen keyboard opens. */
export function useVisualViewport() {
  const [viewport, setViewport] = useState(() => ({ top: 0, height: window.innerHeight }))
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return viewport
}

interface Props {
  title: string
  /** Small label above the title, e.g. the device kind. */
  kind?: string
  onClose: () => void
  children: ReactNode
}

/** A panel pinned to the top of the visible area (above the keyboard), with a Done button. */
export function Sheet({ title, kind, onClose, children }: Props) {
  const viewport = useVisualViewport()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="edit-sheet"
        role="dialog"
        aria-label={title}
        style={{ top: viewport.top + 12, maxHeight: viewport.height - 24 }}
      >
        <header className="edit-sheet-head">
          <div>
            {kind && <span className="edit-sheet-kind">{kind}</span>}
            <h3>{title}</h3>
          </div>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}
