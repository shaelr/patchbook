import {
  ATEM_LONG_MAX,
  ATEM_MODELS,
  ATEM_SHORT_MAX,
  CUSTOM_MODEL,
  LABEL_ISSUE_TEXT,
  allProjectIps,
  atemCounts,
  atemDefaultName,
  clearAtemPorts,
  resetAtemPorts,
  atemModelLabel,
  atemLabelIssues,
  atemOutputLabel,
  autoShortName,
  buildAtem,
  droppedAtemNames,
  atemPortIsDefault,
  resolveShort,
  ipIssues,
  applyAtemReading,
  atemWritePlan,
  changedPortCount,
  atemFromReading,
  compareAtem,
  findAtemModel,
  type AtemReading,
  type Atem,
  type AtemCounts,
  type AtemInput,
  type AtemOutput,
  type ProjectData,
} from '@patchbook/shared'
import { useCallback, useMemo, useState } from 'react'
import { api } from '../api.ts'
import { CompareView } from '../components/CompareView.tsx'
import { UndoToast } from '../components/UndoToast.tsx'
import { useDeviceRead } from '../useDeviceRead.ts'
import { useDeviceSend } from '../useDeviceSend.ts'
import { DeviceHeader } from '../components/DeviceHeader.tsx'
import { confirmDialog } from '../components/Dialogs.tsx'
import { ListMenu } from '../components/ListMenu.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useIsPhone } from '../useMedia.ts'
import { EditSheet, useEditSheet } from '../components/EditSheet.tsx'
import { EmptyDevice } from '../components/EmptyDevice.tsx'
import { cellProps } from '../components/grid.ts'
import type { ProjectUpdate } from '../useProject.ts'

/** The device's model label when it differs from the project's (model, or port counts for custom). */
function atemModelMismatch(atem: Atem, reading: AtemReading): { device: string; project: string } | null {
  const counts = atemCounts(atem)
  const same =
    reading.model === atem.model &&
    (reading.model !== CUSTOM_MODEL || (counts.inputs === reading.counts.inputs && counts.aux === reading.counts.aux))
  if (same) return null
  return { device: findAtemModel(reading.model)?.label ?? reading.productName, project: atemModelLabel(atem) }
}

const COUNT_FIELDS = [
  { key: 'inputs' as const, label: 'Inputs', max: 160 },
  { key: 'aux' as const, label: 'Outputs', max: 96 },
]

export function AtemTab({ data, update }: { data: ProjectData; update: ProjectUpdate }) {
  const atem = data.atem
  const phone = useIsPhone()
  // Phones show one list at a time instead of scrolling past every input to reach the outputs.
  const [side, setSide] = useState<'in' | 'out'>('in')
  const device = useDeviceRead(api.readAtem)
  // After "Use device names": the ATEM before and after, so the copy can be undone. Undo is offered
  // only while the ATEM is still exactly as the copy left it, so it never discards later edits.
  const [undo, setUndo] = useState<{ before: Atem; after: Atem; message: string } | null>(null)
  const dismissUndo = useCallback(() => setUndo(null), [])
  const sender = useDeviceSend({
    kind: 'ATEM',
    unit: 'name',
    write: api.writeAtem,
    onReading: device.setReading,
    restorable: (p) => p.long.trim() !== '',
  })
  const rows = useMemo(() => (atem && device.reading ? compareAtem(atem, device.reading) : []), [atem, device.reading])

  const setModel = async (model: string, counts: AtemCounts) => {
    const next = buildAtem(model, model === CUSTOM_MODEL ? counts : null, atem)
    const dropped = atem ? droppedAtemNames(atem, next) : 0
    if (
      dropped &&
      !(await confirmDialog({
        title: 'Change model?',
        message: `The new model has fewer ports. ${dropped} name${dropped === 1 ? '' : 's'} you entered will be removed.`,
        confirmLabel: 'Change model',
        danger: true,
      }))
    )
      return
    update((d) => (d.atem = next))
  }

  if (!atem) {
    return (
      <EmptyDevice
        kind="ATEM"
        models={ATEM_MODELS}
        onAdd={(model) => update((d) => (d.atem = buildAtem(model, null, null)))}
        onCustom={() => update((d) => (d.atem = buildAtem(CUSTOM_MODEL, { inputs: 8, aux: 2 }, null)))}
        onReadDevice={async (ip) => {
          const reading = await api.readAtem(ip)
          update((d) => (d.atem = atemFromReading(reading, ip)))
        }}
      />
    )
  }

  return (
    <div className="tab-body">
      <DeviceHeader
        kind="ATEM"
        modelLabel={atemModelLabel(atem)}
        models={ATEM_MODELS}
        model={atem.model}
        counts={atemCounts(atem)}
        countFields={COUNT_FIELDS}
        onModel={setModel}
        name={atem.name}
        onName={(name) => update((d) => (d.atem!.name = name))}
        ip={atem.ip}
        ipIssues={ipIssues(atem.ip, data.subnet, allProjectIps(data))}
        onIp={(ip) => update((d) => (d.atem!.ip = ip))}
        onRemove={async () => {
          const ok = await confirmDialog({
            title: 'Remove ATEM?',
            message: 'The ATEM and all its names and labels will be removed from this project.',
            confirmLabel: 'Remove',
            danger: true,
          })
          if (ok) update((d) => (d.atem = null))
        }}
        onRead={() => device.open(atem.ip)}
      />
      {device.state && (
        <CompareView
          kind="ATEM"
          state={device.state}
          rows={rows}
          factoryDefaults={new Set(device.reading?.factoryDefaults)}
          modelMismatch={device.reading ? atemModelMismatch(atem, device.reading) : null}
          deviceName={atem.name || 'ATEM'}
          onRetry={() => device.open(atem.ip)}
          onClose={device.close}
          sending={sender.sending}
          sendable={new Set(device.reading ? atemWritePlan(atem, device.reading, 'all').ports.map((p) => `${p.kind}:${p.n}`) : [])}
          onSend={(keys) => device.state?.status === 'done' && sender.send(device.state.ip, atemWritePlan(atem, device.state.reading, keys))}
          onApply={(keys, adoptModel) => {
            const reading = device.reading!
            const after = applyAtemReading(atem, reading, keys, adoptModel)
            const changed = changedPortCount(atem, after)
            const switched = after.model !== atem.model ? ` and switched to ${atemModelLabel(after)}` : ''
            update((d) => (d.atem = after))
            setUndo({ before: atem, after, message: `Copied ${changed} name${changed === 1 ? '' : 's'} from the ATEM${switched}` })
            device.close()
          }}
        />
      )}
      {sender.undo && <UndoToast message={sender.undo.message} onUndo={sender.undoSend} onDismiss={sender.dismissUndo} />}
      {undo && JSON.stringify(atem) === JSON.stringify(undo.after) && (
        <UndoToast
          message={undo.message}
          onDismiss={dismissUndo}
          onUndo={() => {
            const { before } = undo
            update((d) => (d.atem = before))
            setUndo(null)
          }}
        />
      )}
      {phone && (
        <Segmented
          label="Show"
          value={side}
          onChange={setSide}
          options={[
            { value: 'in', label: 'Inputs', detail: String(atem.inputs.length) },
            { value: 'out', label: 'Outputs', detail: String(atem.outputs.length) },
          ]}
        />
      )}
      <div className="grids">
        {(!phone || side === 'in') && (
          <PortTable
            model={atem.model}
            title="Inputs"
            grid="atem-in"
            ports={atem.inputs}
            numberLabel={(p) => String(p.n)}
            onChange={(i, patch) => update((d) => Object.assign(d.atem!.inputs[i]!, patch))}
            onReset={() => update((d) => resetAtemPorts(d.atem!.model, d.atem!.inputs))}
            onClear={() => update((d) => clearAtemPorts(d.atem!.inputs))}
          />
        )}
        {(!phone || side === 'out') && (
          <PortTable
            model={atem.model}
            title="Outputs"
            grid="atem-out"
            ports={atem.outputs}
            numberLabel={(p) => atemOutputLabel(p as AtemOutput)}
            onChange={(i, patch) => update((d) => Object.assign(d.atem!.outputs[i]!, patch))}
            onReset={() => update((d) => resetAtemPorts(d.atem!.model, d.atem!.outputs))}
            onClear={() => update((d) => clearAtemPorts(d.atem!.outputs))}
          />
        )}
      </div>
    </div>
  )
}

interface PortTableProps<P extends AtemInput | AtemOutput> {
  model: string
  title: string
  grid: string
  ports: P[]
  numberLabel: (p: P) => string
  onChange: (index: number, patch: Partial<AtemInput>) => void
  onReset: () => void
  onClear: () => void
}

function PortTable<P extends AtemInput | AtemOutput>({ model, title, grid, ports, numberLabel, onChange, onReset, onClear }: PortTableProps<P>) {
  // Ports still on the device's default name ("Camera 1", "Output 1") don't count as labeled.
  const labeled = ports.filter((p) => !atemPortIsDefault(model, p)).length
  const sheet = useEditSheet<number>()
  // On touch devices cells are read-only and open the edit sheet instead.
  const touchCell = (i: number, field: string) =>
    sheet.touch ? { readOnly: true, onClick: () => sheet.open(i, field) } : {}
  // A blank Name is "not set": the ATEM keeps its own name. Show the default in grey.
  const defaultOf = (p: P) => atemDefaultName(model, 'kind' in p ? p.kind : 'in', p.n)
  const contextRow = (p: P | undefined) =>
    p && { num: numberLabel(p), label: p.long || defaultOf(p), unset: !p.long, extra: p.short ?? autoShortName(p.long || defaultOf(p)) }
  const editing = sheet.target === null ? undefined : ports[sheet.target]
  return (
    <section className="card grid-card">
      <header className="card-head">
        <h3>{title}</h3>
        <span className="muted">
          {labeled} of {ports.length} labeled
        </span>
        <ListMenu
          device="ATEM"
          list={title.toLowerCase()}
          firstDefault={ports[0] ? atemDefaultName(model, 'kind' in ports[0] ? ports[0].kind : 'in', 1) : ''}
          named={labeled}
          onReset={onReset}
          onClear={onClear}
        />
      </header>
      <table className="label-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>
              Name <span className="muted">({ATEM_LONG_MAX})</span>
            </th>
            <th className="short">
              Label <span className="muted">({ATEM_SHORT_MAX})</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p, i) => {
            const issues = atemLabelIssues(p)
            return (
              <tr key={numberLabel(p)}>
                <td className="num mono">{numberLabel(p)}</td>
                <td>
                  <input
                    {...cellProps(grid, i, 'long')}
                    {...touchCell(i, 'long')}
                    value={p.long}
                    placeholder={defaultOf(p)}
                    maxLength={Math.max(ATEM_LONG_MAX, p.long.length)}
                    className={`${p.long ? '' : 'is-unset'} ${issues.includes('long-too-long') || issues.includes('non-ascii') ? 'is-error' : ''}`}
                    title={
                      issues.map((x) => LABEL_ISSUE_TEXT[x]).join('\n') ||
                      (p.long ? undefined : `Not set: the ATEM keeps its own name (${defaultOf(p)} by default)`)
                    }
                    onChange={(e) => onChange(i, { long: e.target.value })}
                  />
                </td>
                <td className="short">
                  <input
                    {...cellProps(grid, i, 'short')}
                    {...touchCell(i, 'short')}
                    className={`mono ${p.short === null ? 'is-auto' : ''} ${issues.includes('short-too-long') ? 'is-error' : ''}`}
                    value={p.short ?? ''}
                    placeholder={autoShortName(p.long || defaultOf(p))}
                    maxLength={Math.max(ATEM_SHORT_MAX, p.short?.length ?? 0)}
                    title={p.short === null ? 'Label auto-generated from the name. Type to override; clear to go back to auto.' : undefined}
                    onChange={(e) => onChange(i, { short: e.target.value === '' ? null : e.target.value })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing && sheet.target !== null && (
        <EditSheet
          ref={sheet.ref}
          kind="ATEM"
          title={`${title === 'Inputs' ? 'Input' : 'Output'} ${numberLabel(editing)}`}
          context={{
            before: contextRow(ports[sheet.target - 1]),
            after: contextRow(ports[sheet.target + 1]),
          }}
          onClose={sheet.close}
          fields={[
            {
              key: 'long',
              label: 'Name',
              value: editing.long,
              placeholder: defaultOf(editing),
              hint: editing.long ? undefined : `Not set: the ATEM keeps its own name (${defaultOf(editing)} by default).`,
              max: ATEM_LONG_MAX,
              onChange: (long) => onChange(sheet.target!, { long }),
            },
            {
              key: 'short',
              label: 'Label',
              value: editing.short ?? '',
              placeholder: autoShortName(editing.long || defaultOf(editing)),
              max: ATEM_SHORT_MAX,
              mono: true,
              hint: editing.short === null ? 'Auto-generated. Type to override.' : 'Clear to go back to auto.',
              onChange: (short: string) => onChange(sheet.target!, { short: short === '' ? null : short }),
            },
          ]}
        />
      )}
    </section>
  )
}
