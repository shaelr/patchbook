import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import ExcelJS from 'exceljs'
import { newProjectData, type Project } from '@patchbook/shared'
import { buildApp } from './app.ts'
import { ProjectStore } from './store.ts'
import { exportXlsx, importXlsx } from './xlsx.ts'

/** A sheet in the user's template layout, with made-up show data. */
async function templateFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.mergeCells('A1:B1')
  ws.getCell('A1').value = 'ATEM'
  ws.mergeCells('J1:K1')
  ws.getCell('J1').value = 'IP'
  ;[['A2', 'In'], ['B2', 'Label'], ['D2', 'Out'], ['E2', 'Label'], ['J2', 'Equipment'], ['K2', 'Location'], ['L2', 'IP']].forEach(
    ([ref, v]) => (ws.getCell(ref!).value = v!),
  )
  const inputs = ['Camera 1', 'Camera 2', '', '', '', '', 'GFX 1', 'GFX 2', 'Laptop A', 'Laptop B']
  for (let i = 1; i <= 20; i++) {
    ws.getCell(`A${i + 2}`).value = i
    ws.getCell(`B${i + 2}`).value = inputs[i - 1] ?? ''
  }
  for (let i = 1; i <= 12; i++) ws.getCell(`D${i + 2}`).value = i
  ws.getCell('E3').value = 'Program'
  ws.getCell('D15').value = 'MV 1'
  ws.getCell('D16').value = 'MV 2'
  const ips: Array<[string, string]> = [
    ['Atem', '10.20.30.10'],
    ['Switcher Panel', '10.20.30.11'],
    ['Camera Control', '10.20.30.09'],
    ['Spare Camera', ''],
    ['Record 1', '10.20.30.30'],
  ]
  ips.forEach(([name, ip], i) => {
    ws.getCell(`J${i + 3}`).value = name
    if (ip) ws.getCell(`L${i + 3}`).value = ip
  })
  ws.getCell('M7').value = '`' // stray character outside the table, as in real sheets
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('xlsx import', () => {
  test('reads the template layout', async () => {
    const { data, warnings } = await importXlsx(await templateFixture(), 'Show')
    const atem = data.atem!
    // 20 in / 12 aux matches both 2 M/E Constellation HD and 4K, so it stays custom.
    // The template's "MV 1" / "MV 2" rows (fixed multiview outputs) are skipped.
    assert.equal(atem.model, 'custom')
    assert.equal(atem.inputs.length, 20)
    assert.equal(atem.inputs[0]!.long, 'Camera 1')
    assert.equal(atem.inputs[8]!.long, 'Laptop A')
    assert.equal(atem.outputs.length, 12, 'MV rows skipped')
    assert.equal(atem.outputs[0]!.long, 'Program')
    assert.equal(data.videohub, null)

    assert.equal(atem.ip, '10.20.30.10', 'the "Atem" row becomes the ATEM IP')
    assert.deepEqual(
      data.network.map((e) => [e.name, e.ip]),
      [
        ['Switcher Panel', '10.20.30.11'],
        ['Camera Control', '10.20.30.9'],
        ['Spare Camera', ''],
        ['Record 1', '10.20.30.30'],
      ],
    )
    assert.equal(data.subnet, '10.20.30.0/24')
    assert.ok(warnings.some((w) => w.includes('10.20.30.09')))
    assert.ok(warnings.some((w) => w.includes('ATEM model not identified')))
  })

  test('export → import keeps model, labels, short overrides and IPs', async () => {
    const { data } = await importXlsx(await templateFixture(), 'Show')
    data.atem = { ...data.atem!, model: 'constellation-4k-2me' }
    data.atem.inputs[0]!.short = 'C1'
    data.videohub = {
      model: 'vh-10x10-12g',
      name: 'Videohub',
      ip: '10.20.30.12',
      inputs: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, label: i === 0 ? 'Cam 1 ISO' : '' })),
      outputs: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, label: i === 9 ? 'To ATEM 20' : '' })),
    }
    data.atem.name = 'Main Switcher' // not "ATEM", so the device row is matched by the IP in the title
    data.notes = 'Hall B\nLoad-in 7am'
    const back = (await importXlsx(await exportXlsx(data), 'Show')).data
    assert.equal(back.atem!.name, 'Main Switcher')
    assert.ok(!back.network.some((e) => e.name === 'Main Switcher'), 'device row is not duplicated into the network list')
    assert.equal(back.atem!.model, 'constellation-4k-2me')
    assert.equal(back.atem!.inputs[0]!.short, 'C1')
    assert.equal(back.atem!.inputs[1]!.short, null, 'auto short names stay auto')
    assert.equal(back.videohub!.model, 'vh-10x10-12g')
    assert.equal(back.videohub!.inputs[0]!.label, 'Cam 1 ISO')
    assert.equal(back.videohub!.outputs[9]!.label, 'To ATEM 20')
    assert.equal(back.atem!.ip, data.atem.ip)
    assert.equal(back.videohub!.ip, '10.20.30.12')
    // The export lists the network sorted by IP, so compare contents rather than order.
    const entries = (list: typeof data.network) => list.map((e) => `${e.name}=${e.ip}`).sort()
    assert.deepEqual(entries(back.network), entries(data.network))
  })
})

describe('ATEM column headers', () => {
  // Blackmagic's terms: Name = 20-char long name, Label = 4-char short name.
  const sheetWith = async (headers: string[], row: string[]) => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.getCell('A1').value = 'ATEM'
    headers.forEach((h, i) => (ws.getRow(2).getCell(i + 1).value = h))
    row.forEach((v, i) => (ws.getRow(3).getCell(i + 1).value = i === 0 ? Number(v) : v))
    return Buffer.from(await wb.xlsx.writeBuffer())
  }
  const first = async (headers: string[], row: string[]) => (await importXlsx(await sheetWith(headers, row), 'X')).data.atem!.inputs[0]!

  test('In | Name | Label: Label is the 4-character label', async () => {
    assert.deepEqual(await first(['In', 'Name', 'Label'], ['1', 'Camera 1', 'C1']), { n: 1, long: 'Camera 1', short: 'C1' })
  })
  test('In | Label (template): Label is the name', async () => {
    assert.deepEqual(await first(['In', 'Label'], ['1', 'Camera 1']), { n: 1, long: 'Camera 1', short: null })
  })
  test('In | Label | Short (earlier exports) still reads', async () => {
    assert.deepEqual(await first(['In', 'Label', 'Short'], ['1', 'Camera 1', 'C1']), { n: 1, long: 'Camera 1', short: 'C1' })
  })
})

describe('API', () => {
  const setup = () => {
    const store = new ProjectStore(':memory:')
    return { app: buildApp({ store }), store }
  }

  test('create, update with versions, conflict, duplicate, delete', async () => {
    const { app } = setup()
    const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Sample Show' } })).json<Project>()
    assert.equal(created.version, 1)

    const data = { ...created.data, notes: 'Hall B' }
    const updated = await app.inject({ method: 'PUT', url: `/api/projects/${created.id}`, payload: { version: 1, data } })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json<Project>().version, 2)

    const stale = await app.inject({ method: 'PUT', url: `/api/projects/${created.id}`, payload: { version: 1, data } })
    assert.equal(stale.statusCode, 409)
    assert.equal(stale.json<{ current: Project }>().current.version, 2)

    const dup = (await app.inject({ method: 'POST', url: `/api/projects/${created.id}/duplicate`, payload: {} })).json<Project>()
    assert.equal(dup.data.name, 'Sample Show copy')
    assert.equal(dup.data.notes, 'Hall B')

    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json<unknown[]>()
    assert.equal(list.length, 2)

    assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${dup.id}` })).statusCode, 204)
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${dup.id}` })).statusCode, 404)
  })

  test('rejects invalid project data', async () => {
    const { app } = setup()
    const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X' } })).json<Project>()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${created.id}`,
      payload: { version: 1, data: { ...created.data, name: '' } },
    })
    assert.equal(res.statusCode, 400)
  })

  test('imports xlsx and restores JSON backups', async () => {
    const { app } = setup()
    const imported = await app.inject({
      method: 'POST',
      url: '/api/import/xlsx?name=Sample%20Show%202026.xlsx',
      headers: { 'content-type': 'application/octet-stream' },
      payload: await templateFixture(),
    })
    assert.equal(imported.statusCode, 201)
    const { project } = imported.json<{ project: Project }>()
    assert.equal(project.data.name, 'Sample Show 2026')

    const backup = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export.json` })).json()
    const restored = await app.inject({ method: 'POST', url: '/api/import/json', payload: backup })
    assert.equal(restored.statusCode, 201)
    assert.deepEqual(restored.json<{ project: Project }>().project.data, project.data)

    const xlsx = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/export.xlsx` })
    assert.equal(xlsx.statusCode, 200)
    assert.match(xlsx.headers['content-disposition'] as string, /Sample Show 2026\.xlsx/)
  })

  test('projects saved with fields from older versions still load', () => {
    const store = new ProjectStore(':memory:')
    const project = store.create(newProjectData('Old'))
    store.update(project.id, { ...project.data, networkOrder: ['atem'] } as typeof project.data, 1)
    assert.equal(store.get(project.id)!.data.name, 'Old')
    assert.ok(!('networkOrder' in store.get(project.id)!.data))
  })

  test('old default role labels are updated on load, custom labels kept', () => {
    const store = new ProjectStore(':memory:')
    const project = store.create(newProjectData('Old'))
    const data = structuredClone(project.data)
    data.ipRanges.find((r) => r.id === 'recording')!.label = 'Record / playback'
    data.ipRanges.find((r) => r.id === 'spare-a')!.label = 'Overflow'
    store.update(project.id, data, 1)
    const labels = store.get(project.id)!.data.ipRanges.map((r) => r.label)
    assert.ok(labels.includes('Record / Playback'))
    assert.ok(labels.includes('Overflow'))
  })

  test('new projects get default subnet and IP ranges', () => {
    const data = newProjectData('X')
    assert.equal(data.subnet, '192.168.10.0/24')
    assert.equal(data.ipRanges.find((r) => r.id === 'cameras')?.end, 99)
  })
})
