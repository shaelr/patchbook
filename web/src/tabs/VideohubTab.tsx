import {
  applyVideohubReading,
  videohubWritePlan,
  changedPortCount,
  compareVideohub,
  findVideohubModel,
  videohubFromReading,
  type Videohub,
  type VideohubReading,
  CUSTOM_MODEL,
  VIDEOHUB_MODELS,
  allProjectIps,
  buildVideohub,
  clearVideohubPorts,
  resetVideohubPorts,
  videohubDefaultName,
  droppedVideohubLabels,
  videohubPortIsDefault,
  ipIssues,
  videohubCounts,
  videohubModelLabel,
  type ProjectData,
  type VideohubCounts,
  type VideohubPort,
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

function videohubModelMismatch(hub: Videohub, reading: VideohubReading): { device: string; project: string } | null {
  const same =
    reading.model === hub.model &&
    (reading.model !== CUSTOM_MODEL || (hub.inputs.length === reading.counts.inputs && hub.outputs.length === reading.counts.outputs))
  if (same) return null
  return { device: findVideohubModel(reading.model)?.label ?? reading.modelName, project: videohubModelLabel(hub) }
}

const COUNT_FIELDS = [
  { key: 'inputs' as const, label: 'Inputs', max: 576 },
  { key: 'outputs' as const, label: 'Outputs', max: 576 },
]

export function VideohubTab({ data, update }: { data: ProjectData; update: ProjectUpdate }) {
  const hub = data.videohub
  const phone = useIsPhone()
  const [side, setSide] = useState<'in' | 'out'>('in')
  const device = useDeviceRead(api.readVideohub)
  // See AtemTab: undo a copy only while the Videohub is still exactly as the copy left it.
  const [undo, setUndo] = useState<{ before: Videohub; after: Videohub; message: string } | null>(null)
  const dismissUndo = useCallback(() => setUndo(null), [])
  const sender = useDeviceSend({ kind: 'Videohub', unit: 'label', write: api.writeVideohub, onReading: device.setReading })
  const rows = useMemo(() => (hub && device.reading ? compareVideohub(hub, device.reading) : []), [hub, device.reading])

  const setModel = async (model: string, counts: VideohubCounts) => {
    const next = buildVideohub(model, model === CUSTOM_MODEL ? counts : null, hub)
    const dropped = hub ? droppedVideohubLabels(hub, next) : 0
    if (
      dropped &&
      !(await confirmDialog({
        title: 'Change model?',
        message: `The new model has fewer ports. ${dropped} label${dropped === 1 ? '' : 's'} you entered will be removed.`,
        confirmLabel: 'Change model',
        danger: true,
      }))
    )
      return
    update((d) => (d.videohub = next))
  }

  if (!hub) {
    return (
      <EmptyDevice
        kind="Videohub"
        models={VIDEOHUB_MODELS}
        onAdd={(model) => update((d) => (d.videohub = buildVideohub(model, null, null)))}
        onCustom={() => update((d) => (d.videohub = buildVideohub(CUSTOM_MODEL, { inputs: 16, outputs: 16 }, null)))}
        onReadDevice={async (ip) => {
          const reading = await api.readVideohub(ip)
          update((d) => (d.videohub = videohubFromReading(reading, ip)))
        }}
      />
    )
  }

  return (
    <div className="tab-body">
      <DeviceHeader
        kind="Videohub"
        modelLabel={videohubModelLabel(hub)}
        models={VIDEOHUB_MODELS}
        model={hub.model}
        counts={videohubCounts(hub)}
        countFields={COUNT_FIELDS}
        onModel={setModel}
        name={hub.name}
        onName={(name) => update((d) => (d.videohub!.name = name))}
        ip={hub.ip}
        ipIssues={ipIssues(hub.ip, data.subnet, allProjectIps(data))}
        onIp={(ip) => update((d) => (d.videohub!.ip = ip))}
        onRemove={async () => {
          const ok = await confirmDialog({
            title: 'Remove Videohub?',
            message: 'The Videohub and all its labels will be removed from this project.',
            confirmLabel: 'Remove',
            danger: true,
          })
          if (ok) update((d) => (d.videohub = null))
        }}
        onRead={() => device.open(hub.ip)}
      />
      {device.state && (
        <CompareView
          kind="Videohub"
          state={device.state}
          rows={rows}
          modelMismatch={device.reading ? videohubModelMismatch(hub, device.reading) : null}
          deviceName={hub.name || 'Videohub'}
          onRetry={() => device.open(hub.ip)}
          onClose={device.close}
          sending={sender.sending}
          sendable={new Set(device.reading ? videohubWritePlan(hub, device.reading, 'all').ports.map((p) => `${p.side}:${p.n}`) : [])}
          onSend={(keys) => device.state?.status === 'done' && sender.send(device.state.ip, videohubWritePlan(hub, device.state.reading, keys))}
          onApply={(keys, adoptModel) => {
            const reading = device.reading!
            const after = applyVideohubReading(hub, reading, keys, adoptModel)
            const changed = changedPortCount(hub, after)
            const switched = after.model !== hub.model ? ` and switched to ${videohubModelLabel(after)}` : ''
            update((d) => (d.videohub = after))
            setUndo({ before: hub, after, message: `Copied ${changed} label${changed === 1 ? '' : 's'} from the Videohub${switched}` })
            device.close()
          }}
        />
      )}
      {sender.undo && <UndoToast message={sender.undo.message} onUndo={sender.undoSend} onDismiss={sender.dismissUndo} />}
      {undo && JSON.stringify(hub) === JSON.stringify(undo.after) && (
        <UndoToast
          message={undo.message}
          onDismiss={dismissUndo}
          onUndo={() => {
            const { before } = undo
            update((d) => (d.videohub = before))
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
            { value: 'in', label: 'Inputs', detail: String(hub.inputs.length) },
            { value: 'out', label: 'Outputs', detail: String(hub.outputs.length) },
          ]}
        />
      )}
      <div className="grids">
        {(!phone || side === 'in') && (
          <PortTable
            side="in"
            title="Inputs"
            grid="vh-in"
            ports={hub.inputs}
            onChange={(i, label) => update((d) => (d.videohub!.inputs[i]!.label = label))}
            onReset={() => update((d) => resetVideohubPorts('in', d.videohub!.inputs))}
            onClear={() => update((d) => clearVideohubPorts(d.videohub!.inputs))}
          />
        )}
        {(!phone || side === 'out') && (
          <PortTable
            side="out"
            title="Outputs"
            grid="vh-out"
            ports={hub.outputs}
            onChange={(i, label) => update((d) => (d.videohub!.outputs[i]!.label = label))}
            onReset={() => update((d) => resetVideohubPorts('out', d.videohub!.outputs))}
            onClear={() => update((d) => clearVideohubPorts(d.videohub!.outputs))}
          />
        )}
      </div>
    </div>
  )
}

interface PortTableProps {
  side: 'in' | 'out'
  title: string
  grid: string
  ports: VideohubPort[]
  onChange: (index: number, label: string) => void
  onReset: () => void
  onClear: () => void
}

function PortTable({ side, title, grid, ports, onChange, onReset, onClear }: PortTableProps) {
  const labeled = ports.filter((p) => !videohubPortIsDefault(side, p)).length
  const sheet = useEditSheet<number>()
  // A blank label is "not set": the Videohub keeps its own. Show the default in grey.
  const defaultOf = (p: VideohubPort) => videohubDefaultName(side, p.n)
  const contextRow = (p: VideohubPort | undefined) => p && { num: String(p.n), label: p.label || defaultOf(p), unset: !p.label }
  const editing = sheet.target === null ? undefined : ports[sheet.target]
  return (
    <section className="card grid-card">
      <header className="card-head">
        <h3>{title}</h3>
        <span className="muted">
          {labeled} of {ports.length} labeled
        </span>
        <ListMenu
          device="Videohub"
          list={title.toLowerCase()}
          firstDefault={videohubDefaultName(side, 1)}
          named={labeled}
          onReset={onReset}
          onClear={onClear}
        />
      </header>
      <table className="label-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p, i) => (
            <tr key={p.n}>
              <td className="num figures">{p.n}</td>
              <td>
                <input
                  {...cellProps(grid, i, 'label')}
                  {...(sheet.touch ? { readOnly: true, onClick: () => sheet.open(i, 'label') } : {})}
                  value={p.label}
                  placeholder={defaultOf(p)}
                  className={p.label ? undefined : 'is-unset'}
                  title={p.label ? undefined : `Not set: the Videohub keeps its own label (${defaultOf(p)} by default)`}
                  onChange={(e) => onChange(i, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && sheet.target !== null && (
        <EditSheet
          ref={sheet.ref}
          kind="Videohub"
          title={`${title === 'Inputs' ? 'Input' : 'Output'} ${editing.n}`}
          context={{
            before: contextRow(ports[sheet.target - 1]),
            after: contextRow(ports[sheet.target + 1]),
          }}
          onClose={sheet.close}
          fields={[
            {
              key: 'label',
              label: 'Label',
              value: editing.label,
              placeholder: defaultOf(editing),
              hint: editing.label ? undefined : `Not set: the Videohub keeps its own label (${defaultOf(editing)} by default).`,
              onChange: (label) => onChange(sheet.target!, label),
            },
          ]}
        />
      )}
    </section>
  )
}
