import { useState } from 'react'
import { parseIp } from '@patchbook/shared'
import { useFoundDevices } from '../useFoundDevices.ts'
import { Select } from './Select.tsx'

interface Props {
  kind: string
  /** Which announced devices to offer. */
  discover: 'atem' | 'videohub'
  models: Array<{ id: string; label: string; family: string }>
  onAdd: (model: string) => void
  onCustom: () => void
  /** Read the device at this IP and create it from what it reports. */
  onReadDevice: (ip: string) => Promise<void>
}

export function EmptyDevice({ kind, discover, models, onAdd, onCustom, onReadDevice }: Props) {
  const found = useFoundDevices(discover)
  const [model, setModel] = useState('')
  const [ip, setIp] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = async (target = ip.trim()) => {
    setError(null)
    setIp(target)
    setReading(true)
    try {
      await onReadDevice(target)
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
        <button type="button" className="link quiet" onClick={onCustom}>
          Model not listed? Set the port counts yourself
        </button>
        <div className="read-device">
          <h4>Or read it from the {kind}</h4>
          <p className="muted small">Patchbook detects the model and copies the current names. Nothing is sent to the device.</p>
          {found.length > 0 && (
            <ul className="found-devices" aria-label={`${kind}s on this network`}>
              {found.map((d) => (
                <li key={d.id}>
                  <button type="button" disabled={reading} onClick={() => read(d.ip)}>
                    <span>{d.name}</span>
                    <span className="figures muted">{d.ip}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <input
              className="figures"
              value={ip}
              inputMode="decimal"
              aria-label={`${kind} IP address`}
              onChange={(e) => setIp(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={found.length ? 'Or type an IP address' : 'IP address'}
              onKeyDown={(e) => e.key === 'Enter' && parseIp(ip) && !reading && read()}
            />
            <button type="button" disabled={!parseIp(ip) || reading} onClick={() => read()}>
              {reading ? 'Reading…' : `Read ${kind}`}
            </button>
          </div>
          {error && <p className="field-note error">{error}</p>}
        </div>
      </section>
    </div>
  )
}
