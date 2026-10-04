import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuAction {
  label: string
  onSelect?: () => void
  /** Render as a link (downloads, new tabs) instead of a button. */
  href?: string
  download?: boolean
  newTab?: boolean
  danger?: boolean
}

/** A "⋯" button that opens a list of actions in a popup with large rows. */
export function ActionMenu({ label, title, actions, className }: { label: string; title: string; actions: MenuAction[]; className?: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" className={`icon menu-button ${className ?? ''}`} aria-label={label} aria-haspopup="menu" onClick={() => setOpen(true)}>
        ⋯
      </button>
      {open &&
        createPortal(
          <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div className="picker-sheet" role="menu" aria-label={title}>
              <header className="edit-sheet-head">
                <h3>{title}</h3>
                <button type="button" className="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </header>
              <div className="picker-list">
                {actions.map((a) =>
                  a.href ? (
                    <a
                      key={a.label}
                      role="menuitem"
                      className={`picker-option ${a.danger ? 'danger' : ''}`}
                      href={a.href}
                      download={a.download || undefined}
                      target={a.newTab ? '_blank' : undefined}
                      rel={a.newTab ? 'noreferrer' : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {a.label}
                    </a>
                  ) : (
                    <button
                      key={a.label}
                      type="button"
                      role="menuitem"
                      className={`picker-option ${a.danger ? 'danger' : ''}`}
                      onClick={() => {
                        setOpen(false)
                        a.onSelect?.()
                      }}
                    >
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
