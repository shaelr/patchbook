import net from 'node:net'
import { CUSTOM_MODEL, VIDEOHUB_MODELS, type VideohubLabelWrite, type VideohubReading } from '@patchbook/shared'
import { DeviceError } from './errors.ts'

// Blackmagic Videohub Ethernet Protocol (v2.3, see VideohubEthernetProtocol.pdf): text blocks over
// TCP 9990. Each block is an all-caps header ending in ":", lines of data, then a blank line. On
// connect the hub sends its full state; we read the device and label blocks, then disconnect.
// Newer servers (seen: v2.8) end the initial dump with an "END PRELUDE:" block.

export const VIDEOHUB_PORT = 9990

export interface ReadOptions {
  port?: number
  timeoutMs?: number
}

type Blocks = Map<string, string[]>

/** Split protocol text into complete blocks; returns the blocks and any unfinished remainder. */
export function parseBlocks(text: string): { blocks: Array<[string, string[]]>; rest: string } {
  const normalized = text.replace(/\r\n?/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const blocks: Array<[string, string[]]> = []
  for (const part of parts) {
    const lines = part.split('\n').filter((l, i) => i > 0 || l.trim() !== '')
    const header = lines.shift()?.trim()
    if (header) blocks.push([header, lines])
  }
  return { blocks, rest }
}

/** "0 Camera 1" lines → ports numbered from 1 (the protocol numbers from 0). Later lines win. */
function labels(lines: string[] | undefined) {
  const byPort = new Map<number, string>()
  for (const line of lines ?? []) {
    const match = line.match(/^(\d+) ?(.*)$/)
    if (match) byPort.set(Number(match[1]) + 1, match[2]!.trimEnd())
  }
  return [...byPort].map(([n, label]) => ({ n, label })).sort((a, b) => a.n - b.n)
}

function deviceInfo(lines: string[]): Record<string, string> {
  const info: Record<string, string> = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i > 0) info[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return info
}

const norm = (text: string) => text.toLowerCase().replace(/blackmagic/g, '').replace(/[^a-z0-9]/g, '')

/** Catalog model for a reported model name, falling back to a unique match on port counts. */
export function matchVideohubModel(modelName: string, inputs: number, outputs: number): string {
  const byName = VIDEOHUB_MODELS.find((m) => norm(m.label) === norm(modelName))
  if (byName) return byName.id
  const byCounts = VIDEOHUB_MODELS.filter((m) => m.inputs === inputs && m.outputs === outputs)
  return byCounts.length === 1 ? byCounts[0]!.id : CUSTOM_MODEL
}

/** Build a reading once the device and both label blocks have arrived; null until then. */
export function readingFromBlocks(blocks: Blocks): VideohubReading | null {
  const device = blocks.get('VIDEOHUB DEVICE:')
  if (!device) return null
  const info = deviceInfo(device)
  const present = info['device present']
  if (present === 'false') throw new DeviceError('no-device', 'The Videohub server reports no router connected.')
  if (present?.startsWith('needs')) throw new DeviceError('needs-update', 'The Videohub needs a firmware update before it can be read.')
  if (!blocks.has('INPUT LABELS:') || !blocks.has('OUTPUT LABELS:')) return null
  const inputs = labels(blocks.get('INPUT LABELS:'))
  const outputs = labels(blocks.get('OUTPUT LABELS:'))
  const counts = {
    inputs: Number(info['video inputs']) || inputs.length,
    outputs: Number(info['video outputs']) || outputs.length,
  }
  const modelName = info['model name'] ?? 'Videohub'
  return { modelName, model: matchVideohubModel(modelName, counts.inputs, counts.outputs), counts, inputs, outputs }
}

/** An open connection: everything the hub has sent so far, plus ways to wait on it and send. */
interface Session {
  blocks: Blocks
  /** ACK / NAK replies, in order. */
  replies: string[]
  /** Resolve once `ready()` returns a value; reject on timeout, error or disconnect. */
  until<T>(ready: () => T | null | undefined, timeoutMs: number, timeoutMessage: string): Promise<T>
  send(text: string): void
  close(): void
}

function connect(host: string, port: number): Session {
  const socket = net.createConnection({ host, port })
  const blocks: Blocks = new Map()
  const replies: string[] = []
  const waiters = new Set<() => void>()
  let failure: Error | null = null
  let buffer = ''
  const wake = () => waiters.forEach((w) => w())
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    const { blocks: complete, rest } = parseBlocks(buffer + chunk)
    buffer = rest
    for (const [header, lines] of complete) {
      if (header === 'ACK' || header === 'NAK') replies.push(header)
      // Updates resend only changed lines; keep adding them (later lines win when parsed).
      else blocks.set(header, [...(blocks.get(header) ?? []), ...lines])
    }
    wake()
  })
  socket.on('error', (error: NodeJS.ErrnoException) => {
    failure ??= DeviceError.fromSocket(error, 'Videohub', host)
    wake()
  })
  socket.on('close', () => {
    failure ??= new DeviceError('closed', `The Videohub at ${host} closed the connection.`)
    wake()
  })
  return {
    blocks,
    replies,
    until(ready, timeoutMs, timeoutMessage) {
      return new Promise((resolve, reject) => {
        const check = () => {
          try {
            const value = ready()
            if (value != null) return done(null, value)
          } catch (error) {
            return done(error as Error)
          }
          if (failure) done(failure)
        }
        const timer = setTimeout(() => done(new DeviceError('timeout', timeoutMessage)), timeoutMs)
        const done = (error: Error | null, value?: unknown) => {
          clearTimeout(timer)
          waiters.delete(check)
          if (error) reject(error)
          else resolve(value as never)
        }
        waiters.add(check)
        check()
      })
    },
    send: (text) => socket.write(text),
    close: () => socket.destroy(),
  }
}

/** Wait for the initial status dump and return the device reading from it. */
function initialReading(session: Session, host: string, timeoutMs: number): Promise<VideohubReading> {
  return session.until(
    () => {
      const reading = readingFromBlocks(session.blocks)
      if (!reading && session.blocks.has('END PRELUDE:')) {
        throw new DeviceError('incomplete', `The Videohub at ${host} finished its status without sending labels.`)
      }
      return reading
    },
    timeoutMs,
    `No answer from a Videohub at ${host} (timed out after ${timeoutMs / 1000}s).`,
  )
}

/** Connect, read the model and labels, disconnect. */
export async function readVideohub(host: string, { port = VIDEOHUB_PORT, timeoutMs = 5000 }: ReadOptions = {}): Promise<VideohubReading> {
  const session = connect(host, port)
  try {
    return await initialReading(session, host, timeoutMs)
  } finally {
    session.close()
  }
}


/** One protocol line per port: zero-based port, a space, the label (on a single line). */
const labelBlock = (header: string, ports: VideohubLabelWrite[]) =>
  `${header}\n${ports.map((p) => `${p.n - 1} ${p.label.replace(/[\r\n]+/g, ' ').trim()}`).join('\n')}\n\n`

/**
 * Connect, set the given labels, confirm, disconnect. Each label block must be acknowledged (ACK);
 * then we wait for the hub to report the new labels back, and return a fresh reading.
 */
export async function writeVideohub(
  host: string,
  ports: VideohubLabelWrite[],
  { port = VIDEOHUB_PORT, timeoutMs = 5000 }: ReadOptions = {},
): Promise<VideohubReading> {
  const session = connect(host, port)
  try {
    const before = await initialReading(session, host, timeoutMs)
    for (const p of ports) {
      const count = p.side === 'in' ? before.counts.inputs : before.counts.outputs
      if (p.n < 1 || p.n > count) throw new DeviceError('unknown-port', `Not sent: the Videohub has no ${p.side === 'in' ? 'input' : 'output'} ${p.n}.`)
    }
    for (const [side, header] of [['in', 'INPUT LABELS:'], ['out', 'OUTPUT LABELS:']] as const) {
      const group = ports.filter((p) => p.side === side)
      if (!group.length) continue
      const expected = session.replies.length + 1
      session.send(labelBlock(header, group))
      const reply = await session.until(() => session.replies[expected - 1], timeoutMs, `The Videohub at ${host} didn't acknowledge the new labels.`)
      if (reply === 'NAK') throw new DeviceError('rejected', `The Videohub at ${host} rejected the new ${side === 'in' ? 'input' : 'output'} labels.`)
    }
    // The hub echoes accepted changes as status updates; wait for them so the reading is current.
    const applied = () => {
      const reading = readingFromBlocks(session.blocks)
      const ok = reading && ports.every((p) => (p.side === 'in' ? reading.inputs : reading.outputs).find((x) => x.n === p.n)?.label === p.label.replace(/[\r\n]+/g, ' ').trim())
      return ok ? reading : null
    }
    return await session.until(applied, timeoutMs, `The Videohub at ${host} accepted the labels but didn't report them back.`)
  } finally {
    session.close()
  }
}
