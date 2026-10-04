/** Two-or-more option switch, e.g. Inputs | Outputs on phones. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: string; detail?: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.detail && <span className="segmented-detail">{o.detail}</span>}
        </button>
      ))}
    </div>
  )
}
