import { ATEM_LONG_MAX, ATEM_SHORT_MAX, type AtemInput, type AtemOutput } from './schema.ts'

/**
 * Generate the 4-character ATEM label (Blackmagic's "Label", the short name) from the name.
 * Keeps a trailing number or single letter and fills the rest from the start of the name:
 * "Camera 1" → "CAM1", "Laptop A" → "LAPA", "MONITOR" → "MONI". When only two characters are
 * left, it takes the first letter and the next consonant, as the ATEM's own defaults do
 * (seen on a Constellation 4K): "Camera 15" → "CM15", "Output 12" → "OT12".
 */
export function autoShortName(long: string): string {
  const cleaned = long.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim()
  if (!cleaned) return ''
  const words = cleaned.split(/\s+/)
  let suffix = ''
  const last = words[words.length - 1] ?? ''
  if (words.length > 1 && (/^\d{1,3}$/.test(last) || /^[A-Z]$/.test(last))) {
    suffix = last
    words.pop()
  }
  let base = words.join('')
  if (!suffix) {
    const glued = base.match(/^(.*?[A-Z])(\d{1,3})$/)
    if (glued) [base, suffix] = [glued[1]!, glued[2]!]
  }
  const room = Math.max(0, ATEM_SHORT_MAX - suffix.length)
  let prefix = base.slice(0, room)
  if (room === 2 && base.length > 2) {
    const consonant = base.slice(1).match(/[B-DF-HJ-NP-TV-Z]/)?.[0]
    prefix = base[0]! + (consonant ?? base[1]!)
  }
  return (prefix + suffix).slice(0, ATEM_SHORT_MAX)
}

export function resolveShort(port: AtemInput | AtemOutput): string {
  return port.short ?? autoShortName(port.long)
}

export function atemOutputLabel(port: AtemOutput): string {
  return String(port.n)
}

export type LabelIssue = 'long-too-long' | 'short-too-long' | 'non-ascii'

export const LABEL_ISSUE_TEXT: Record<LabelIssue, string> = {
  'long-too-long': `Name is too long for the ATEM (${ATEM_LONG_MAX} bytes; accented and special characters count as 2–4)`,
  'short-too-long': `Label is over ${ATEM_SHORT_MAX} characters`,
  'non-ascii': 'Label can only use plain letters, numbers and symbols (ASCII)',
}

/** UTF-8 byte length: the ATEM limits Names to 20 bytes, not characters (ATEM Switchers SDK). */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function atemLabelIssues(port: AtemInput | AtemOutput): LabelIssue[] {
  const issues: LabelIssue[] = []
  const short = resolveShort(port)
  if (utf8Length(port.long) > ATEM_LONG_MAX) issues.push('long-too-long')
  if (short.length > ATEM_SHORT_MAX) issues.push('short-too-long')
  // Names may be Unicode; Labels must be ASCII.
  if (/[^\x20-\x7e]/.test(short)) issues.push('non-ascii')
  return issues
}
