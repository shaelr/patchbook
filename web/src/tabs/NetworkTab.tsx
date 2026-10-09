import { useEffect, useMemo, useRef, useState } from 'react'
import {
  allProjectIps,
  IP_ISSUE_TEXT,
  ipIssues,
  parseIp,
  networkGroups,
  networkRows,
  newId,
  nextFreeIp,
  parseSubnet,
  rangeForIp,
  rangeSpan,
  type FoundDevice,
  type IpRange,
  type NetworkRow,
  type ProjectData,
} from '@patchbook/shared'
import { flushSync } from 'react-dom'
import { alertDialog, confirmDialog } from '../components/Dialogs.tsx'
import { EditSheet, useEditSheet } from '../components/EditSheet.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { useIsPhone } from '../useMedia.ts'
import { useFoundDevices } from '../useFoundDevices.ts'
import { cellProps } from '../components/grid.ts'
import { IpField } from '../components/IpField.tsx'
import { Select, type SelectOption } from '../components/Select.tsx'
import { href } from '../router.ts'
import type { ProjectUpdate } from '../useProject.ts'

export function NetworkTab({ data, update, projectId }: { data: ProjectData; update: ProjectUpdate; projectId: string }) {
  const [roleId, setRoleId] = useState('switching')
  const [name, setName] = useState('')
  const [ipDraft, setIpDraft] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  // While an IP is being edited, hold each row's position and group so it doesn't jump mid-typing.
  const [frozen, setFrozen] = useState<Frozen | null>(null)
  const unfreezeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const nameInput = useRef<HTMLInputElement>(null)
  const phone = useIsPhone()
  // Phones: the add form lives in a sheet, opened from the Devices header.
  const [adding, setAdding] = useState(false)
  const [lastAdded, setLastAdded] = useState<string | null>(null)

  const allIps = allProjectIps(data)
  // Blackmagic devices announced on the network that aren't in the show yet.
  const found = useFoundDevices()
  const inShow = new Set(allIps.map((ip) => parseIp(ip)?.normalized ?? ip))
  const notInShow = found.filter((d) => !inShow.has(d.ip))
  const pickFound = (device: FoundDevice) => {
    const range = rangeForIp(device.ip, data)
    if (range) setRoleId(range.id)
    setName(device.name)
    setIpDraft(device.ip)
    nameInput.current?.focus()
  }
  const role = data.ipRanges.find((r) => r.id === roleId) ?? data.ipRanges[0]
  const suggested = role ? nextFreeIp(role, data) : null
  const newIp = ipDraft ?? suggested ?? ''

  const sorted = networkRows(data)
  const groups = frozen
    ? networkGroups(data, holdOrder(sorted, frozen.order), (row) =>
        frozen.rangeOf.has(row.key) ? frozen.rangeOf.get(row.key)! : rangeForIp(row.ip, data),
      )
    : networkGroups(data, sorted)
  const rowCount = sorted.length

  const freeze = () => {
    clearTimeout(unfreezeTimer.current)
    setFrozen(
      (current) =>
        current ?? {
          order: sorted.map((r) => r.key),
          rangeOf: new Map(sorted.map((r) => [r.key, rangeForIp(r.ip, data)])),
        },
    )
  }

  const ipEditing = {
    onFocus: freeze,
    // Short delay so a click on the row's "Fix" button lands before the list re-sorts.
    onBlur: () => {
      unfreezeTimer.current = setTimeout(() => setFrozen(null), 200)
    },
  }

  // Touch devices edit rows in a sheet above the keyboard; the list holds still while it's open.
  const sheet = useEditSheet<string>()
  const ordered = groups.flatMap((g) => g.rows.map((row) => ({ row, group: g.label })))
  const editing = ordered.find((o) => o.row.key === sheet.target)
  const openSheet = (row: NetworkRow, field: string) => {
    freeze()
    sheet.open(row.key, field)
  }
  const closeSheet = () => {
    sheet.close()
    setFrozen(null)
  }
  const touchCell = (row: NetworkRow, field: string) =>
    sheet.touch ? { readOnly: true, onClick: () => openSheet(row, field) } : {}

  useEffect(() => {
    if (!justAdded) return
    const timer = setTimeout(() => setJustAdded(null), 1600)
    return () => clearTimeout(timer)
  }, [justAdded])

  const add = () => {
    if (!name.trim() && !newIp) return
    const id = newId()
    update((d) => d.network.push({ id, name: name.trim(), ip: newIp }))
    setJustAdded(id)
    setLastAdded(`${name.trim() || 'Device'}${newIp ? ` · ${newIp}` : ''}`)
    setName('')
    setIpDraft(null)
    nameInput.current?.focus()
  }

  const setRow = (row: NetworkRow, patch: { name?: string; ip?: string }) =>
    update((d) => {
      const target = row.device ? d[row.device] : d.network[row.index!]
      if (target) Object.assign(target, patch)
    })

  /** Move a device to another role's range: its IP becomes the next free address there. */
  const changeRole = async (row: NetworkRow, rangeId: string) => {
    const range = data.ipRanges.find((r) => r.id === rangeId)
    if (!range) return
    const ip = nextFreeIp(range, data)
    const label = row.name.trim() || 'This device'
    if (!ip) {
      await alertDialog({
        title: `${range.label} is full`,
        message: `There are no free addresses left in ${rangeSpan(range)}. Widen the range in Settings or free one up.`,
      })
      return
    }
    if (
      row.ip.trim() &&
      !(await confirmDialog({
        title: `Move ${label} to ${range.label}?`,
        message: `Its IP address will change from ${row.ip} to ${ip}.`,
        confirmLabel: 'Move',
      }))
    )
      return
    setRow(row, { ip })
  }

  const remove = (row: NetworkRow) => update((d) => d.network.splice(row.index!, 1))

  const usage = useMemo(() => {
    return data.ipRanges.map((r) => {
      const used = allIps.filter((ip) => rangeForIp(ip, data)?.id === r.id).length
      const span = r.start === r.end ? `.${r.start}` : `.${r.start}–.${r.end}`
      return { ...r, used, size: r.end - r.start + 1, span }
    })
  }, [data, allIps])

  const subnetText = parseSubnet(data.subnet) ? data.subnet : `Invalid subnet: ${data.subnet}`
  const addForm = (
  <>
  <div className="add-row">
    <label className="field">
      <span>Role</span>
      <Select
        label="Role"
        value={roleId}
        options={roleOptions(data)}
        onChange={(id) => {
          setRoleId(id)
          setIpDraft(null)
        }}
      />
    </label>
    <label className="field grow">
      <span>Device name</span>
      <input
        ref={nameInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
    </label>
    <label className="field">
      <span>IP {ipDraft === null && suggested ? <em className="muted">(next free)</em> : null}</span>
      <input
        className="figures"
        value={newIp}
        inputMode="decimal"
        placeholder={suggested ? '' : 'Range full'}
        onChange={(e) => setIpDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
    </label>
    <button type="button" className="primary" onClick={add}>
      Add
    </button>
  </div>
  {notInShow.length > 0 && (
    <div className="found-on-network">
      <span className="muted small">On this network:</span>
      <ul className="found-devices" aria-label="Devices on this network">
        {notInShow.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => pickFound(d)}>
              <span>{d.name}</span>
              <span className="figures muted">{d.ip}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )}
  </>
  )
  const rangesList = (
  <ul>
    {usage.map((r) => (
      <li key={r.id}>
        <button
          type="button"
          className={`range ${r.id === roleId ? 'active' : ''}`}
          onClick={() => {
            setRoleId(r.id)
            setIpDraft(null)
          }}
        >
          <span className="figures span">{r.span}</span>
          <span className="label">{r.label}</span>
          <span className="figures used">
            {r.used}/{r.size}
          </span>
        </button>
      </li>
    ))}
  </ul>
  )
  const openAdd = () => {
    // Focus inside the tap so the phone keyboard opens with the sheet.
    flushSync(() => setAdding(true))
    nameInput.current?.focus()
  }

  return (
    <div className="tab-body network">
      <div className="network-main">
        {!phone && (
          <section className="card add-device">
            <h3>Add a device</h3>
            {addForm}
          </section>
        )}

        <section className="card">
          <header className="card-head">
            <h3>Devices</h3>
            <span className="muted">{phone ? `${rowCount} total` : `${rowCount} total · grouped by role, sorted by IP`}</span>
            {phone && (
              <button type="button" className="primary" onClick={openAdd}>
                + Add
              </button>
            )}
          </header>
          {rowCount === 0 ? (
            <p className="muted pad">No devices yet. {phone ? 'Tap + Add' : 'Add one above'}, or import an existing spreadsheet.</p>
          ) : (
            <table className="label-table network-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th className="ip-col">IP address</th>
                  <th className="role-col">Role</th>
                  <th className="act" aria-label="Actions" />
                </tr>
              </thead>
              {groups.map((group, g) => {
                const offset = groups.slice(0, g).reduce((n, x) => n + x.rows.length, 0)
                return (
                  <tbody key={group.key}>
                    <tr className="group-row">
                      <th colSpan={4}>
                        <span className="group-label">{group.label}</span>
                        {group.span && <span className="figures muted"> {group.span}</span>}
                        {group.size > 0 && (
                          <span className="muted group-used">
                            {usage.find((u) => u.id === group.key)?.used ?? group.rows.length} of {group.size} used
                          </span>
                        )}
                      </th>
                    </tr>
                    {group.rows.map((row, r) => {
                      const i = offset + r
                      return (
                        <tr key={row.key} className={row.key === justAdded ? 'just-added' : undefined}>
                          <td className="name-col">
                            <div className="name-cell">
                              {row.device && (
                                <a className="pill" href={href.project(projectId, row.device)}>
                                  {row.device === 'atem' ? 'ATEM' : 'Videohub'}
                                </a>
                              )}
                              <input
                                {...cellProps('net', i, 'name')}
                                {...touchCell(row, 'name')}
                                value={row.name}
                                onChange={(e) => setRow(row, { name: e.target.value })}
                              />
                            </div>
                          </td>
                          <td className="ip-col">
                            <IpField
                              value={row.ip}
                              issues={ipIssues(row.ip, data.subnet, allIps)}
                              onChange={(ip) => setRow(row, { ip })}
                              inputProps={{ ...cellProps('net', i, 'ip'), 'data-key': row.key, ...(sheet.touch ? touchCell(row, 'ip') : ipEditing) }}
                            />
                          </td>
                          <td className="role-col">
                            <RoleSelect data={data} row={row} onChange={(rangeId) => changeRole(row, rangeId)} />
                          </td>
                          <td className="act">
                            {row.index !== undefined && (
                              <button
                                type="button"
                                className="icon danger"
                                aria-label={`Delete ${row.name || 'device'}`}
                                onClick={() => remove(row)}
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          )}
        </section>
        {phone && (
          <details className="card ranges-collapsible">
            <summary>
              <strong>IP ranges</strong>
              <span className="muted small">
                {usage.filter((u) => u.used > 0).length} of {usage.length} in use · <span className="figures">{subnetText}</span>
              </span>
            </summary>
            {rangesList}
            <a className="muted small ranges-edit" href={href.project(projectId, 'settings')}>
              Edit ranges in Settings
            </a>
          </details>
        )}
      </div>

      {editing && (
        <EditSheet
          ref={sheet.ref}
          kind={`Network · ${editing.group}`}
          title={editing.row.name.trim() || 'Unnamed device'}
          onClose={closeSheet}
          fields={[
            { key: 'name', label: 'Device name', value: editing.row.name, onChange: (name) => setRow(editing.row, { name }) },
            (() => {
              const issues = ipIssues(editing.row.ip, data.subnet, allIps)
              const parsed = parseIp(editing.row.ip)
              return {
                key: 'ip',
                label: 'IP address',
                value: editing.row.ip,
                figures: true,
                inputMode: 'decimal' as const,
                error: issues.some((x) => x === 'invalid' || x === 'duplicate' || x === 'reserved'),
                onChange: (ip: string) => setRow(editing.row, { ip: ip.replace(/[^\d.]/g, '') }),
                note: issues.length > 0 && (
                  <span className="field-note warn">
                    {issues.map((x) => IP_ISSUE_TEXT[x]).join(' · ')}
                    {issues.includes('leading-zero') && parsed && (
                      <button
                        type="button"
                        className="link"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setRow(editing.row, { ip: parsed.normalized })}
                      >
                        Fix
                      </button>
                    )}
                  </span>
                ),
              }
            })(),
          ]}
        />
      )}

      {!phone && (
        <aside className="card ranges">
          <header className="card-head">
            <h3>IP ranges</h3>
            <a className="muted" href={href.project(projectId, 'settings')}>
              Edit
            </a>
          </header>
          <p className="muted small figures">{subnetText}</p>
          {rangesList}
        </aside>
      )}

      {phone && adding && (
        <Sheet
          title="Add a device"
          onClose={() => {
            setAdding(false)
            setLastAdded(null)
          }}
        >
          <div className="add-device-sheet">{addForm}</div>
          {lastAdded && <p className="muted small">Added {lastAdded}</p>}
        </Sheet>
      )}
    </div>
  )
}

function roleOptions(data: ProjectData): SelectOption[] {
  return data.ipRanges.map((r) => ({ value: r.id, label: r.label, detail: rangeSpan(r) }))
}

function RoleSelect({ data, row, onChange }: { data: ProjectData; row: NetworkRow; onChange: (rangeId: string) => void }) {
  const current = rangeForIp(row.ip, data)
  return (
    <Select
      className={current ? undefined : 'is-unset'}
      label={`Role for ${row.name || 'device'}`}
      value={current?.id ?? ''}
      placeholder={row.ip.trim() ? 'Outside ranges' : 'Choose…'}
      options={roleOptions(data)}
      onChange={onChange}
    />
  )
}

interface Frozen {
  order: string[]
  rangeOf: Map<string, IpRange | null>
}

/** Rows in a previously captured order; rows not in it (just added) go at the end. */
function holdOrder(rows: NetworkRow[], order: string[]): NetworkRow[] {
  const position = new Map(order.map((key, i) => [key, i]))
  const rank = (row: NetworkRow) => position.get(row.key) ?? order.length
  return [...rows].sort((a, b) => rank(a) - rank(b))
}
