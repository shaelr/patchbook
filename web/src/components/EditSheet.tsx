import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useVisualViewport } from './Sheet.tsx'

// On touch devices the on-screen keyboard covers much of the page, so table cells open this
// editor pinned to the top of the visible area instead of being edited in place.

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

/** `?touch=1` / `?touch=0` in the URL forces the touch editor on or off (handy for testing). */
function forcedTouch(): boolean | null {
  const value = new URLSearchParams(window.location.search).get('touch')
  return value === '1' ? true : value === '0' ? false : null
}

export function useTouchEditing(): boolean {
  const [touch, setTouch] = useState(() => forcedTouch() ?? window.matchMedia(TOUCH_QUERY).matches)
  useEffect(() => {
    if (forcedTouch() !== null) return
    const media = window.matchMedia(TOUCH_QUERY)
    const onChange = () => setTouch(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return touch
}

/** State for a table that edits through the sheet: which row is open, and how to open it. */
export function useEditSheet<T>() {
  const touch = useTouchEditing()
  const ref = useRef<EditSheetHandle>(null)
  const [target, setTarget] = useState<T | null>(null)
  // iOS only raises the keyboard for focus() inside the tap, so render the sheet synchronously.
  const open = (next: T, field: string) => {
    flushSync(() => setTarget(next))
    ref.current?.focus(field)
  }
  return { touch, ref, target, setTarget, open, close: () => setTarget(null) }
}

export interface SheetField {
  key: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Shows a character counter and flags the field when over. */
  max?: number
  mono?: boolean
  inputMode?: 'text' | 'decimal'
  hint?: string
  note?: ReactNode
  error?: boolean
}

/** A row as shown in the context strip: port number (or none), label, and a secondary value. */
export interface ContextRow {
  num?: string
  label: string
  /** The label is the default standing in for a blank name (shown greyed). */
  unset?: boolean
  extra?: string
}

export interface EditSheetHandle {
  /** Focus a field by key, falling back to the first field. */
  focus: (key?: string) => void
}

interface Props {
  kind: string
  title: string
  fields: SheetField[]
  /** The neighbouring rows, shown above and below the fields like the table around the edited row. */
  context?: { before?: ContextRow; after?: ContextRow }
  onClose: () => void
}

export const EditSheet = forwardRef<EditSheetHandle, Props>(function EditSheet(
  { kind, title, fields, context, onClose },
  ref,
) {
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const viewport = useVisualViewport()

  const focus = (key?: string) => {
    const el = (key && inputs.current.get(key)) || inputs.current.get(fields[0]?.key ?? '')
    el?.focus()
    el?.select()
  }
  useImperativeHandle(ref, () => ({ focus }))

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
        aria-label={`${kind} ${title}`}
        style={{ top: viewport.top + 12, maxHeight: viewport.height - 24 }}
      >
        <header className="edit-sheet-head">
          <div>
            <span className="edit-sheet-kind">{kind}</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </header>

        {context && <ContextLine row={context.before} arrow="↑" edge="Start of list" />}
        <div className="edit-sheet-fields">
          {fields.map((f) => {
            const over = f.max !== undefined && f.value.length > f.max
            return (
              <label key={f.key} className="field">
                <span className="edit-sheet-label">
                  {f.label}
                  {f.max !== undefined && (
                    <span className={`counter ${over ? 'over' : ''}`}>
                      {f.value.length}/{f.max}
                    </span>
                  )}
                </span>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(f.key, el)
                    else inputs.current.delete(f.key)
                  }}
                  className={`${f.mono ? 'mono' : ''} ${over || f.error ? 'is-error' : ''}`}
                  value={f.value}
                  placeholder={f.placeholder}
                  inputMode={f.inputMode}
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => f.onChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    onClose()
                  }}
                />
                {f.hint && <span className="field-note muted">{f.hint}</span>}
                {f.note}
              </label>
            )
          })}
        </div>
        {context && <ContextLine row={context.after} arrow="↓" edge="End of list" />}
      </div>
    </div>,
    document.body,
  )
})

function ContextLine({ row, arrow, edge }: { row: ContextRow | undefined; arrow: string; edge: string }) {
  if (!row) return <div className="ctx-row ctx-edge" aria-hidden>{edge}</div>
  return (
    <div className="ctx-row" aria-hidden>
      <span className="ctx-arrow">{arrow}</span>
      {row.num !== undefined && <span className="ctx-num mono">{row.num}</span>}
      <span className={`ctx-label ${row.unset || !row.label.trim() ? 'ctx-empty' : ''}`}>{row.label.trim() || 'Empty'}</span>
      {row.extra && <span className="ctx-extra mono">{row.extra}</span>}
    </div>
  )
}
