import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ATEM_MODELS,
  atemLabelIssues,
  autoShortName,
  buildAtem,
  buildVideohub,
  atemPortIsDefault,
  clearAtemPorts,
  resetAtemPorts,
  droppedAtemNames,
  droppedVideohubLabels,
  inferSubnet,
  ipIssues,
  networkGroups,
  networkRows,
  newProjectData,
  nextFreeIp,
  parseIp,
  parseSubnet,
  ProjectDataSchema,
  rangeForIp,
} from './index.ts'

describe('autoShortName', () => {
  const cases: Array<[string, string]> = [
    ['Camera 1', 'CAM1'],
    ['Laptop A', 'LAPA'],
    ['GFX 2', 'GFX2'],
    ['Playback B', 'PLAB'],
    ['MONITOR', 'MONI'],
    ['B2 Feed', 'B2FE'],
    ['Return 10', 'RT10'],
    ['Camera 15', 'CM15'], // the ATEM's own default (Constellation 4K)
    ['Output 12', 'OT12'], // the ATEM's own default (Constellation 4K)
    ['Camera 9', 'CAM9'],
    ['Monitor 1', 'MON1'],
    ['CAM12', 'CM12'],
    ['', ''],
  ]
  for (const [long, short] of cases) {
    test(`${long || '(empty)'} → ${short || '(empty)'}`, () => assert.equal(autoShortName(long), short))
  }
})

describe('ATEM label issues', () => {
  test('flags over-length and non-ASCII names', () => {
    assert.deepEqual(atemLabelIssues({ n: 1, long: 'A very long camera name', short: 'TOOLONG' }), [
      'long-too-long',
      'short-too-long',
    ])
    // Names may be Unicode (20 bytes); Labels must be ASCII.
    assert.deepEqual(atemLabelIssues({ n: 1, long: 'Café', short: 'CAFE' }), [])
    assert.deepEqual(atemLabelIssues({ n: 1, long: 'Café', short: 'CAFÉ' }), ['non-ascii'])
    assert.deepEqual(atemLabelIssues({ n: 1, long: 'Éééééééééé1', short: 'E1' }), ['long-too-long'], '11 characters but 21 bytes')
    assert.deepEqual(atemLabelIssues({ n: 1, long: 'Camera 1', short: null }), [])
  })
})

describe('IP parsing', () => {
  test('normalizes leading zeros and flags them', () => {
    assert.deepEqual(parseIp('192.168.10.09'), { value: 3232238089, normalized: '192.168.10.9', leadingZero: true })
  })
  test('rejects malformed addresses', () => {
    for (const bad of ['192.168.10', '192.168.10.256', '192.168.10.x', '1.2.3.4.5', '']) assert.equal(parseIp(bad), null)
  })
  test('parses subnets', () => {
    assert.deepEqual(parseSubnet('192.168.10.77/24'), { network: 3232238080, prefix: 24, size: 256 })
    assert.equal(parseSubnet('192.168.10.0'), null)
  })
})

describe('IP issues', () => {
  const subnet = '192.168.10.0/24'
  test('detects duplicates, subnet, reserved and leading zeros', () => {
    const all = ['192.168.10.12', '192.168.10.012', '10.0.0.5', '192.168.10.255']
    assert.deepEqual(ipIssues('192.168.10.12', subnet, all), ['duplicate'])
    assert.deepEqual(ipIssues('192.168.10.012', subnet, all), ['leading-zero', 'duplicate'])
    assert.deepEqual(ipIssues('10.0.0.5', subnet, all), ['outside-subnet'])
    assert.deepEqual(ipIssues('192.168.10.255', subnet, all), ['reserved'])
    assert.deepEqual(ipIssues('nope', subnet, all), ['invalid'])
    assert.deepEqual(ipIssues('', subnet, all), [])
  })
})

describe('IP ranges', () => {
  test('finds the role for an IP and the next free address', () => {
    const data = newProjectData('Test')
    data.network = [
      { id: 'a', name: 'Record 1', ip: '192.168.10.30' },
      { id: 'b', name: 'Record 2', ip: '192.168.10.31' },
    ]
    const recording = data.ipRanges.find((r) => r.id === 'recording')!
    assert.equal(rangeForIp('192.168.10.45', data)?.id, 'recording')
    assert.equal(rangeForIp('192.168.10.70', data)?.id, 'cameras')
    assert.equal(nextFreeIp(recording, data), '192.168.10.32')
  })
  test('counts the ATEM and Videohub IPs as used', () => {
    const data = newProjectData('Test')
    data.atem = { ...buildAtem('mini', null, null), ip: '192.168.10.12' }
    data.network = [
      { id: 'a', name: 'Panel A', ip: '192.168.10.10' },
      { id: 'b', name: 'Panel B', ip: '192.168.10.11' },
    ]
    const switching = data.ipRanges.find((r) => r.id === 'switching')!
    assert.equal(nextFreeIp(switching, data), '192.168.10.13')
  })
  test('infers the most common /24', () => {
    assert.equal(inferSubnet(['10.1.1.5', '192.168.10.9', '192.168.10.30']), '192.168.10.0/24')
    assert.equal(inferSubnet([]), '192.168.10.0/24')
  })
})

describe('layouts', () => {
  test('every ATEM model builds a layout with the catalog counts', () => {
    for (const model of ATEM_MODELS) {
      const atem = buildAtem(model.id, null, null)
      assert.equal(atem.inputs.length, model.inputs, model.id)
      assert.equal(atem.outputs.length, model.aux, model.id)
    }
  })
  test('changing model keeps labels on ports that still exist', () => {
    const big = buildAtem('constellation-4k-2me', null, null)
    big.inputs[0]!.long = 'Camera 1'
    big.inputs[15]!.long = 'Laptop A'
    big.outputs[0]!.long = 'Program'
    big.ip = '192.168.10.12'
    const small = buildAtem('constellation-4k-1me', null, big)
    assert.equal(small.inputs[0]!.long, 'Camera 1')
    assert.equal(small.outputs[0]!.long, 'Program')
    assert.equal(small.ip, '192.168.10.12')
    assert.equal(droppedAtemNames(big, small), 1, 'only Laptop A is a real name; dropped defaults are not counted')
  })
  test('new devices start with the default port names', () => {
    const constellation = buildAtem('constellation-4k-2me', null, null)
    assert.equal(constellation.inputs[0]!.long, 'Camera 1')
    assert.equal(constellation.inputs[0]!.short, null, 'label stays auto (CAM1)')
    assert.equal(constellation.outputs[0]!.long, 'Output 1')
    assert.equal(constellation.outputs.at(-1)!.long, 'Output 12')
    assert.equal(buildAtem('tvs-hd', null, null).outputs[0]!.long, 'Aux 1')
    const hub = buildVideohub('vh-10x10-12g', null, null)
    assert.equal(hub.inputs[0]!.label, 'Input 1')
    assert.equal(hub.outputs[9]!.label, 'Output 10')
  })
  test('changing model renames ports still on defaults, keeps real names', () => {
    const tvs = buildAtem('tvs-hd8', null, null) // outputs: Aux 1, Aux 2
    tvs.inputs[1]!.long = 'Laptop'
    const four = buildAtem('constellation-4k-1me', null, tvs)
    assert.equal(four.outputs[0]!.long, 'Output 1')
    assert.equal(four.inputs[1]!.long, 'Laptop')
    assert.equal(four.inputs[9]!.long, 'Camera 10', 'new ports get defaults')
  })
  test('default names do not count as labels', () => {
    const atem = buildAtem('mini', null, null)
    assert.ok(atem.inputs.every((p) => atemPortIsDefault('mini', p)))
    atem.inputs[0]!.short = 'C1'
    assert.ok(!atemPortIsDefault('mini', atem.inputs[0]!), 'an overridden label makes it named')
    const big = buildVideohub('vh-20x20-12g', null, null)
    big.inputs[15]!.label = 'Spare feed'
    assert.equal(droppedVideohubLabels(big, buildVideohub('vh-10x10-12g', null, big)), 1)
  })
  test('reset and clear act on one list only', () => {
    const atem = buildAtem('tvs-hd8', null, null)
    atem.inputs[0]!.long = 'Laptop'
    atem.outputs[0]!.short = 'PGM'
    resetAtemPorts(atem.model, atem.outputs)
    assert.deepEqual([atem.outputs[0]!.long, atem.outputs[0]!.short], ['Aux 1', null])
    assert.equal(atem.inputs[0]!.long, 'Laptop', 'inputs untouched')
    clearAtemPorts(atem.inputs)
    assert.ok(atem.inputs.every((p) => p.long === '' && p.short === null))
    assert.equal(atem.outputs[1]!.long, 'Aux 2', 'outputs untouched')
  })
  test('older projects with multiview rows load without them', () => {
    const data = newProjectData('Old')
    const raw = JSON.parse(JSON.stringify({ ...data, atem: buildAtem('constellation-4k-1me', null, null) }))
    raw.atem.outputs.push({ kind: 'mv', n: 1, long: 'MV 1', short: null })
    const parsed = ProjectDataSchema.parse(raw)
    assert.equal(parsed.atem!.outputs.length, 6)
  })
  test('custom counts produce a custom layout', () => {
    const atem = buildAtem('custom', { inputs: 3, aux: 2 }, null)
    assert.equal(atem.model, 'custom')
    assert.deepEqual(
      atem.outputs.map((o) => `${o.kind}${o.n}`),
      ['aux1', 'aux2'],
    )
    const hub = buildVideohub('custom', { inputs: 12, outputs: 6 }, null)
    assert.equal(hub.outputs.length, 6)
  })
})

describe('network groups', () => {
  test('group rows by role in range order, sorted by IP, with no-IP rows last', () => {
    const data = newProjectData('Test')
    data.atem = { ...buildAtem('mini', null, null), ip: '192.168.10.12' }
    data.network = [
      { id: 'rec2', name: 'Record 2', ip: '192.168.10.31' },
      { id: 'none', name: 'Spare Camera', ip: '' },
      { id: 'rec1', name: 'Record 1', ip: '192.168.10.30' },
      { id: 'far', name: 'Laptop', ip: '10.0.0.5' },
    ]
    assert.deepEqual(
      networkGroups(data).map((g) => [g.label, g.span, g.rows.map((r) => r.name)]),
      [
        ['Switching & Control', '.10–.19', ['ATEM']],
        ['Record / Playback', '.30–.49', ['Record 1', 'Record 2']],
        ['No IP / outside ranges', '', ['Laptop', 'Spare Camera']],
      ],
    )
  })
})

describe('network rows', () => {
  test('are sorted by IP with the ATEM among the other devices, and no-IP rows last', () => {
    const data = newProjectData('Test')
    data.atem = { ...buildAtem('mini', null, null), ip: '192.168.10.12' }
    data.network = [
      { id: 'rec', name: 'Record 1', ip: '192.168.10.30' },
      { id: 'none', name: 'Spare Camera', ip: '' },
      { id: 'ptz', name: 'Camera Control', ip: '192.168.10.9' },
      { id: 'ctrl', name: 'Switcher Panel', ip: '192.168.10.13' },
    ]
    assert.deepEqual(
      networkRows(data).map((r) => r.name),
      ['Camera Control', 'ATEM', 'Switcher Panel', 'Record 1', 'Spare Camera'],
    )
  })
})
