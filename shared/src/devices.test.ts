import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  applyAtemReading,
  applyVideohubReading,
  atemFactoryPlan,
  atemFromReading,
  atemWritePlan,
  buildAtem,
  buildVideohub,
  compareAtem,
  changedPortCount,
  compareVideohub,
  diffCounts,
  videohubFactoryPlan,
  videohubWritePlan,
  type AtemReading,
  type VideohubReading,
} from './index.ts'

/** What a 1 M/E Constellation 4K might report: a few named inputs, the rest default. */
function atemReading(): AtemReading {
  // Factory defaults as the ATEM reports them: CAM1–CAM9, then CM10 (seen on a Constellation 4K).
  const inputs = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, long: `Camera ${i + 1}`, short: i < 9 ? `CAM${i + 1}` : `CM${i + 1}` }))
  inputs[0] = { n: 1, long: 'Laptop A', short: 'LAPA' }
  inputs[1] = { n: 2, long: 'Lectern', short: 'LECT' }
  return {
    productName: 'ATEM 1 M/E Constellation 4K',
    model: 'constellation-4k-1me',
    counts: { inputs: 10, aux: 6, mvs: 1 },
    inputs,
    outputs: [
      ...Array.from({ length: 6 }, (_, i) => ({ kind: 'aux' as const, n: i + 1, long: i === 0 ? 'Program' : `Output ${i + 1}`, short: i === 0 ? 'PGM' : `OUT${i + 1}` })),
    ],
    factoryDefaults: ['in:3'],
  }
}

describe('compare with device', () => {
  test('ATEM: same, different, and ports only on one side', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    project.inputs[0]!.long = 'Laptop A' // same as device (auto label KEYA matches)
    project.inputs[1]!.long = 'Podium' // different
    const rows = compareAtem(project, atemReading())
    const byKey = new Map(rows.map((r) => [r.key, r]))
    assert.equal(byKey.get('in:1')!.status, 'same')
    assert.equal(byKey.get('in:2')!.status, 'different')
    assert.equal(byKey.get('in:3')!.status, 'same', 'default Camera 3 / CAM3 on both')
    assert.equal(byKey.get('aux:1')!.status, 'different', 'a default name in the project is a name like any other')
    assert.deepEqual(byKey.get('aux:1')!.project, { name: 'Output 1', label: 'OUT1' })
    project.outputs[0]!.long = ''
    const blank = compareAtem(project, atemReading()).find((r) => r.key === 'aux:1')!
    assert.equal(blank.status, 'not-set', 'blank: the device keeps Program')
    assert.deepEqual(blank.project, { name: 'Output 1', label: 'OUT1' }, 'shown as the default it stands for')

    const bigger = buildAtem('constellation-4k-2me', null, null)
    const counts = diffCounts(compareAtem(bigger, atemReading()))
    assert.equal(counts['project-only'], 10 + 6, 'inputs 11–20, aux 7–12')
  })

  test('ATEM: a blank project Name stands for the default, so it matches a device on factory names', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    project.inputs[2]!.long = '' // device: Camera 3 / CAM3 (factory)
    const row = compareAtem(project, atemReading()).find((r) => r.key === 'in:3')!
    assert.equal(row.status, 'same')
    project.inputs[0]!.long = '' // device: Laptop A
    assert.equal(compareAtem(project, atemReading()).find((r) => r.key === 'in:1')!.status, 'not-set')
  })

  test('ATEM: a label typed in the project differs from the device label', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    project.inputs[0]!.long = 'Laptop A'
    project.inputs[0]!.short = 'KNA'
    assert.equal(compareAtem(project, atemReading())[0]!.status, 'different')
  })

  test('use device names: selected ports only, labels that match auto stay auto', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    const next = applyAtemReading(project, atemReading(), new Set(['in:2', 'aux:1']), false)
    assert.deepEqual(next.inputs[1], { n: 2, long: 'Lectern', short: null }, 'LECT is the auto label')
    assert.deepEqual(next.outputs[0], { kind: 'aux', n: 1, long: 'Program', short: 'PGM' }, 'PGM is not the auto label (PROG)')
    assert.equal(next.inputs[0]!.long, 'Camera 1', 'not selected, untouched')
    assert.equal(project.inputs[1]!.long, 'Camera 2', 'original not mutated')
  })

  test('counts the ports a copy changed', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    const next = applyAtemReading(project, atemReading(), new Set(['in:1', 'in:2', 'in:3']), false)
    assert.equal(changedPortCount(project, next), 2, 'in:3 is the same default on both sides')
  })

  test('use device names can switch the project to the device model', () => {
    const project = buildAtem('mini', null, null)
    project.ip = '192.168.10.12'
    const next = applyAtemReading(project, atemReading(), 'all', true)
    assert.equal(next.model, 'constellation-4k-1me')
    assert.equal(next.inputs.length, 10)
    assert.equal(next.inputs[0]!.long, 'Laptop A')
    assert.equal(next.ip, '192.168.10.12')
  })

  test('create from device', () => {
    const atem = atemFromReading(atemReading(), '192.168.10.12')
    assert.equal(atem.model, 'constellation-4k-1me')
    assert.equal(atem.ip, '192.168.10.12')
    assert.equal(atem.outputs[0]!.long, 'Program')
  })

  test('a custom ATEM from a device gets the multiviews the device reports; switching model keeps notes', () => {
    const atem = atemFromReading({ ...atemReading(), model: 'custom', counts: { inputs: 10, aux: 6, mvs: 2 } }, '192.168.10.12')
    assert.deepEqual(atem.multiviews, [
      { n: 1, note: '' },
      { n: 2, note: '' },
    ])
    atem.multiviews[0]!.note = 'Director'
    const next = applyAtemReading(atem, atemReading(), 'all', true)
    assert.deepEqual(next.multiviews, [{ n: 1, note: 'Director' }], 'the Constellation 4K 1 M/E has one multiview')
  })

  test('Videohub compare and apply', () => {
    const reading: VideohubReading = {
      modelName: 'Blackmagic Videohub 10x10 12G',
      model: 'vh-10x10-12g',
      counts: { inputs: 10, outputs: 10 },
      inputs: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, label: i === 0 ? 'Cam 1 ISO' : `Input ${String(i + 1).padStart(2, '0')}` })),
      outputs: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, label: `Output ${String(i + 1).padStart(2, '0')}` })),
    }
    const project = buildVideohub('vh-10x10-12g', null, null)
    const counts = diffCounts(compareVideohub(project, reading))
    assert.deepEqual(counts, { same: 19, different: 1, 'not-set': 0, 'project-only': 0, 'device-only': 0 })
    project.inputs[0]!.label = ''
    assert.equal(compareVideohub(project, reading)[0]!.status, 'not-set')
    assert.equal(applyVideohubReading(project, reading, 'all', false).inputs[0]!.label, 'Cam 1 ISO')
  })
})

describe('send to device: write plan', () => {
  test('ATEM: selected differences only, resolved labels, device names kept for undo, not-set ports never sent', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    project.inputs[0]!.long = 'Wide' // device: Laptop A / LAPA
    project.inputs[1]!.long = '' // device: Lectern — empty in project, never blank the device
    project.outputs[0]!.long = 'Main Program'
    project.outputs[0]!.short = 'PGM'
    const plan = atemWritePlan(project, atemReading(), 'all')
    assert.deepEqual(plan.ports, [
      { kind: 'in', n: 1, long: 'Wide', short: 'WIDE' },
      { kind: 'aux', n: 1, long: 'Main Program', short: 'PGM' },
    ])
    assert.deepEqual(plan.undo, [
      { kind: 'in', n: 1, long: 'Laptop A', short: 'LAPA' },
      { kind: 'aux', n: 1, long: 'Program', short: 'PGM' },
    ])
    assert.deepEqual(plan.problems, [])
    assert.equal(atemWritePlan(project, atemReading(), new Set(['aux:1'])).ports.length, 1, 'selection respected')
  })

  test('default names in the project are sent; blank ones never are', () => {
    const project = buildAtem('constellation-4k-1me', null, null) // all defaults
    const plan = atemWritePlan(project, atemReading(), 'all') // device has Laptop A, Lectern, Program
    assert.deepEqual(plan.ports, [
      { kind: 'in', n: 1, long: 'Camera 1', short: 'CAM1' },
      { kind: 'in', n: 2, long: 'Camera 2', short: 'CAM2' },
      { kind: 'aux', n: 1, long: 'Output 1', short: 'OUT1' },
    ])
    for (const p of [...project.inputs, ...project.outputs]) p.long = ''
    assert.deepEqual(atemWritePlan(project, atemReading(), 'all').ports, [], 'blank: the ATEM keeps its names')

    const hub = buildVideohub('vh-10x10-12g', null, null)
    const reading: VideohubReading = { modelName: 'X', model: 'vh-10x10-12g', counts: { inputs: 10, outputs: 10 }, inputs: hub.inputs.map((p) => ({ ...p, label: p.n === 1 ? 'Cam 1 ISO' : p.label })), outputs: hub.outputs }
    assert.deepEqual(videohubWritePlan(hub, reading, 'all').ports, [{ side: 'in', n: 1, label: 'Input 01' }])
    hub.inputs[0]!.label = ''
    assert.deepEqual(videohubWritePlan(hub, reading, 'all').ports, [], 'blank: "Cam 1 ISO" stays')
  })

  test('set all to default: factory names for every port not already on them, device names kept for undo', () => {
    const plan = atemFactoryPlan(atemReading())
    assert.deepEqual(plan.ports, [
      { kind: 'in', n: 1, long: 'Camera 1', short: 'CAM1' },
      { kind: 'in', n: 2, long: 'Camera 2', short: 'CAM2' },
      { kind: 'aux', n: 1, long: 'Output 1', short: 'OUT1' },
    ])
    const renamed = atemReading()
    renamed.inputs[9] = { n: 10, long: 'Spare', short: 'SPAR' }
    assert.deepEqual(atemFactoryPlan(renamed).ports[2], { kind: 'in', n: 10, long: 'Camera 10', short: 'CM10' })
    assert.deepEqual(plan.undo[0], { kind: 'in', n: 1, long: 'Laptop A', short: 'LAPA' })

    const hub = buildVideohub('vh-10x10-12g', null, null)
    const reading: VideohubReading = { modelName: 'X', model: 'vh-10x10-12g', counts: { inputs: 10, outputs: 10 }, inputs: hub.inputs.map((p) => ({ ...p, label: p.n === 1 ? 'Cam 1 ISO' : p.label })), outputs: hub.outputs }
    const hubPlan = videohubFactoryPlan(reading)
    assert.deepEqual(hubPlan.ports, [{ side: 'in', n: 1, label: 'Input 01' }])
    assert.deepEqual(hubPlan.undo, [{ side: 'in', n: 1, label: 'Cam 1 ISO' }])
  })

  test('ATEM: names the switcher cannot take are reported', () => {
    const project = buildAtem('constellation-4k-1me', null, null)
    project.inputs[0]!.long = 'Éééééééééé1'
    project.inputs[0]!.short = 'É1'
    assert.equal(atemWritePlan(project, atemReading(), 'all').problems.length, 2)
  })

  test('Videohub plan', () => {
    const project = buildVideohub('vh-10x10-12g', null, null)
    project.outputs[2]!.label = 'Confidence'
    const reading: VideohubReading = { modelName: 'X', model: 'vh-10x10-12g', counts: { inputs: 10, outputs: 10 }, inputs: [...project.inputs], outputs: structuredClone(buildVideohub('vh-10x10-12g', null, null).outputs) }
    const plan = videohubWritePlan(project, reading, 'all')
    assert.deepEqual(plan.ports, [{ side: 'out', n: 3, label: 'Confidence' }])
    assert.deepEqual(plan.undo, [{ side: 'out', n: 3, label: 'Output 03' }])
  })
})
