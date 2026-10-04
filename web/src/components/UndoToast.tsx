import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const UNDO_SECONDS = 10

/** A bar at the bottom of the screen offering to undo the last action, for a few seconds. */
export function UndoToast({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return createPortal(
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="toast-action" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="icon toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>,
    document.body,
  )
}
