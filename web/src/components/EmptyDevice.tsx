import { useState } from 'react'
import { parseIp } from '@patchbook/shared'
import { Select } from './Select.tsx'

interface Props {
  kind: string
  models: Array<{ id: string; label: string; family: string }>
  onAdd: (model: string) => void
  onCustom: () => void
  /** Read the device at this IP and create it from what it reports. */
  onReadDevice: (ip: string) => Promise<void>
}

export function EmptyDevice({ kind, models, onAdd, onCustom, onReadDevice }: Props) {
  const [model, setModel] = useState('')
  const [ip, setIp] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = async () => {
    setError(null)
    setReading(true)
    try {
      await onReadDevice(ip.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading(false)
    }
  }
  return (
    <div className="tab-body">
      <section className="card empty">
        <h3>No {kind} in this project</h3>
        <p className="muted">Pick the model and Patchbook builds its input and output list.</p>
        <div className="row">
          <Select
            label={`${kind} model`}
            value={model}
            placeholder="Choose a model…"
            options={models.map((m) => ({ value: m.id, label: m.label, group: m.family }))}
            onChange={setModel}
          />
          <button type="button" className="primary" disabled={!model} onClick={() => onAdd(model)}>
            Add {kind}
          </button>
        </div>
        <button type="button" className="link danger" onClick={onCustom}>
          Model not listed? Set the port counts yourself
        </button>
        <div className="read-device">
          <h4>Or read it from the {kind}</h4>
          <p className="muted small">Patchbook detects the model and copies the current names. Nothing is sent to the device.</p>
          <div className="row">
            <input
              className="mono"
              value={ip}
              inputMode="decimal"
              aria-label={`${kind} IP address`}
              placeholder="IP address"
              onChange={(e) => setIp(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && parseIp(ip) && !reading && read()}
            />
            <button type="button" disabled={!parseIp(ip) || reading} onClick={read}>
              {reading ? 'Reading…' : `Read ${kind}`}
            </button>
          </div>
          {error && <p className="field-note error">{error}</p>}
        </div>
      </section>
    </div>
  )
}
