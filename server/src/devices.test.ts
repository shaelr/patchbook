import assert from 'node:assert/strict'
import net from 'node:net'
import { after, describe, test } from 'node:test'
import { Enums } from 'atem-connection'
import type { VideohubReading } from '@patchbook/shared'
import { buildApp } from './app.ts'
import { atemTimeoutMessage, atemWriteProblems, readingFromState, sendAtemNames } from './devices/atem.ts'
import { DeviceError } from './devices/errors.ts'
import { parseBlocks, readVideohub, writeVideohub } from './devices/videohub.ts'
import { ProjectStore } from './store.ts'

// A stand-in Videohub for tests only: it sends the initial status dump from the protocol document.
function fakeVideohub(dump: string, { chunkSize = 0 } = {}): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      // Patchbook hangs up as soon as it has the labels; ignore writes after that.
      socket.on('error', () => {})
      if (!chunkSize) return void socket.write(dump)
      // Send in small pieces, as TCP may deliver it, to check blocks are reassembled.
      for (let i = 0; i < dump.length; i += chunkSize) {
        setTimeout(() => !socket.destroyed && socket.writable && socket.write(dump.slice(i, i + chunkSize)), i / chunkSize)
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }))
  })
}

const DUMP = [
  'PROTOCOL PREAMBLE:\nVersion: 2.3\n\n',
  'VIDEOHUB DEVICE:\nDevice present: true\nModel name: Blackmagic Videohub 10x10 12G\nVideo inputs: 10\nVideo processing units: 0\nVideo outputs: 10\nVideo monitoring outputs: 0\nSerial ports: 0\n\n',
  'INPUT LABELS:\n' + Array.from({ length: 10 }, (_, i) => `${i} ${i === 0 ? 'Cam 1 ISO' : `Input ${i + 1}`}\n`).join('') + '\n',
  'OUTPUT LABELS:\n' + Array.from({ length: 10 }, (_, i) => `${i} ${i === 9 ? 'To ATEM 20' : `Output ${i + 1}`}\n`).join('') + '\n',
  'VIDEO OUTPUT ROUTING:\n0 0\n1 1\n\n',
].join('')

describe('Videohub protocol', () => {
  const servers: Array<() => void> = []
  after(() => servers.forEach((close) => close()))

  test('parses blocks and keeps an unfinished remainder', () => {
    const { blocks, rest } = parseBlocks('PROTOCOL PREAMBLE:\r\nVersion: 2.3\r\n\r\nINPUT LABELS:\n0 A\n')
    assert.deepEqual(blocks, [['PROTOCOL PREAMBLE:', ['Version: 2.3']]])
    assert.equal(rest, 'INPUT LABELS:\n0 A\n')
  })

  test('reads model and labels from the initial dump', async () => {
    const hub = await fakeVideohub(DUMP)
    servers.push(hub.close)
    const reading = await readVideohub('127.0.0.1', { port: hub.port })
    assert.equal(reading.modelName, 'Blackmagic Videohub 10x10 12G')
    assert.equal(reading.model, 'vh-10x10-12g')
    assert.deepEqual(reading.counts, { inputs: 10, outputs: 10 })
    assert.deepEqual(reading.inputs[0], { n: 1, label: 'Cam 1 ISO' }, 'protocol port 0 is port 1')
    assert.deepEqual(reading.outputs[9], { n: 10, label: 'To ATEM 20' })
  })

  test('reassembles blocks split across packets', async () => {
    const hub = await fakeVideohub(DUMP, { chunkSize: 7 })
    servers.push(hub.close)
    const reading = await readVideohub('127.0.0.1', { port: hub.port })
    assert.equal(reading.inputs.length, 10)
  })

  test('reports a hub with no router attached', async () => {
    const hub = await fakeVideohub('PROTOCOL PREAMBLE:\nVersion: 2.3\n\nVIDEOHUB DEVICE:\nDevice present: false\n\n')
    servers.push(hub.close)
    await assert.rejects(readVideohub('127.0.0.1', { port: hub.port }), (e: DeviceError) => e.code === 'no-device')
  })

  test('reads a v2.8 server that ends its dump with END PRELUDE', async () => {
    const hub = await fakeVideohub(DUMP.replace('Version: 2.3', 'Version: 2.8') + 'END PRELUDE:\n\n')
    servers.push(hub.close)
    assert.equal((await readVideohub('127.0.0.1', { port: hub.port })).inputs.length, 10)
  })

  test('says so when the dump ends without labels', async () => {
    const hub = await fakeVideohub(
      'PROTOCOL PREAMBLE:\nVersion: 2.8\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: Blackmagic Smart Videohub\n\nEND PRELUDE:\n\n',
    )
    servers.push(hub.close)
    await assert.rejects(readVideohub('127.0.0.1', { port: hub.port }), (e: DeviceError) => e.code === 'incomplete')
  })

  test('times out when nothing answers', async () => {
    const silent = await new Promise<{ port: number; close: () => void }>((resolve) => {
      const server = net.createServer(() => {})
      server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }))
    })
    servers.push(silent.close)
    await assert.rejects(readVideohub('127.0.0.1', { port: silent.port, timeoutMs: 200 }), (e: DeviceError) => e.code === 'timeout')
  })

  test('reports a refused connection', async () => {
    const closed = await fakeVideohub('')
    closed.close()
    await assert.rejects(readVideohub('127.0.0.1', { port: closed.port, timeoutMs: 1000 }), (e: DeviceError) => e.code === 'refused')
  })
})

describe('ATEM state mapping', () => {
  const channel = (inputId: number, type: Enums.InternalPortType, longName: string, shortName: string, areNamesDefault = false) => ({
    inputId,
    longName,
    shortName,
    areNamesDefault,
    internalPortType: type,
    externalPorts: null,
    externalPortType: Enums.ExternalPortType.SDI,
    sourceAvailability: Enums.SourceAvailability.None,
    meAvailability: Enums.MeAvailability.None,
  })
  const state = (productIdentifier: string | undefined, model: Enums.Model) =>
    ({
      info: { productIdentifier, model, multiviewer: { count: 2, windowCount: 10 } },
      inputs: {
        0: channel(0, Enums.InternalPortType.Black, 'Black', 'BLK'),
        2: channel(2, Enums.InternalPortType.External, 'Lectern', 'LECT'),
        1: channel(1, Enums.InternalPortType.External, 'Camera 1', 'CAM1', true),
        1000: channel(1000, Enums.InternalPortType.ColorBars, 'Color Bars', 'BARS'),
        8001: channel(8001, Enums.InternalPortType.Auxiliary, 'Program', 'PGM'),
        8002: channel(8002, Enums.InternalPortType.Auxiliary, 'Output 2', 'OUT2', true),
        9001: channel(9001, Enums.InternalPortType.MultiViewer, 'MV 1', 'MV1', true),
        10010: channel(10010, Enums.InternalPortType.MEOutput, 'Program', 'PGM'),
      },
    }) as unknown as Parameters<typeof readingFromState>[0]

  test('keeps physical inputs and aux outputs (not multiviews or internal sources); numbers them by port', () => {
    const reading = readingFromState(state('ATEM 2 M/E Constellation 4K', Enums.Model.Constellation4K2ME))
    assert.equal(reading.model, 'constellation-4k-2me')
    assert.deepEqual(reading.inputs, [
      { n: 1, long: 'Camera 1', short: 'CAM1' },
      { n: 2, long: 'Lectern', short: 'LECT' },
    ])
    assert.deepEqual(reading.outputs, [
      { kind: 'aux', n: 1, long: 'Program', short: 'PGM' },
      { kind: 'aux', n: 2, long: 'Output 2', short: 'OUT2' },
    ])
    assert.deepEqual(reading.counts, { inputs: 2, aux: 2, mvs: 2 })
    assert.deepEqual(reading.factoryDefaults, ['in:1', 'aux:2'])
  })

  test('product name decides between models that share an id; id is the fallback', () => {
    assert.equal(readingFromState(state('ATEM 4 M/E Broadcast Studio 4K', Enums.Model.TwoMEBS4K)).model, '4me-bs-4k')
    assert.equal(readingFromState(state(undefined, Enums.Model.TwoMEBS4K)).model, '2me-bs-4k')
    assert.equal(readingFromState(state('Some Future ATEM', Enums.Model.Unknown)).model, 'custom')
  })

  test('a timeout names the IP and says the switcher may be out of connection slots', () => {
    const message = atemTimeoutMessage('192.168.10.10', 8000)
    assert.match(message, /^No answer from an ATEM at 192\.168\.10\.10 \(timed out after 8s\)/)
    assert.match(message, /out of connection slots/)
    assert.match(message, /Companion holds one/)
  })
})

describe('device API', () => {
  const reading: VideohubReading = { modelName: 'X', model: 'vh-10x10-12g', counts: { inputs: 1, outputs: 1 }, inputs: [], outputs: [] }

  test('validates the IP, maps device errors, and shares concurrent reads', async () => {
    let calls = 0
    const app = buildApp({
      store: new ProjectStore(':memory:'),
      devices: {
        readAtem: async (ip) => {
          throw new DeviceError('timeout', `No answer from an ATEM at ${ip}`)
        },
        readVideohub: async () => {
          calls++
          await new Promise((r) => setTimeout(r, 50))
          return reading
        },
      },
    })
    assert.equal((await app.inject({ method: 'POST', url: '/api/devices/atem/read', payload: { ip: 'nope' } })).statusCode, 400)
    const failed = await app.inject({ method: 'POST', url: '/api/devices/atem/read', payload: { ip: '192.168.10.012' } })
    assert.equal(failed.statusCode, 502)
    assert.equal(failed.json<{ error: string }>().error, 'No answer from an ATEM at 192.168.10.12', 'IP normalized before use')
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/devices/videohub/read', payload: { ip: '192.168.10.13' } }),
      app.inject({ method: 'POST', url: '/api/devices/videohub/read', payload: { ip: '192.168.10.13' } }),
    ])
    assert.equal(a.statusCode, 200)
    assert.deepEqual(b.json(), reading)
    assert.equal(calls, 1, 'one connection for two simultaneous requests')
    assert.equal((await app.inject({ method: 'POST', url: '/api/devices/router/read', payload: { ip: '1.2.3.4' } })).statusCode, 404)
  })
})

// A stand-in hub that accepts label blocks: ACKs (or NAKs) them and echoes the change, as a real hub does.
function writableVideohub({ nak = false } = {}): Promise<{ port: number; received: string[]; close: () => void }> {
  return new Promise((resolve) => {
    const received: string[] = []
    const server = net.createServer((socket) => {
      socket.on('error', () => {})
      socket.write(DUMP)
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        const { blocks, rest } = parseBlocks(buffer + chunk)
        buffer = rest
        for (const [header, lines] of blocks) {
          received.push(`${header}\n${lines.join('\n')}`)
          socket.write(nak ? 'NAK\n\n' : 'ACK\n\n')
          if (!nak) socket.write(`${header}\n${lines.join('\n')}\n\n`)
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() }))
  })
}

describe('Videohub writing', () => {
  const servers: Array<() => void> = []
  after(() => servers.forEach((close) => close()))

  test('sends one block per side with zero-based ports, and returns the updated labels', async () => {
    const hub = await writableVideohub()
    servers.push(hub.close)
    const reading = await writeVideohub(
      '127.0.0.1',
      [
        { side: 'in', n: 2, label: 'Lectern' },
        { side: 'in', n: 3, label: 'Wide\nshot' },
        { side: 'out', n: 1, label: 'To ATEM 1' },
      ],
      { port: hub.port },
    )
    assert.deepEqual(hub.received, ['INPUT LABELS:\n1 Lectern\n2 Wide shot', 'OUTPUT LABELS:\n0 To ATEM 1'])
    assert.equal(reading.inputs[1]!.label, 'Lectern')
    assert.equal(reading.inputs[2]!.label, 'Wide shot', 'labels are kept on one line')
    assert.equal(reading.outputs[0]!.label, 'To ATEM 1')
    assert.equal(reading.inputs[0]!.label, 'Cam 1 ISO', 'other labels unchanged')
  })

  test('reports a rejected change', async () => {
    const hub = await writableVideohub({ nak: true })
    servers.push(hub.close)
    await assert.rejects(writeVideohub('127.0.0.1', [{ side: 'in', n: 1, label: 'X' }], { port: hub.port }), (e: DeviceError) => e.code === 'rejected')
  })

  test('refuses ports the hub does not have, before sending anything', async () => {
    const hub = await writableVideohub()
    servers.push(hub.close)
    await assert.rejects(writeVideohub('127.0.0.1', [{ side: 'out', n: 11, label: 'X' }], { port: hub.port }), (e: DeviceError) => e.code === 'unknown-port')
    assert.deepEqual(hub.received, [])
  })
})

describe('ATEM writing', () => {
  const state = {
    inputs: {
      1: { inputId: 1, internalPortType: Enums.InternalPortType.External },
      2: { inputId: 2, internalPortType: Enums.InternalPortType.External },
      8001: { inputId: 8001, internalPortType: Enums.InternalPortType.Auxiliary },
    },
  } as never
  const mockAtem = () => {
    const sent: Array<[object, number]> = []
    return { sent, atem: { state, setInputSettings: async (props: object, id?: number) => void sent.push([props, id ?? 0]) } }
  }

  test('sends Name and Label to the right sources (aux outputs are 8000 + n)', async () => {
    const { atem, sent } = mockAtem()
    await sendAtemNames(atem as never, [
      { kind: 'in', n: 2, long: 'Lectern', short: 'LECT' },
      { kind: 'aux', n: 1, long: 'Program', short: 'PGM1' },
    ])
    assert.deepEqual(sent, [
      [{ longName: 'Lectern', shortName: 'LECT' }, 2],
      [{ longName: 'Program', shortName: 'PGM1' }, 8001],
    ])
  })

  test('refuses names that would not fit, and unknown ports, before sending anything', async () => {
    assert.deepEqual(atemWriteProblems([{ kind: 'in', n: 1, long: 'Éééééééééé1', short: 'E1' }]), ['input 1: "Éééééééééé1" is longer than 20 bytes'])
    assert.equal(atemWriteProblems([{ kind: 'in', n: 1, long: 'Café', short: 'CAFÉ' }]).length, 1, 'label must be ASCII')
    assert.equal(atemWriteProblems([{ kind: 'in', n: 1, long: '  ', short: 'X' }]).length, 1, 'name required')
    const { atem, sent } = mockAtem()
    await assert.rejects(sendAtemNames(atem as never, [{ kind: 'in', n: 1, long: 'A'.repeat(21), short: 'A' }]), (e: DeviceError) => e.code === 'invalid')
    await assert.rejects(
      sendAtemNames(atem as never, [
        { kind: 'in', n: 1, long: 'OK', short: 'OK' },
        { kind: 'aux', n: 7, long: 'Nope', short: 'NOPE' },
      ]),
      (e: DeviceError) => e.code === 'unknown-port',
    )
    assert.deepEqual(sent, [], 'nothing sent when any port is bad')
  })
})

describe('device write API', () => {
  test('validates input and queues access per device', async () => {
    const order: string[] = []
    const app = buildApp({
      store: new ProjectStore(':memory:'),
      devices: {
        readAtem: async () => {
          order.push('read start')
          await new Promise((r) => setTimeout(r, 40))
          order.push('read end')
          return {} as never
        },
        writeAtem: async (_ip, ports) => {
          order.push(`write ${ports.length}`)
          return {} as never
        },
      },
    })
    const bad = await app.inject({ method: 'POST', url: '/api/devices/atem/write', payload: { ip: '192.168.10.12', ports: [] } })
    assert.equal(bad.statusCode, 400, 'at least one port')
    const [read, write] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/devices/atem/read', payload: { ip: '192.168.10.12' } }),
      app.inject({ method: 'POST', url: '/api/devices/atem/write', payload: { ip: '192.168.10.12', ports: [{ kind: 'in', n: 1, long: 'Wide', short: 'WIDE' }] } }),
    ])
    assert.equal(read.statusCode, 200)
    assert.equal(write.statusCode, 200)
    assert.deepEqual(order, ['read start', 'read end', 'write 1'], 'the write waits for the read on the same ATEM')
  })
})
