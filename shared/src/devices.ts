import { CUSTOM_MODEL } from './catalog.ts'
import { atemLabelIssues, autoShortName, LABEL_ISSUE_TEXT, resolveShort } from './labels.ts'
import {
  atemDefaultName,
  atemPortIsDefault,
  buildAtem,
  buildVideohub,
  videohubDefaultName,
  videohubPortIsDefault,
  type AtemCounts,
  type VideohubCounts,
} from './project.ts'
import type { Atem, AtemInput, AtemOutput, Videohub, VideohubPort } from './schema.ts'

// What a device reports when read over the network, and how it compares with the project.

export interface AtemReading {
  /** As the ATEM reports it, e.g. "ATEM 2 M/E Constellation 4K". */
  productName: string
  /** Catalog model id, or "custom" when the model isn't in the catalog. */
  model: string
  counts: AtemCounts
  inputs: Array<{ n: number; long: string; short: string }>
  outputs: Array<{ kind: AtemOutput['kind']; n: number; long: string; short: string }>
  /** Port keys ("in:1", "aux:3") whose names are still the factory defaults. */
  factoryDefaults: string[]
}

/** A Blackmagic device that announced itself on the network (Bonjour, `_blackmagic._tcp`). */
export interface FoundDevice {
  /** The device's unique id, or its name and IP when it doesn't send one. */
  id: string
  /** As the device names itself, e.g. "ATEM 2 M/E Constellation 4K". */
  name: string
  /** Blackmagic's device class, e.g. "AtemSwitcher", "Videohub", "HyperDeck". */
  deviceClass: string
  kind: 'atem' | 'videohub' | 'other'
  ip: string
}

export interface VideohubReading {
  /** As the Videohub reports it, e.g. "Blackmagic Videohub 40x40 12G". */
  modelName: string
  model: string
  counts: VideohubCounts
  inputs: VideohubPort[]
  outputs: VideohubPort[]
}

/**
 * "not-set": the project has no name of its own for the port (blank, or still the default), so the
 * device keeps whatever it has. Shown, but never counted as a difference to send.
 */
export type DiffStatus = 'same' | 'different' | 'not-set' | 'project-only' | 'device-only'

export interface PortDiff {
  /** "in:3", "aux:1" (ATEM) or "in:3", "out:3" (Videohub). */
  key: string
  side: 'in' | 'out'
  /** Port number as shown in the tables. */
  label: string
  project: { name: string; label?: string } | null
  device: { name: string; label?: string } | null
  status: DiffStatus
}

const statusOf = (project: unknown, device: unknown, same: boolean, notSet = false): DiffStatus =>
  !project ? 'device-only' : !device ? 'project-only' : same ? 'same' : notSet ? 'not-set' : 'different'

const atemKey = (kind: 'in' | AtemOutput['kind'], n: number) => `${kind}:${n}`

/** Port numbers present on either side, in order. */
const numbersOf = (a: Array<{ n: number }>, b: Array<{ n: number }>) => [...new Set([...a, ...b].map((p) => p.n))].sort((x, y) => x - y)

/** Port-by-port comparison of the project's ATEM with what the ATEM reported. */
export function compareAtem(project: Atem, reading: AtemReading): PortDiff[] {
  const ofKind = <T extends { kind: string }>(list: T[], kind: string) => list.filter((o) => o.kind === kind)
  const groups = [
    { side: 'in' as const, kind: 'in' as const, ps: project.inputs as Array<AtemInput | AtemOutput>, ds: reading.inputs },
    { side: 'out' as const, kind: 'aux' as const, ps: ofKind(project.outputs, 'aux'), ds: ofKind(reading.outputs, 'aux') },
  ]
  const rows: PortDiff[] = []
  for (const { side, kind, ps, ds } of groups) {
    for (const n of numbersOf(ps, ds)) {
      const p = ps.find((x) => x.n === n)
      const d = ds.find((x) => x.n === n)
      // A blank Name stands for the default name, as the tables show it.
      const name = p ? p.long || atemDefaultName(project.model, kind, n) : ''
      const label = p ? p.short ?? autoShortName(name) : ''
      const notSet = !!p && atemPortIsDefault(project.model, p)
      rows.push({
        key: atemKey(kind, n),
        side,
        label: String(n),
        project: p ? { name, label } : null,
        device: d ? { name: d.long, label: d.short } : null,
        status: statusOf(p, d, !!p && !!d && name === d.long && label === d.short, notSet),
      })
    }
  }
  return rows
}

export function compareVideohub(project: Videohub, reading: VideohubReading): PortDiff[] {
  const rows: PortDiff[] = []
  for (const side of ['in', 'out'] as const) {
    const ps = side === 'in' ? project.inputs : project.outputs
    const ds = side === 'in' ? reading.inputs : reading.outputs
    for (const n of numbersOf(ps, ds)) {
      const p = ps.find((x) => x.n === n)
      const d = ds.find((x) => x.n === n)
      const name = p ? p.label || videohubDefaultName(side, n) : ''
      rows.push({
        key: `${side}:${n}`,
        side,
        label: String(n),
        project: p ? { name } : null,
        device: d ? { name: d.label } : null,
        status: statusOf(p, d, !!p && !!d && name === d.label, !!p && videohubPortIsDefault(side, p)),
      })
    }
  }
  return rows
}

export function diffCounts(rows: PortDiff[]): Record<DiffStatus, number> {
  const counts: Record<DiffStatus, number> = { same: 0, different: 0, 'not-set': 0, 'project-only': 0, 'device-only': 0 }
  for (const r of rows) counts[r.status]++
  return counts
}

/**
 * Copy the device's names into the project's ATEM for the given port keys (or all).
 * With `adoptModel`, the layout first switches to the device's model and port counts.
 * A device label that matches the auto-generated one stays auto.
 */
export function applyAtemReading(atem: Atem, reading: AtemReading, keys: Set<string> | 'all', adoptModel: boolean): Atem {
  const next = adoptModel ? buildAtem(reading.model, reading.model === CUSTOM_MODEL ? reading.counts : null, atem) : structuredClone(atem)
  const take = (key: string) => keys === 'all' || keys.has(key)
  const copy = (target: AtemInput | AtemOutput | undefined, source: { long: string; short: string }) => {
    if (!target) return
    target.long = source.long
    target.short = source.short === autoShortName(source.long) ? null : source.short
  }
  for (const d of reading.inputs) if (take(atemKey('in', d.n))) copy(next.inputs.find((p) => p.n === d.n), d)
  for (const d of reading.outputs) if (take(atemKey(d.kind, d.n))) copy(next.outputs.find((p) => p.kind === d.kind && p.n === d.n), d)
  return next
}

export function applyVideohubReading(hub: Videohub, reading: VideohubReading, keys: Set<string> | 'all', adoptModel: boolean): Videohub {
  const next = adoptModel ? buildVideohub(reading.model, reading.model === CUSTOM_MODEL ? reading.counts : null, hub) : structuredClone(hub)
  const take = (key: string) => keys === 'all' || keys.has(key)
  for (const d of reading.inputs) {
    const target = next.inputs.find((p) => p.n === d.n)
    if (target && take(`in:${d.n}`)) target.label = d.label
  }
  for (const d of reading.outputs) {
    const target = next.outputs.find((p) => p.n === d.n)
    if (target && take(`out:${d.n}`)) target.label = d.label
  }
  return next
}

/** A new ATEM built from a reading: the device's model, ports and names. */
export function atemFromReading(reading: AtemReading, ip: string): Atem {
  const atem = applyAtemReading(buildAtem(reading.model, reading.model === CUSTOM_MODEL ? reading.counts : null, null), reading, 'all', false)
  return { ...atem, ip }
}

export function videohubFromReading(reading: VideohubReading, ip: string): Videohub {
  const hub = applyVideohubReading(buildVideohub(reading.model, reading.model === CUSTOM_MODEL ? reading.counts : null, null), reading, 'all', false)
  return { ...hub, ip }
}

/** Number of ports whose name or label differs between two versions of the same device. */
export function changedPortCount(prev: Atem | Videohub, next: Atem | Videohub): number {
  const key = (p: { n: number; kind?: string }, side: string) => `${side}:${p.kind ?? ''}:${p.n}`
  const text = (p: object) => JSON.stringify(p)
  const before = new Map<string, string>()
  for (const p of prev.inputs) before.set(key(p, 'in'), text(p))
  for (const p of prev.outputs) before.set(key(p, 'out'), text(p))
  let changed = 0
  for (const p of next.inputs) if (before.get(key(p, 'in')) !== text(p)) changed++
  for (const p of next.outputs) if (before.get(key(p, 'out')) !== text(p)) changed++
  return changed
}

/** A Name and Label to set on one ATEM port. */
export interface AtemNameWrite {
  kind: 'in' | 'aux'
  n: number
  long: string
  short: string
}

/** A label to set on one Videohub port. */
export interface VideohubLabelWrite {
  side: 'in' | 'out'
  n: number
  label: string
}

export interface WritePlan<P> {
  /** What will be sent. */
  ports: P[]
  /** Names the device can't take; nothing should be sent while there are any. */
  problems: string[]
  /** The device's current names for the same ports, to send back if the user undoes. */
  undo: P[]
}

const selected = (keys: Set<string> | 'all', key: string) => keys === 'all' || keys.has(key)

/** Which project names to send to the ATEM: selected ports that differ, are set in the project, and exist on both sides. */
export function atemWritePlan(project: Atem, reading: AtemReading, keys: Set<string> | 'all'): WritePlan<AtemNameWrite> {
  const plan: WritePlan<AtemNameWrite> = { ports: [], problems: [], undo: [] }
  for (const row of compareAtem(project, reading)) {
    if (row.status !== 'different' || !selected(keys, row.key)) continue
    const [kind, nText] = row.key.split(':') as ['in' | 'aux', string]
    const n = Number(nText)
    const port = kind === 'in' ? project.inputs.find((p) => p.n === n) : project.outputs.find((p) => p.n === n)
    const device = kind === 'in' ? reading.inputs.find((p) => p.n === n) : reading.outputs.find((p) => p.n === n)
    if (!port || !device) continue
    // Never send a port that isn't set in the project (blank or default): it would overwrite the
    // device's real name with a generic one. compareAtem already marks these "not-set".
    if (atemPortIsDefault(project.model, port)) continue
    const name = `${kind === 'in' ? 'Input' : 'Output'} ${n}`
    for (const issue of atemLabelIssues(port)) plan.problems.push(`${name}: ${LABEL_ISSUE_TEXT[issue]}`)
    plan.ports.push({ kind, n, long: port.long, short: resolveShort(port) })
    plan.undo.push({ kind, n, long: device.long, short: device.short })
  }
  return plan
}

/** Which project labels to send to the Videohub: selected ports that differ and exist on both sides. */
export function videohubWritePlan(project: Videohub, reading: VideohubReading, keys: Set<string> | 'all'): WritePlan<VideohubLabelWrite> {
  const plan: WritePlan<VideohubLabelWrite> = { ports: [], problems: [], undo: [] }
  for (const row of compareVideohub(project, reading)) {
    if (row.status !== 'different' || !selected(keys, row.key)) continue
    const side = row.side
    const n = Number(row.label)
    const port = (side === 'in' ? project.inputs : project.outputs).find((p) => p.n === n)
    const device = (side === 'in' ? reading.inputs : reading.outputs).find((p) => p.n === n)
    if (!port || !device) continue
    if (videohubPortIsDefault(side, port)) continue
    plan.ports.push({ side, n, label: port.label })
    plan.undo.push({ side, n, label: device.label })
  }
  return plan
}
