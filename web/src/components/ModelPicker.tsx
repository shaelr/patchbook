import { useState } from 'react'
import { CUSTOM_MODEL } from '@patchbook/shared'
import { Select } from './Select.tsx'

interface CountField<K extends string> {
  key: K
  label: string
  max: number
}

interface Props<K extends string> {
  models: Array<{ id: string; label: string; family: string }>
  value: string | null
  counts: Record<K, number>
  countFields: Array<CountField<K>>
  /** Called with a catalog model id, or CUSTOM_MODEL plus counts. */
  onChange: (model: string, counts: Record<K, number>) => void
}

/** Model dropdown grouped by family, with a Custom option that takes port counts. */
export function ModelPicker<K extends string>({ models, value, counts, countFields, onChange }: Props<K>) {
  const [draft, setDraft] = useState(counts)
  const [customOpen, setCustomOpen] = useState(value === CUSTOM_MODEL)
  const selected = customOpen ? CUSTOM_MODEL : (value ?? '')
  const changed = countFields.some((f) => draft[f.key] !== counts[f.key])

  return (
    <div className="model-picker">
      <label className="field">
        <span>Model</span>
        <Select
          label="Model"
          value={selected}
          placeholder="Choose a model…"
          options={[
            ...models.map((m) => ({ value: m.id, label: m.label, group: m.family })),
            { value: CUSTOM_MODEL, label: 'Custom / other…' },
          ]}
          onChange={(next) => {
            if (next === CUSTOM_MODEL) {
              setDraft(counts)
              setCustomOpen(true)
            } else {
              setCustomOpen(false)
              onChange(next, counts)
            }
          }}
        />
      </label>
      {customOpen && (
        <div className="custom-counts">
          {countFields.map((f) => (
            <label key={f.key} className="field small">
              <span>{f.label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={f.max}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: Math.max(0, Math.min(f.max, Number(e.target.value) || 0)) })}
              />
            </label>
          ))}
          <button type="button" disabled={!changed && value === CUSTOM_MODEL} onClick={() => onChange(CUSTOM_MODEL, draft)}>
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
