import { useEffect, useState } from 'react'
import {
  atemModelLabel,
  atemPortIsDefault,
  atemOutputLabel,
  networkGroups,
  networkRows,
  resolveShort,
  videohubModelLabel,
  videohubPortIsDefault,
  type Project,
  type ProjectData,
} from '@patchbook/shared'
import { api } from '../api.ts'

interface Options {
  atem: boolean
  videohub: boolean
  network: boolean
  hideEmpty: boolean
}

const DEFAULT_OPTIONS: Options = { atem: true, videohub: true, network: true, hideEmpty: false }
const OPTIONS_KEY = 'patchbook.printOptions'

function loadOptions(): Options {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_OPTIONS
  }
}

/** One table cell: plain text, or a 4-character ATEM Label. */
type Cell = string | { label: string }

interface Row {
  cells: Cell[]
  empty?: boolean
}

/** Printable sheet of the project; the browser's Print → Save as PDF makes the PDF. */
export function PrintView({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState(loadOptions)

  useEffect(() => {
    api.get(id).then(setProject, (e: Error) => setError(e.message))
  }, [id])

  useEffect(() => {
    if (project) document.title = `${project.data.name} — Patchbook`
    document.body.classList.add('print-body')
    return () => document.body.classList.remove('print-body')
  }, [project])

  const set = (patch: Partial<Options>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next))
    } catch {
      // Private browsing: options just won't be remembered.
    }
  }

  if (error) return <div className="sheet">{error}</div>
  if (!project) return <div className="sheet muted">Loading…</div>

  const { data } = project
  const filter = (rows: Row[]) => (options.hideEmpty ? rows.filter((r) => !r.empty) : rows)

  return (
    <>
      <div className="print-toolbar no-print">
        <a href={`#/p/${id}/atem`} className="button ghost">
          ‹ Back
        </a>
        <div className="print-options">
          {data.atem && <Toggle label="ATEM" checked={options.atem} onChange={(atem) => set({ atem })} />}
          {data.videohub && <Toggle label="Videohub" checked={options.videohub} onChange={(videohub) => set({ videohub })} />}
          <Toggle label="Network" checked={options.network} onChange={(network) => set({ network })} />
          <Toggle label="Hide unlabeled ports" checked={options.hideEmpty} onChange={(hideEmpty) => set({ hideEmpty })} />
        </div>
        <button type="button" className="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <article className="sheet">
        <header className="sheet-header">
          <div>
            <h1>{data.name}</h1>
            <p className="sheet-meta">
              <span>
                Subnet <strong className="figures">{data.subnet}</strong>
              </span>
              <span>
                Printed <strong>{formatDate(new Date())}</strong>
              </span>
              <span>
                Last edited <strong>{formatDate(new Date(project.updatedAt))}</strong>
              </span>
            </p>
          </div>
          <div className="sheet-brand">
            <img src="/icon.svg" alt="" width={22} height={22} />
            Patchbook
          </div>
        </header>
        {data.notes.trim() && <p className="sheet-notes">{data.notes.trim()}</p>}

        {data.atem && options.atem && (
          <DeviceSection name={data.atem.name} model={atemModelLabel(data.atem)}>
            <PrintTable
              title="Inputs"
              head={['In', 'Name', 'Label']}
              rows={filter(
                data.atem.inputs.map((p) => ({
                  cells: [String(p.n), p.long, p.long ? { label: resolveShort(p) } : ''],
                  empty: atemPortIsDefault(data.atem!.model, p),
                })),
              )}
            />
            <div className="sheet-stack">
              <PrintTable
                title="Outputs"
                head={['Out', 'Name', 'Label']}
                rows={filter(
                  data.atem.outputs.map((p) => ({
                    cells: [atemOutputLabel(p), p.long, p.long ? { label: resolveShort(p) } : ''],
                    empty: atemPortIsDefault(data.atem!.model, p),
                  })),
                )}
              />
              {/* Notes are optional, so with "hide unlabeled" a Multiview table with none is left out. */}
              {data.atem.multiviews.length > 0 && !(options.hideEmpty && data.atem.multiviews.every((m) => !m.note.trim())) && (
                <PrintTable
                  title="Multiview"
                  head={['MV', 'Note']}
                  rows={filter(data.atem.multiviews.map((m) => ({ cells: [String(m.n), m.note], empty: !m.note.trim() })))}
                />
              )}
            </div>
          </DeviceSection>
        )}

        {data.videohub && options.videohub && (
          <DeviceSection name={data.videohub.name} model={videohubModelLabel(data.videohub)}>
            <PrintTable
              title="Inputs"
              head={['In', 'Label']}
              rows={filter(data.videohub.inputs.map((p) => ({ cells: [String(p.n), p.label], empty: videohubPortIsDefault('in', p) })))}
            />
            <PrintTable
              title="Outputs"
              head={['Out', 'Label']}
              rows={filter(data.videohub.outputs.map((p) => ({ cells: [String(p.n), p.label], empty: videohubPortIsDefault('out', p) })))}
            />
          </DeviceSection>
        )}

        {options.network && <NetworkSection data={data} />}
      </article>
    </>
  )
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** The model label says what the device is ("ATEM 2 M/E…", "Smart Videohub…"), so there's no separate kind tag. */
function DeviceSection(props: { name: string; model: string; children: React.ReactNode }) {
  return (
    <section className="sheet-section">
      <header className="section-head">
        <h2>{props.name}</h2>
        <span className="section-model">{props.model}</span>
      </header>
      <div className="sheet-columns">{props.children}</div>
    </section>
  )
}

function PrintTable({ title, head, rows }: { title: string; head: string[]; rows: Row[] }) {
  return (
    <table className="sheet-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={i === 0 ? 'num' : i === 2 ? 'sheet-label-col' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={head.length} className="none">
              Nothing labeled
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i}>
            {r.cells.map((c, j) => (
              <td key={j} className={j === 0 ? 'num figures' : j === 2 ? 'sheet-label-col' : undefined}>
                {typeof c === 'string' ? c : <span className="sheet-label">{c.label}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Network list grouped by role, each group sorted by IP. */
function NetworkSection({ data }: { data: ProjectData }) {
  const rows = networkRows(data)
  if (rows.length === 0) return null
  const groups = networkGroups(data, rows)

  return (
    <section className="sheet-section">
      <header className="section-head">
        <h2>Network</h2>
        <span className="section-model">
          {rows.length} device{rows.length === 1 ? '' : 's'}
        </span>
      </header>
      <table className="sheet-table net-list">
        <thead>
          <tr>
            <th>Device</th>
            <th className="ip">IP address</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="group">
              <th colSpan={2}>
                {g.label}
                {g.span && <span className="figures"> {g.span}</span>}
              </th>
            </tr>
            {g.rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.name}
                    {r.device && <span className="tag">{r.device === 'atem' ? 'ATEM' : 'Videohub'}</span>}
                  </td>
                  <td className="ip figures">{r.ip || '—'}</td>
                </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  )
}
