import { CUSTOM_MODEL, findAtemModel, findVideohubModel } from './catalog.ts'
import { compareIps, DEFAULT_IP_RANGES, DEFAULT_SUBNET, rangeForIp } from './ip.ts'
import type { Atem, AtemInput, AtemOutput, IpRange, ProjectData, Videohub, VideohubPort } from './schema.ts'

export function newProjectData(name: string, subnet: string = DEFAULT_SUBNET): ProjectData {
  return {
    name,
    notes: '',
    subnet,
    ipRanges: structuredClone(DEFAULT_IP_RANGES),
    atem: null,
    videohub: null,
    network: [],
  }
}

/** Default role labels whose wording changed; projects still using the old wording get the new one. */
const RENAMED_RANGE_LABELS: Record<string, [old: string, current: string]> = {
  gateway: ['Gateway / router', 'Gateway / Router'],
  infrastructure: ['Network infrastructure', 'Network Infrastructure'],
  switching: ['Switching & control', 'Switching & Control'],
  'spare-a': ['Spare / misc', 'Spare / Misc'],
  recording: ['Record / playback', 'Record / Playback'],
  dhcp: ['DHCP pool', 'DHCP Pool'],
  audio: ['Audio, comms, reserved', 'Audio, Comms, Reserved'],
}

/** Bring stored project data up to date with current defaults (labels the user changed are left alone). */
export function upgradeProjectData(data: ProjectData): ProjectData {
  for (const range of data.ipRanges) {
    const renamed = RENAMED_RANGE_LABELS[range.id]
    if (renamed && range.label === renamed[0]) range.label = renamed[1]
  }
  return data
}

export interface NetworkRow {
  key: string
  name: string
  ip: string
  /** Set for the ATEM / Videohub rows, whose name and IP live on the device. */
  device?: 'atem' | 'videohub'
  /** Index into data.network for ordinary entries. */
  index?: number
}

/** Every device in the network list (ATEM, Videohub and entries), sorted by IP; rows without a valid IP go last. */
export function networkRows(data: ProjectData): NetworkRow[] {
  const rows: NetworkRow[] = [
    ...(data.atem ? [{ key: 'atem', name: data.atem.name, ip: data.atem.ip, device: 'atem' as const }] : []),
    ...(data.videohub ? [{ key: 'videohub', name: data.videohub.name, ip: data.videohub.ip, device: 'videohub' as const }] : []),
    ...data.network.map((e, index) => ({ key: e.id, name: e.name, ip: e.ip, index })),
  ]
  return rows.sort((a, b) => compareIps(a.ip, b.ip))
}

export interface NetworkGroup {
  /** Range id, or "other" for rows with no IP or an IP outside every range. */
  key: string
  label: string
  /** Host span, e.g. ".30–.49"; empty for "other". */
  span: string
  /** Number of addresses in the range; 0 for "other". */
  size: number
  rows: NetworkRow[]
}

export function rangeSpan(range: IpRange): string {
  return range.start === range.end ? `.${range.start}` : `.${range.start}–.${range.end}`
}

/**
 * Network rows grouped by role range (in range order), keeping the given row order within
 * each group. Empty groups are left out; rows outside every range come last.
 * `rangeOf` lets the editor keep a row in its group while its IP is being edited.
 */
export function networkGroups(
  data: ProjectData,
  rows: NetworkRow[] = networkRows(data),
  rangeOf: (row: NetworkRow) => IpRange | null = (row) => rangeForIp(row.ip, data),
): NetworkGroup[] {
  const ranges = [...data.ipRanges].sort((a, b) => a.start - b.start)
  const groups: NetworkGroup[] = ranges.map((r) => ({ key: r.id, label: r.label, span: rangeSpan(r), size: r.end - r.start + 1, rows: [] }))
  const other: NetworkGroup = { key: 'other', label: 'No IP / outside ranges', span: '', size: 0, rows: [] }
  for (const row of rows) {
    const range = rangeOf(row)
    ;(groups.find((g) => g.key === range?.id) ?? other).rows.push(row)
  }
  return [...groups, other].filter((g) => g.rows.length > 0)
}

export interface AtemCounts {
  inputs: number
  aux: number
  mvs: number
}

export interface VideohubCounts {
  inputs: number
  outputs: number
}

export function atemCounts(atem: Atem): AtemCounts {
  return {
    inputs: atem.inputs.length,
    aux: atem.outputs.length,
    mvs: atem.multiviews.length,
  }
}

export function videohubCounts(hub: Videohub): VideohubCounts {
  return { inputs: hub.inputs.length, outputs: hub.outputs.length }
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

type AtemPortKind = 'in' | AtemOutput['kind']

const atemKind = (p: AtemInput | AtemOutput): AtemPortKind => ('kind' in p ? p.kind : 'in')

/**
 * The name an ATEM gives a port out of the box: "Camera 1" for inputs, "Aux 1" or "Output 1"
 * for outputs (depending on the model family). Labels are left to auto.
 */
export function atemDefaultName(model: string, kind: AtemPortKind, n: number): string {
  if (kind === 'in') return `Camera ${n}`
  return `${findAtemModel(model)?.outputPrefix ?? 'Output'} ${n}`
}

export function videohubDefaultName(side: 'in' | 'out', n: number): string {
  return `${side === 'in' ? 'Input' : 'Output'} ${n}`
}

/** True when a port has no name of its own: empty, or still the device's default name and auto label. */
export function atemPortIsDefault(model: string, p: AtemInput | AtemOutput): boolean {
  return p.short === null && (p.long.trim() === '' || p.long === atemDefaultName(model, atemKind(p), p.n))
}

export function videohubPortIsDefault(side: 'in' | 'out', p: VideohubPort): boolean {
  return p.label.trim() === '' || p.label === videohubDefaultName(side, p.n)
}

/**
 * Build an ATEM layout for a model (or custom counts). Names carry over from the previous
 * layout wherever the same port still exists; new ports, and ports still on the old model's
 * default names, get this model's defaults. Multiview notes carry over by number.
 */
export function buildAtem(model: string, custom: AtemCounts | null, prev: Atem | null): Atem {
  const counts = findAtemModel(model) ?? custom
  if (!counts) throw new Error(`Unknown ATEM model: ${model}`)
  const prevPorts = new Map<string, AtemInput | AtemOutput>()
  for (const p of [...(prev?.inputs ?? []), ...(prev?.outputs ?? [])]) prevPorts.set(`${atemKind(p)}:${p.n}`, p)
  const name = (kind: AtemPortKind, n: number): Pick<AtemInput, 'long' | 'short'> => {
    const old = prevPorts.get(`${kind}:${n}`)
    const isOldDefault = old && prev && old.long.trim() !== '' && atemPortIsDefault(prev.model, old)
    if (old && !isOldDefault) return { long: old.long, short: old.short }
    return { long: atemDefaultName(model, kind, n), short: null }
  }
  return {
    model: findAtemModel(model) ? model : CUSTOM_MODEL,
    name: prev?.name ?? 'ATEM',
    ip: prev?.ip ?? '',
    inputs: range(counts.inputs).map((n) => ({ n, ...name('in', n) })),
    outputs: [
      ...range(counts.aux).map((n) => ({ kind: 'aux' as const, n, ...name('aux', n) })),
    ],
    multiviews: range(counts.mvs).map((n) => ({ n, note: prev?.multiviews.find((m) => m.n === n)?.note ?? '' })),
  }
}

export function buildVideohub(model: string, custom: VideohubCounts | null, prev: Videohub | null): Videohub {
  const counts = findVideohubModel(model) ?? custom
  if (!counts) throw new Error(`Unknown Videohub model: ${model}`)
  const carry = (side: 'in' | 'out', prevPorts: VideohubPort[] | undefined, count: number) => {
    const byN = new Map(prevPorts?.map((p) => [p.n, p]))
    return range(count).map((n) => byN.get(n) ?? { n, label: videohubDefaultName(side, n) })
  }
  return {
    model: findVideohubModel(model) ? model : CUSTOM_MODEL,
    name: prev?.name ?? 'Videohub',
    ip: prev?.ip ?? '',
    inputs: carry('in', prev?.inputs, counts.inputs),
    outputs: carry('out', prev?.outputs, counts.outputs),
  }
}

/** Put a list of ATEM ports back to their default names with auto labels. */
export function resetAtemPorts(model: string, ports: Array<AtemInput | AtemOutput>): void {
  for (const p of ports) {
    p.long = atemDefaultName(model, atemKind(p), p.n)
    p.short = null
  }
}

/** Empty every name and label in a list of ATEM ports. */
export function clearAtemPorts(ports: Array<AtemInput | AtemOutput>): void {
  for (const p of ports) {
    p.long = ''
    p.short = null
  }
}

export function resetVideohubPorts(side: 'in' | 'out', ports: VideohubPort[]): void {
  for (const p of ports) p.label = videohubDefaultName(side, p.n)
}

export function clearVideohubPorts(ports: VideohubPort[]): void {
  for (const p of ports) p.label = ''
}

/** Number of named ATEM ports (not defaults) in `prev` that no longer exist in `next`. */
export function droppedAtemNames(prev: Atem, next: Atem): number {
  const keys = new Set([...next.inputs, ...next.outputs].map((p) => `${atemKind(p)}:${p.n}`))
  return [...prev.inputs, ...prev.outputs].filter((p) => !keys.has(`${atemKind(p)}:${p.n}`) && !atemPortIsDefault(prev.model, p)).length
}

/** Number of multiview notes in `prev` that no longer exist in `next`. */
export function droppedMultiviewNotes(prev: Atem, next: Atem): number {
  return prev.multiviews.filter((m) => m.n > next.multiviews.length && m.note.trim() !== '').length
}

/** Number of labelled Videohub ports (not defaults) in `prev` that no longer exist in `next`. */
export function droppedVideohubLabels(prev: Videohub, next: Videohub): number {
  const lost = (side: 'in' | 'out', from: VideohubPort[], to: VideohubPort[]) =>
    from.filter((p) => p.n > to.length && !videohubPortIsDefault(side, p)).length
  return lost('in', prev.inputs, next.inputs) + lost('out', prev.outputs, next.outputs)
}

export function atemModelLabel(atem: Atem): string {
  if (atem.model !== CUSTOM_MODEL) return findAtemModel(atem.model)?.label ?? atem.model
  const c = atemCounts(atem)
  return `Custom ATEM (${c.inputs} in / ${c.aux} out${c.mvs ? ` / ${c.mvs} MV` : ''})`
}

export function videohubModelLabel(hub: Videohub): string {
  if (hub.model !== CUSTOM_MODEL) return findVideohubModel(hub.model)?.label ?? hub.model
  return `Custom Videohub (${hub.inputs.length}x${hub.outputs.length})`
}

export function newId(): string {
  return crypto.randomUUID()
}
