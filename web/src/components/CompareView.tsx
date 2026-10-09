import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { diffCounts, type DiffStatus, type PortDiff } from '@patchbook/shared'

export type ReadState<R> =
  | { status: 'reading'; ip: string }
  | { status: 'error'; ip: string; error: string }
  | { status: 'done'; ip: string; reading: R; at: Date }

interface Props<R> {
  kind: 'ATEM' | 'Videohub'
  state: ReadState<R>
  /** Rows to show once read (project vs device). */
  rows: PortDiff[]
  /** Port keys still on factory default names on the device. */
  factoryDefaults?: Set<string>
  /** The device's model when it differs from the project's. */
  modelMismatch: { device: string; project: string } | null
  deviceName: string
  onApply: (keys: Set<string> | 'all', adoptModel: boolean) => void
  /** Send the project's names for the selected ports to the device. */
  onSend: (keys: Set<string>) => void
  /** A send is in progress. */
  sending: boolean
  /** Port keys whose project names can be sent (differ, and the project has a name of its own). */
  sendable: Set<string>
  onRetry: () => void
  onClose: () => void
}

const STATUS_TEXT: Record<DiffStatus, string> = {
  same: 'Same',
  different: 'Different',
  'not-set': 'Not set',
  'project-only': 'Only in project',
  'device-only': 'Only on device',
}

/** Read-only comparison of the project with what the device reported, with "use device names". */
export function CompareView<R>({ kind, state, rows, factoryDefaults, modelMismatch, deviceName, onApply, onSend, sending, sendable, onRetry, onClose }: Props<R>) {
  const counts = useMemo(() => diffCounts(rows), [rows])
  const changeable = useMemo(
    () => rows.filter((r) => r.status === 'different' || r.status === 'not-set' || (r.status === 'device-only' && r.device)),
    [rows],
  )
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changeable.map((r) => r.key)))
  const [adoptModel, setAdoptModel] = useState(true)
  // Selected ports that will actually be sent; selected differences without a project name of their own won't be.
  const toSend = [...selected].filter((k) => sendable.has(k))
  const notSent = [...selected].filter((k) => !sendable.has(k) && rows.some((r) => r.key === k && (r.status === 'different' || r.status === 'not-set'))).length
  const hasLabels = kind === 'ATEM'

  // Re-select all differences whenever a new reading arrives.
  useEffect(() => setSelected(new Set(changeable.map((r) => r.key))), [changeable])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = onlyDifferences ? rows.filter((r) => r.status !== 'same') : rows
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const allSelected = changeable.length > 0 && changeable.every((r) => selected.has(r.key))
  const willAdopt = !!modelMismatch && adoptModel

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="compare-sheet" role="dialog" aria-label={`Compare with ${kind}`}>
        <header className="compare-head">
          <div>
            <span className="edit-sheet-kind">Compare with device</span>
            <h3>
              {deviceName} <span className="muted figures">{state.ip}</span>
            </h3>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {state.status === 'reading' && (
          <div className="compare-message">
            <span className="spinner" aria-hidden /> Reading names from the {kind} at {state.ip}…
          </div>
        )}

        {state.status === 'error' && (
          <div className="compare-message">
            <p className="field-note error">{state.error}</p>
            <button type="button" className="primary" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <div className="compare-summary">
              <span className="pill-status same">{counts.same} same</span>
              <span className="pill-status different">{counts.different} different</span>
              {counts['not-set'] > 0 && <span className="pill-status not-set">{counts['not-set']} not set</span>}
              {counts['device-only'] > 0 && <span className="pill-status device-only">{counts['device-only']} only on device</span>}
              {counts['project-only'] > 0 && <span className="pill-status project-only">{counts['project-only']} only in project</span>}
              <span className="muted small">Read {state.at.toLocaleTimeString()}</span>
              <label className="toggle compare-filter">
                <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
                Differences only
              </label>
            </div>

            {modelMismatch && (
              <div className="banner warn compare-model">
                <span>
                  This {kind} is a <strong>{modelMismatch.device}</strong>; the project has a <strong>{modelMismatch.project}</strong>.
                </span>
                <label className="toggle">
                  <input type="checkbox" checked={adoptModel} onChange={(e) => setAdoptModel(e.target.checked)} />
                  Switch the project to {modelMismatch.device}
                </label>
              </div>
            )}

            <div className="compare-table-wrap">
              {visible.length === 0 ? (
                <p className="muted pad">The project and the {kind} match.</p>
              ) : (
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th className="check">
                        <input
                          type="checkbox"
                          aria-label="Select all differences"
                          checked={allSelected}
                          disabled={changeable.length === 0}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(changeable.map((r) => r.key)))}
                        />
                      </th>
                      <th className="num">#</th>
                      <th>Project</th>
                      <th>Device</th>
                      <th className="status-col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const canTake = changeable.some((c) => c.key === r.key)
                      const nameDiffers = r.project && r.device && r.project.name !== r.device.name
                      const labelDiffers = r.project && r.device && r.project.label !== r.device.label
                      return (
                        <tr key={r.key} className={`status-${r.status}`}>
                          <td className="check">
                            {canTake && (
                              <input type="checkbox" aria-label={`Use device name for ${r.label}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                            )}
                          </td>
                          <td className="num figures">
                            {r.side === 'in' ? 'In ' : 'Out '}
                            {r.label}
                          </td>
                          <td>
                            {r.status === 'not-set' ? (
                              <span className="compare-unset">
                                <Names names={r.project} hasLabels={hasLabels} highlightName={false} highlightLabel={false} />
                              </span>
                            ) : (
                              <Names names={r.project} hasLabels={hasLabels} highlightName={!!nameDiffers} highlightLabel={!!labelDiffers} />
                            )}
                          </td>
                          <td>
                            <Names names={r.device} hasLabels={hasLabels} highlightName={!!nameDiffers} highlightLabel={!!labelDiffers} />
                            {factoryDefaults?.has(r.key) && <span className="tag-default">factory default</span>}
                          </td>
                          <td className="status-col">
                            <span className={`pill-status ${r.status}`}>{STATUS_TEXT[r.status]}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <footer className="compare-foot">
              <div className="compare-actions">
                <span className="compare-direction">Device → Project</span>
                <button type="button" disabled={sending || (selected.size === 0 && !willAdopt)} onClick={() => onApply(selected, willAdopt)}>
                  Use device names for selected ({selected.size})
                </button>
                <button type="button" disabled={sending || (changeable.length === 0 && !willAdopt)} onClick={() => onApply('all', willAdopt)}>
                  Use all device names
                </button>
              </div>
              <div className="compare-actions">
                <span className="compare-direction">Project → {kind}</span>
                <button type="button" className="primary" disabled={sending || toSend.length === 0} onClick={() => onSend(new Set(toSend))}>
                  {sending ? (
                    <>
                      <span className="spinner" aria-hidden /> Sending…
                    </>
                  ) : (
                    `Send selected to ${kind} (${toSend.length})`
                  )}
                </button>
                {notSent > 0 && (
                  <span className="muted small compare-note">
                    {notSent} selected {notSent === 1 ? "port isn't" : "ports aren't"} set in the project, so the {kind} keeps {notSent === 1 ? 'its name' : 'their names'}.
                  </span>
                )}
              </div>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Names({ names, hasLabels, highlightName, highlightLabel }: { names: PortDiff['project']; hasLabels: boolean; highlightName: boolean; highlightLabel: boolean }) {
  if (!names) return <span className="muted">—</span>
  return (
    <span className="compare-names">
      <span className={highlightName ? 'changed' : undefined}>{names.name || <em className="muted">empty</em>}</span>
      {hasLabels && names.label !== undefined && <span className={`figures compare-label ${highlightLabel ? 'changed' : ''}`}>{names.label || '—'}</span>}
    </span>
  )
}
