import { allProjectIps, hostOffset, inferSubnet, IP_ISSUE_TEXT, ipIssues, parseIp, parseSubnet } from './ip.ts'
import { atemLabelIssues, LABEL_ISSUE_TEXT } from './labels.ts'
import type { ProjectData } from './schema.ts'

// Problems in a project, listed per tab so the tab badges can say what they are and jump to each.

/** Where a problem is, so the app can scroll to the field and focus it. */
export type IssueTarget =
  | { kind: 'atem-port'; list: 'in' | 'out'; index: number; field: 'long' | 'short' }
  | { kind: 'device-ip'; device: 'atem' | 'videohub' }
  /** A row in the network list: an entry id, or "atem" / "videohub" for those devices' rows. */
  | { kind: 'network-ip'; key: string }

export interface ProjectIssue {
  tab: 'atem' | 'videohub' | 'network'
  text: string
  target: IssueTarget
}

export function projectIssues(data: ProjectData): ProjectIssue[] {
  const allIps = allProjectIps(data)
  const ipText = (ip: string) => ipIssues(ip, data.subnet, allIps).map((i) => IP_ISSUE_TEXT[i]).join('; ')
  const issues: ProjectIssue[] = []

  if (data.atem) {
    const lists = [
      { list: 'in' as const, ports: data.atem.inputs, name: 'Input' },
      { list: 'out' as const, ports: data.atem.outputs, name: 'Output' },
    ]
    for (const { list, ports, name } of lists) {
      ports.forEach((p, index) => {
        const found = atemLabelIssues(p)
        if (!found.length) return
        // Name problems first: the Name field is where the fix usually starts.
        const field = found.includes('long-too-long') ? 'long' : 'short'
        issues.push({ tab: 'atem', text: `${name} ${p.n}: ${found.map((i) => LABEL_ISSUE_TEXT[i]).join('; ')}`, target: { kind: 'atem-port', list, index, field } })
      })
    }
  }

  for (const device of ['atem', 'videohub'] as const) {
    const ip = data[device]?.ip
    const text = ip ? ipText(ip) : ''
    if (text) issues.push({ tab: device, text: `IP address ${ip}: ${text}`, target: { kind: 'device-ip', device } })
  }

  // The network tab lists every device, the ATEM and Videohub included.
  const rows = [
    ...(data.atem ? [{ key: 'atem', name: data.atem.name || 'ATEM', ip: data.atem.ip }] : []),
    ...(data.videohub ? [{ key: 'videohub', name: data.videohub.name || 'Videohub', ip: data.videohub.ip }] : []),
    ...data.network.map((e) => ({ key: e.id, name: e.name || 'Unnamed device', ip: e.ip })),
  ]
  for (const row of rows) {
    const text = row.ip ? ipText(row.ip) : ''
    if (text) issues.push({ tab: 'network', text: `${row.name} (${row.ip}): ${text}`, target: { kind: 'network-ip', key: row.key } })
  }
  return issues
}

/**
 * When every IP in the show is outside its subnet and they all share one /24, that /24: the show
 * was most likely created with the default subnet. Otherwise null.
 */
export function suggestedSubnet(data: ProjectData): string | null {
  const values = allProjectIps(data)
    .map((ip) => parseIp(ip)?.value)
    .filter((v): v is number => v !== undefined)
  if (!values.length) return null
  const current = parseSubnet(data.subnet)
  if (current && values.some((v) => hostOffset(v, current) !== null)) return null
  const guess = inferSubnet(allProjectIps(data))
  const subnet = parseSubnet(guess)
  if (!subnet || !values.every((v) => hostOffset(v, subnet) !== null)) return null
  return guess === data.subnet ? null : guess
}
