import { DEFAULT_IP_RANGES, newId, parseSubnet, type ProjectData } from '@patchbook/shared'
import { confirmDialog } from '../components/Dialogs.tsx'
import type { ProjectUpdate } from '../useProject.ts'

export function SettingsTab({ data, update }: { data: ProjectData; update: ProjectUpdate }) {
  const subnet = parseSubnet(data.subnet)
  const maxOffset = subnet ? subnet.size - 1 : 255

  return (
    <div className="tab-body settings">
      <section className="card form">
        <h3>Project</h3>
        <label className="field">
          <span>Name</span>
          <input value={data.name} onChange={(e) => update((d) => (d.name = e.target.value))} />
          {!data.name.trim() && <div className="field-note error">A name is required; changes won't save without one.</div>}
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={4} value={data.notes} onChange={(e) => update((d) => (d.notes = e.target.value))} />
        </label>
      </section>

      <section className="card form">
        <h3>Network</h3>
        <label className="field">
          <span>Subnet</span>
          <input
            className={`figures ${subnet ? '' : 'is-error'}`}
            value={data.subnet}
            onChange={(e) => update((d) => (d.subnet = e.target.value.trim()))}
            placeholder="192.168.10.0/24"
          />
          {subnet ? (
            <div className="field-note muted">{subnet.size - 2} usable addresses</div>
          ) : (
            <div className="field-note error">Use network/prefix, e.g. 192.168.10.0/24</div>
          )}
        </label>

        <div className="card-head">
          <h4>IP ranges by role</h4>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Reset IP ranges?',
                message: 'The role ranges for this project will be replaced with the defaults.',
                confirmLabel: 'Reset',
              })
              if (ok) update((d) => (d.ipRanges = structuredClone(DEFAULT_IP_RANGES)))
            }}
          >
            Reset to defaults
          </button>
        </div>
        <p className="muted small">Host numbers within the subnet (.10 is 10). Adding a device suggests the next free address in its role's range.</p>
        <table className="label-table ranges-table">
          <thead>
            <tr>
              <th>Role</th>
              <th className="num-col">From</th>
              <th className="num-col">To</th>
              <th className="act" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.ipRanges.map((r, i) => {
              const bad = r.start > r.end || r.end > maxOffset
              const overlaps = data.ipRanges.some((o, j) => j !== i && r.start <= o.end && o.start <= r.end)
              return (
                <tr key={r.id}>
                  <td className="label-col">
                    <input value={r.label} onChange={(e) => update((d) => (d.ipRanges[i]!.label = e.target.value))} />
                    {(bad || overlaps) && (
                      <div className="field-note warn">{bad ? 'Range is out of order or past the subnet' : 'Overlaps another range'}</div>
                    )}
                  </td>
                  {(['start', 'end'] as const).map((k) => (
                    <td key={k} className="num-col" data-label={k === 'start' ? 'From' : 'To'}>
                      <input
                        className={`figures ${bad ? 'is-warn' : ''}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={maxOffset}
                        value={r[k]}
                        onChange={(e) => update((d) => (d.ipRanges[i]![k] = Math.max(0, Math.min(maxOffset, Number(e.target.value) || 0))))}
                      />
                    </td>
                  ))}
                  <td className="act">
                    <button type="button" className="icon danger" aria-label={`Delete ${r.label}`} onClick={() => update((d) => d.ipRanges.splice(i, 1))}>
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button type="button" className="ghost" onClick={() => update((d) => d.ipRanges.push({ id: newId(), label: 'New role', start: 0, end: 0 }))}>
          Add range
        </button>
      </section>
    </div>
  )
}
