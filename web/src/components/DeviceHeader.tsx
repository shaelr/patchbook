import { useState } from 'react'
import { parseIp, type IpIssue } from '@patchbook/shared'
import { useIsPhone } from '../useMedia.ts'
import { IpField } from './IpField.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { Sheet } from './Sheet.tsx'

interface Props<K extends string> {
  kind: string
  modelLabel: string
  models: Array<{ id: string; label: string; family: string }>
  model: string
  counts: Record<K, number>
  countFields: Array<{ key: K; label: string; max: number }>
  onModel: (model: string, counts: Record<K, number>) => void
  name: string
  onName: (name: string) => void
  ip: string
  ipIssues: IpIssue[]
  onIp: (ip: string) => void
  onRemove: () => void
  /** Read names from the device at the entered IP. */
  onRead: () => void
}

/** Model, name and IP for the ATEM / Videohub. On phones: a one-line summary that opens a sheet. */
export function DeviceHeader<K extends string>(props: Props<K>) {
  const phone = useIsPhone()
  const [editing, setEditing] = useState(false)
  const canRead = !!parseIp(props.ip)

  const form = (
    <>
      <ModelPicker
        // Remount when the model changes so the custom-count draft resets.
        key={props.model + JSON.stringify(props.counts)}
        models={props.models}
        value={props.model}
        counts={props.counts}
        countFields={props.countFields}
        onChange={props.onModel}
      />
      <label className="field">
        <span>Name</span>
        <input value={props.name} onChange={(e) => props.onName(e.target.value)} />
      </label>
      <label className="field">
        <span>IP address</span>
        <IpField value={props.ip} issues={props.ipIssues} onChange={props.onIp} placeholder="" />
      </label>
      <div className="device-actions">
        {!phone && (
          <button type="button" onClick={props.onRead} disabled={!canRead} title={canRead ? undefined : 'Enter the IP address first'}>
            Read from device
          </button>
        )}
        <button type="button" className="danger ghost" onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </>
  )

  if (!phone) return <section className="card device-header">{form}</section>

  return (
    <>
      <section className="card device-summary">
        <div className="device-summary-text">
          <strong>{props.modelLabel}</strong>
          <span className="muted">
            {props.name || props.kind} · <span className="mono">{props.ip || 'No IP'}</span>
            {props.ipIssues.length > 0 && <span className="badge">!</span>}
          </span>
        </div>
        <button type="button" onClick={props.onRead} disabled={!canRead}>
          Read
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </section>
      {editing && (
        <Sheet kind={props.kind} title="Device settings" onClose={() => setEditing(false)}>
          <div className="device-form">{form}</div>
        </Sheet>
      )}
    </>
  )
}
