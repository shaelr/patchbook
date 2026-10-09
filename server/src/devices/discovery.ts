import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { compareIps, parseIp, type FoundDevice } from '@patchbook/shared'

// Blackmagic devices announce themselves over Bonjour as `_blackmagic._tcp`, with TXT records
// `class` (AtemSwitcher, Videohub, HyperDeck…) and `device name`. Patchbook listens from the first
// time the app asks and keeps the list current while the server runs, so the app can offer devices
// instead of making you type IPs. The ATEM's records were checked against Blackmagic's ATEM
// emulator; Videohubs use class "Videohub" (not yet seen on hardware). A device registered only on
// this computer (like that emulator) isn't announced on the network, so it doesn't show up here.

const KIND_BY_CLASS: Record<string, FoundDevice['kind']> = { atemswitcher: 'atem', videohub: 'videohub' }

/** The usable IPv4 address of an announced service: not link-local when there's a choice. */
function ipv4Of(service: Pick<Service, 'addresses'>): string | null {
  const v4 = (service.addresses ?? []).filter((a) => parseIp(a))
  return v4.find((a) => !a.startsWith('169.254.')) ?? v4[0] ?? null
}

/** A found device from a Bonjour service, or null if it has no IPv4 address. Pure, for tests. */
export function foundDeviceFrom(service: Pick<Service, 'name' | 'addresses' | 'txt'>): FoundDevice | null {
  const ip = ipv4Of(service)
  if (!ip) return null
  const txt = (service.txt ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof txt[key] === 'string' ? (txt[key] as string).trim() : '')
  const deviceClass = text('class')
  const name = text('device name') || service.name
  return {
    id: text('unique id') || `${name}@${ip}`,
    name,
    deviceClass,
    kind: KIND_BY_CLASS[deviceClass.toLowerCase()] ?? 'other',
    ip,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class Discovery {
  private bonjour: Bonjour | null = null
  private browser: Browser | null = null
  private found = new Map<string, FoundDevice>()
  private startedAt = 0
  private queriedAt = 0

  /** Devices seen so far. The first call starts listening and waits briefly for answers. */
  async list(): Promise<FoundDevice[]> {
    if (!this.browser) this.start()
    const age = Date.now() - this.startedAt
    if (age < 1500) await sleep(1500 - age)
    else if (Date.now() - this.queriedAt > 10_000) {
      // Ask again now and then, so devices that missed the first query still turn up.
      this.queriedAt = Date.now()
      this.browser?.update()
    }
    return [...this.found.values()].sort((a, b) => compareIps(a.ip, b.ip))
  }

  private start(): void {
    this.bonjour = new Bonjour()
    this.startedAt = this.queriedAt = Date.now()
    this.browser = this.bonjour.find({ type: 'blackmagic', protocol: 'tcp' })
    this.browser.on('up', (service: Service) => {
      const device = foundDeviceFrom(service)
      if (device) this.found.set(device.id, device)
    })
    this.browser.on('down', (service: Service) => {
      const device = foundDeviceFrom(service)
      if (device) this.found.delete(device.id)
    })
  }

  stop(): void {
    this.browser?.stop()
    this.bonjour?.destroy()
    this.browser = this.bonjour = null
    this.found.clear()
  }
}
