import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useVisualViewport } from './Sheet.tsx'

// In-app replacements for the browser's confirm / alert / prompt. Call them from anywhere and
// await the answer; <DialogHost /> (mounted once at the app root) shows them one at a time.

interface DialogOptions {
  title: string
  message?: string
  /** Main button text, e.g. "Delete". */
  confirmLabel?: string
  cancelLabel?: string
  /** Red main button, for destructive actions. */
  danger?: boolean
}

interface PromptOptions extends DialogOptions {
  inputLabel?: string
  defaultValue?: string
}

type Request = { id: number } & (
  | (DialogOptions & { kind: 'confirm'; resolve: (ok: boolean) => void })
  | (DialogOptions & { kind: 'alert'; resolve: () => void })
  | (PromptOptions & { kind: 'prompt'; resolve: (value: string | null) => void })
)

let nextId = 1

let current: Request | null = null
const queue: Request[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function pump() {
  if (current || queue.length === 0) return
  current = queue.shift()!
  // Render synchronously so a prompt can focus its input inside the tap (iOS keyboard rule).
  flushSync(emit)
}

function finish(value: boolean | string | null) {
  const req = current
  if (!req) return
  current = null
  emit()
  if (req.kind === 'confirm') req.resolve(value === true)
  else if (req.kind === 'alert') req.resolve()
  else req.resolve(typeof value === 'string' ? value : null)
  pump()
}

/** Dismiss everything (as Cancel) when the page changes, so an answer can't act on a page that's gone. */
window.addEventListener('hashchange', () => {
  const pending = [...(current ? [current] : []), ...queue.splice(0)]
  current = null
  emit()
  for (const req of pending) {
    if (req.kind === 'confirm') req.resolve(false)
    else if (req.kind === 'alert') req.resolve()
    else req.resolve(null)
  }
})

export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ ...options, id: nextId++, kind: 'confirm', resolve })
    pump()
  })
}

export function alertDialog(options: DialogOptions): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ ...options, id: nextId++, kind: 'alert', resolve })
    pump()
  })
}

/** Resolves to the entered text, or null if cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ ...options, id: nextId++, kind: 'prompt', resolve })
    pump()
  })
}

export function DialogHost() {
  const req = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
  return req ? <Dialog key={req.id} req={req} /> : null
}

function Dialog({ req }: { req: Request }) {
  const viewport = useVisualViewport()
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.defaultValue ?? '') : '')
  const input = useRef<HTMLInputElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const secondary = useRef<HTMLButtonElement>(null)
  const cancel = () => finish(req.kind === 'prompt' ? null : false)
  const accept = () => finish(req.kind === 'prompt' ? value : true)

  useLayoutEffect(() => {
    if (req.kind === 'prompt') {
      input.current?.focus()
      input.current?.select()
    } else if (req.danger) {
      secondary.current?.focus() // destructive: Enter shouldn't do the damage by default
    } else {
      primary.current?.focus()
    }
  }, [req])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const confirmLabel = req.confirmLabel ?? (req.kind === 'alert' ? 'OK' : 'Confirm')
  return createPortal(
    <div className="sheet-backdrop dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && req.kind !== 'alert' && cancel()}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={req.message ? 'dialog-message' : undefined}
        style={{ top: viewport.top + viewport.height / 2 }}
      >
        <h3 id="dialog-title">{req.title}</h3>
        {req.message && (
          <p id="dialog-message" className="dialog-message">
            {req.message}
          </p>
        )}
        {req.kind === 'prompt' && (
          <label className="field">
            {req.inputLabel && <span>{req.inputLabel}</span>}
            <input
              ref={input}
              value={value}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (value.trim()) accept()
              }}
            />
          </label>
        )}
        <div className="dialog-buttons">
          {req.kind !== 'alert' && (
            <button ref={secondary} type="button" onClick={cancel}>
              {req.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            ref={primary}
            type="button"
            className={req.danger ? 'danger-solid' : 'primary'}
            disabled={req.kind === 'prompt' && !value.trim()}
            onClick={accept}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
