import type { IpRange, ProjectData } from './schema.ts'

export const DEFAULT_SUBNET = '192.168.10.0/24'

export const DEFAULT_IP_RANGES: IpRange[] = [
  { id: 'gateway', label: 'Gateway / Router', start: 1, end: 1 },
  { id: 'infrastructure', label: 'Network Infrastructure', start: 2, end: 9 },
  { id: 'switching', label: 'Switching & Control', start: 10, end: 19 },
  { id: 'spare-a', label: 'Spare / Misc', start: 20, end: 29 },
  { id: 'recording', label: 'Record / Playback', start: 30, end: 49 },
  { id: 'automation', label: 'Automation', start: 50, end: 59 },
  { id: 'cameras', label: 'Cameras', start: 60, end: 99 },
  { id: 'computers', label: 'Computers', start: 100, end: 119 },
  { id: 'spare-b', label: 'Spare', start: 120, end: 149 },
  { id: 'dhcp', label: 'DHCP Pool', start: 150, end: 199 },
  { id: 'audio', label: 'Audio, Comms, Reserved', start: 200, end: 254 },
]

export interface ParsedIp {
  value: number
  normalized: string
  /** True when an octet had a leading zero (e.g. "09"), which some software reads as octal. */
  leadingZero: boolean
}

export function parseIp(input: string): ParsedIp | null {
  const parts = input.trim().split('.')
  if (parts.length !== 4) return null
  let value = 0
  let leadingZero = false
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    if (part.length > 1 && part.startsWith('0')) leadingZero = true
    value = value * 256 + octet
  }
  return { value, normalized: formatIp(value), leadingZero }
}

export function formatIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.')
}

export interface Subnet {
  network: number
  prefix: number
  size: number
}

export function parseSubnet(cidr: string): Subnet | null {
  const [addr, prefixText] = cidr.trim().split('/')
  const ip = parseIp(addr ?? '')
  const prefix = Number(prefixText)
  if (!ip || !/^\d{1,2}$/.test(prefixText ?? '') || prefix < 8 || prefix > 30) return null
  const size = 2 ** (32 - prefix)
  return { network: ip.value - (ip.value % size), prefix, size }
}

export function hostOffset(ip: number, subnet: Subnet): number | null {
  const offset = ip - subnet.network
  return offset >= 0 && offset < subnet.size ? offset : null
}

export function rangeForIp(ip: string, data: Pick<ProjectData, 'subnet' | 'ipRanges'>): IpRange | null {
  const parsed = parseIp(ip)
  const subnet = parseSubnet(data.subnet)
  if (!parsed || !subnet) return null
  const offset = hostOffset(parsed.value, subnet)
  if (offset === null) return null
  return data.ipRanges.find((r) => offset >= r.start && offset <= r.end) ?? null
}

/** Every IP in the project, including the ATEM and Videohub. */
export function allProjectIps(data: ProjectData): string[] {
  const ips = data.network.map((e) => e.ip)
  if (data.atem) ips.push(data.atem.ip)
  if (data.videohub) ips.push(data.videohub.ip)
  return ips.filter((ip) => ip.trim() !== '')
}

export function nextFreeIp(range: IpRange, data: ProjectData): string | null {
  const subnet = parseSubnet(data.subnet)
  if (!subnet) return null
  const used = new Set(allProjectIps(data).map((ip) => parseIp(ip)?.value))
  for (let offset = range.start; offset <= range.end; offset++) {
    if (offset <= 0 || offset >= subnet.size - 1) continue
    const value = subnet.network + offset
    if (!used.has(value)) return formatIp(value)
  }
  return null
}

export type IpIssue = 'invalid' | 'leading-zero' | 'duplicate' | 'outside-subnet' | 'reserved'

export const IP_ISSUE_TEXT: Record<IpIssue, string> = {
  invalid: 'Not a valid IP address',
  'leading-zero': 'Leading zero (some devices read it as octal)',
  duplicate: 'Used by another device',
  'outside-subnet': 'Outside the project subnet',
  reserved: 'Network or broadcast address',
}

/** Issues for one IP, given the full list of project IPs (for duplicate detection). */
export function ipIssues(ip: string, subnetCidr: string, allIps: string[]): IpIssue[] {
  if (ip.trim() === '') return []
  const parsed = parseIp(ip)
  if (!parsed) return ['invalid']
  const issues: IpIssue[] = []
  if (parsed.leadingZero) issues.push('leading-zero')
  const count = allIps.filter((other) => parseIp(other)?.value === parsed.value).length
  if (count > 1) issues.push('duplicate')
  const subnet = parseSubnet(subnetCidr)
  if (subnet) {
    const offset = hostOffset(parsed.value, subnet)
    if (offset === null) issues.push('outside-subnet')
    else if (offset === 0 || offset === subnet.size - 1) issues.push('reserved')
  }
  return issues
}

/** The most common /24 among the given IPs, or the default subnet. */
export function inferSubnet(ips: string[]): string {
  const counts = new Map<string, number>()
  for (const ip of ips) {
    const parsed = parseIp(ip)
    if (!parsed) continue
    const net = formatIp(parsed.value - (parsed.value % 256)) + '/24'
    counts.set(net, (counts.get(net) ?? 0) + 1)
  }
  let best = DEFAULT_SUBNET
  let bestCount = 0
  for (const [net, count] of counts) {
    if (count > bestCount) [best, bestCount] = [net, count]
  }
  return best
}

export function compareIps(a: string, b: string): number {
  const pa = parseIp(a)?.value ?? Infinity
  const pb = parseIp(b)?.value ?? Infinity
  return pa === pb ? 0 : pa < pb ? -1 : 1
}
