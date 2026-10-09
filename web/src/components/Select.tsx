import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTouchEditing } from './EditSheet.tsx'

export interface SelectOption {
  value: string
  label: string
  /** Options sharing a group are listed under that heading. */
  group?: string
  /** Secondary text shown beside the label in the touch picker only (e.g. an IP range). */
  detail?: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Shown when the value matches no option (e.g. "Choose a model…"). */
  placeholder?: string
  /** Heading for the touch picker, and the accessible name. */
  label: string
  className?: string
}

/**
 * A dropdown: the native <select> on desktop; on touch screens, a button that opens a
 * picker with large, easy-to-tap rows.
 */
export function Select({ value, options, onChange, placeholder, label, className }: Props) {
  const touch = useTouchEditing()
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  if (!touch) {
    return (
      <select className={className} value={selected ? value : ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {!selected && <option value="">{placeholder ?? ''}</option>}
        {groupOptions(options).map(([group, list]) =>
          group ? (
            <optgroup key={group} label={group}>
              {list.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            list.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`select-button ${selected ? '' : 'is-placeholder'} ${className ?? ''}`}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selected?.label ?? placeholder ?? ''}`}
        onClick={() => setOpen(true)}
      >
        <span className="select-button-text">{selected?.label ?? placeholder ?? ''}</span>
        <span className="select-button-chevron" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <PickerSheet
          label={label}
          options={options}
          value={value}
          onPick={(v) => {
            setOpen(false)
            if (v !== value) onChange(v)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Consecutive options grouped by their group name, keeping order; ungrouped options get "". */
function groupOptions(options: SelectOption[]): Array<[string, SelectOption[]]> {
  const groups: Array<[string, SelectOption[]]> = []
  for (const o of options) {
    const group = o.group ?? ''
    const last = groups[groups.length - 1]
    if (last && last[0] === group) last[1].push(o)
    else groups.push([group, [o]])
  }
  return groups
}

function PickerSheet(props: { label: string; options: SelectOption[]; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="picker-sheet" role="dialog" aria-label={props.label}>
        <header className="edit-sheet-head">
          <h3>{props.label}</h3>
          <button type="button" className="ghost" onClick={props.onClose}>
            Cancel
          </button>
        </header>
        <div className="picker-list" role="listbox" ref={list}>
          {groupOptions(props.options).map(([group, items]) => (
            <div key={group || '_'} className="picker-group">
              {group && <div className="picker-group-label">{group}</div>}
              {items.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === props.value}
                  className="picker-option"
                  onClick={() => props.onPick(o.value)}
                >
                  <span className="picker-option-label">{o.label}</span>
                  {o.detail && <span className="picker-detail figures">{o.detail}</span>}
                  {o.value === props.value && (
                    <span className="picker-check" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
