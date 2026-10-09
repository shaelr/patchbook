import { Atem, Enums, type AtemState } from 'atem-connection'
import { ATEM_LONG_MAX, ATEM_MODELS, ATEM_SHORT_MAX, CUSTOM_MODEL, utf8Length, type AtemNameWrite, type AtemReading } from '@patchbook/shared'
import { DeviceError } from './errors.ts'

// ATEM switchers over the network via atem-connection (UDP 9910). In the ATEM's model (see the
// ATEM Switchers SDK, IBMDSwitcherInput), physical inputs and aux outputs are both "inputs" with a
// long name (Name) and short name (Label), told apart by their port type. Multiview outputs are
// fixed and aren't read (on a Constellation 4K they aren't named sources at all); only their
// count is, so a project can hold a note per multiview.
// We connect only long enough to read (or write) and then disconnect: ATEMs allow few connections.

/** atem-connection model ids → catalog ids, for when the product name isn't in the catalog. */
const MODEL_BY_ID: Partial<Record<Enums.Model, string>> = {
  [Enums.Model.TVS]: 'tvs',
  [Enums.Model.OneME]: '1me',
  [Enums.Model.TwoME]: '2me',
  [Enums.Model.PS4K]: 'ps-4k',
  [Enums.Model.OneME4K]: '1me-4k',
  [Enums.Model.TwoME4K]: '2me-4k',
  [Enums.Model.TwoMEBS4K]: '2me-bs-4k', // shared by the 2 M/E and 4 M/E Broadcast Studio 4K
  [Enums.Model.TVSHD]: 'tvs-hd',
  [Enums.Model.TVSProHD]: 'tvs-pro-hd',
  [Enums.Model.TVSPro4K]: 'tvs-pro-4k',
  [Enums.Model.Constellation]: 'constellation-8k-hd',
  [Enums.Model.Constellation8K]: 'constellation-8k-8k',
  [Enums.Model.Mini]: 'mini',
  [Enums.Model.MiniPro]: 'mini-pro',
  [Enums.Model.MiniProISO]: 'mini-pro-iso',
  [Enums.Model.MiniExtreme]: 'mini-extreme',
  [Enums.Model.MiniExtremeISO]: 'mini-extreme-iso',
  [Enums.Model.MiniExtremeISOG2]: 'mini-extreme-iso-g2',
  [Enums.Model.ConstellationHD1ME]: 'constellation-hd-1me',
  [Enums.Model.ConstellationHD2ME]: 'constellation-hd-2me',
  [Enums.Model.ConstellationHD4ME]: 'constellation-hd-4me',
  [Enums.Model.Constellation4K1ME]: 'constellation-4k-1me',
  [Enums.Model.Constellation4K2ME]: 'constellation-4k-2me',
  [Enums.Model.Constellation4K4ME]: 'constellation-4k-4me',
  [Enums.Model.Constellation4K4MEPlus]: 'constellation-4k-4me-plus',
  [Enums.Model.SDI]: 'sdi',
  [Enums.Model.SDIProISO]: 'sdi-pro-iso',
  [Enums.Model.SDIExtremeISO]: 'sdi-extreme-iso',
  [Enums.Model.TelevisionStudioHD8]: 'tvs-hd8',
  [Enums.Model.TelevisionStudioHD8ISO]: 'tvs-hd8-iso',
  [Enums.Model.TelevisionStudio4K8]: 'tvs-4k8',
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Catalog model: exact product name first (it separates models that share an id), then the id. */
export function matchAtemModel(productName: string | undefined, modelId: Enums.Model): string {
  const byName = productName ? ATEM_MODELS.find((m) => norm(m.label) === norm(productName)) : undefined
  return byName?.id ?? MODEL_BY_ID[modelId] ?? CUSTOM_MODEL
}

/** Source ids by port: inputs from 1, aux outputs from 8001. */
const AUX_BASE = 8000

/** Turn an ATEM state into a reading. Pure, so it can be tested without a switcher. */
export function readingFromState(state: Pick<AtemState, 'info' | 'inputs'>): AtemReading {
  const channels = Object.values(state.inputs).filter((c): c is NonNullable<typeof c> => !!c)
  const pick = (type: Enums.InternalPortType, base: number) =>
    channels
      .filter((c) => c.internalPortType === type)
      .map((c) => ({ n: c.inputId - base, long: c.longName, short: c.shortName, isDefault: c.areNamesDefault }))
      .filter((p) => p.n > 0)
      .sort((a, b) => a.n - b.n)
  const inputs = pick(Enums.InternalPortType.External, 0)
  const aux = pick(Enums.InternalPortType.Auxiliary, AUX_BASE)
  const productName = state.info.productIdentifier ?? Enums.Model[state.info.model] ?? 'ATEM'
  return {
    productName,
    model: matchAtemModel(state.info.productIdentifier, state.info.model),
    counts: { inputs: inputs.length, aux: aux.length, mvs: state.info.multiviewer?.count ?? 0 },
    inputs: inputs.map(({ n, long, short }) => ({ n, long, short })),
    outputs: [
      ...aux.map(({ n, long, short }) => ({ kind: 'aux' as const, n, long, short })),
    ],
    factoryDefaults: [
      ...inputs.filter((p) => p.isDefault).map((p) => `in:${p.n}`),
      ...aux.filter((p) => p.isDefault).map((p) => `aux:${p.n}`),
    ],
  }
}

export interface ReadOptions {
  timeoutMs?: number
}

/**
 * Why a connection can time out. A switcher whose connection slots are all taken (panels, ATEM
 * Software Control, Companion…) doesn't refuse us in a way atem-connection reports: it just never
 * sends its state, which looks the same as no ATEM at that IP. So the message names both.
 */
export function atemTimeoutMessage(host: string, timeoutMs: number): string {
  return (
    `No answer from an ATEM at ${host} (timed out after ${timeoutMs / 1000}s). Check the IP and that it's on this network. ` +
    'If it is, the switcher may be out of connection slots: close ATEM Software Control, panels or other apps connected to it ' +
    '(Companion holds one) and try again.'
  )
}

/** Connect, wait for the ATEM's full state, run `use`, then always disconnect. */
async function withAtem<T>(host: string, timeoutMs: number, use: (atem: Atem) => Promise<T>): Promise<T> {
  const atem = new Atem({ disableMultithreaded: true })
  try {
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DeviceError('timeout', atemTimeoutMessage(host, timeoutMs))), timeoutMs)
      atem.once('connected', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await atem.connect(host)
    await connected
    if (!atem.state) throw new DeviceError('no-state', `Connected to ${host}, but the ATEM sent no state.`)
    return await use(atem)
  } finally {
    await atem.destroy().catch(() => {})
  }
}

/** Connect, wait for the ATEM's full state, read it, disconnect. */
export function readAtem(host: string, { timeoutMs = 8000 }: ReadOptions = {}): Promise<AtemReading> {
  return withAtem(host, timeoutMs, async (atem) => readingFromState(atem.state!))
}


const inputIdOf = (p: Pick<AtemNameWrite, 'kind' | 'n'>) => (p.kind === 'in' ? p.n : AUX_BASE + p.n)
const portName = (p: Pick<AtemNameWrite, 'kind' | 'n'>) => (p.kind === 'in' ? `input ${p.n}` : `output ${p.n}`)

/**
 * Reasons these names can't be sent. The ATEM stores a Name in a fixed 20-byte field and
 * atem-connection doesn't check the length (a longer Name would spill into the Label), so
 * this check must pass before anything is sent.
 */
export function atemWriteProblems(ports: AtemNameWrite[]): string[] {
  const problems: string[] = []
  for (const p of ports) {
    if (!p.long.trim()) problems.push(`${portName(p)} has no name`)
    else if (utf8Length(p.long) > ATEM_LONG_MAX) problems.push(`${portName(p)}: "${p.long}" is longer than ${ATEM_LONG_MAX} bytes`)
    if (!/^[\x20-\x7e]{1,4}$/.test(p.short)) problems.push(`${portName(p)}: label "${p.short}" must be 1–${ATEM_SHORT_MAX} plain characters`)
  }
  return problems
}

type AtemLike = Pick<Atem, 'setInputSettings'> & { readonly state: Readonly<AtemState> | undefined }

/** Send names to an already connected ATEM. Checks every port exists before changing any. */
export async function sendAtemNames(atem: AtemLike, ports: AtemNameWrite[]): Promise<void> {
  const problems = atemWriteProblems(ports)
  if (problems.length) throw new DeviceError('invalid', `Not sent: ${problems.join('; ')}.`)
  for (const p of ports) {
    const channel = atem.state?.inputs[inputIdOf(p)]
    const type = p.kind === 'in' ? Enums.InternalPortType.External : Enums.InternalPortType.Auxiliary
    if (!channel || channel.internalPortType !== type) throw new DeviceError('unknown-port', `Not sent: the ATEM has no ${portName(p)}.`)
  }
  for (const p of ports) await atem.setInputSettings({ longName: p.long, shortName: p.short }, inputIdOf(p))
}

/** Wait until the ATEM's state shows the names we sent (it reports changes back), or give up. */
async function waitForNames(atem: AtemLike, ports: AtemNameWrite[], timeoutMs = 3000): Promise<void> {
  const applied = () =>
    ports.every((p) => {
      const c = atem.state?.inputs[inputIdOf(p)]
      return c?.longName === p.long && c?.shortName === p.short
    })
  for (let waited = 0; !applied() && waited < timeoutMs; waited += 100) await new Promise((r) => setTimeout(r, 100))
}

/** Connect, set the given names, confirm, disconnect. Returns a fresh reading of the ATEM. */
export function writeAtem(host: string, ports: AtemNameWrite[], { timeoutMs = 8000 }: ReadOptions = {}): Promise<AtemReading> {
  return withAtem(host, timeoutMs, async (atem) => {
    await sendAtemNames(atem, ports)
    await waitForNames(atem, ports)
    return readingFromState(atem.state!)
  })
}
