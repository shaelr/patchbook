import ExcelJS from 'exceljs'
import {
  ATEM_LONG_MAX,
  ATEM_MODELS,
  ATEM_SHORT_MAX,
  CUSTOM_MODEL,
  VIDEOHUB_MODELS,
  autoShortName,
  atemModelLabel,
  buildAtem,
  buildVideohub,
  inferSubnet,
  newId,
  networkGroups,
  newProjectData,
  parseIp,
  resolveShort,
  videohubModelLabel,
  type ProjectData,
} from '@patchbook/shared'

// Spreadsheet layout (the user's template): a row of section titles
// ("ATEM", "Video Hub", "IP" — Patchbook exports call it "Network"), then a row
// of column headers, then data.
// In the template the titles are on row 1; Patchbook's export puts a project
// header above them, so the importer looks for the title row.
//   ATEM (template):   In | Label | … | Out | Label          (Label = the name)
//   ATEM (export):     In | Name | Label | … | Out | Name | Label
//                      (Blackmagic's terms: Name = 20-char long name, Label = 4-char short name)
//   Video Hub:         In | Label | … | Out | Label
//   IP / Network:      Equipment | [Location] | IP
// When a side has a Name column, Label is the 4-character label; otherwise Label is the name.
// Older Patchbook exports used "Short" for the 4-character label; that is still read.
// Location is ignored. Exports group the network list under merged role
// header rows, which the importer skips.

type Section = 'atem' | 'videohub' | 'ip'

export interface ImportResult {
  data: ProjectData
  warnings: string[]
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Section titles may carry a model after a dash, as Patchbook's export writes: "ATEM — ATEM 2 M/E Constellation 4K". */
function parseTitle(title: string): { section: Section | null; modelLabel: string } {
  const [head = '', ...rest] = title.split(/\s+[—–-]\s+/)
  return { section: sectionFor(head), modelLabel: rest.join(' - ').trim() }
}

const HEADER_WORDS = new Set(['in', 'input', 'inputs', 'out', 'output', 'outputs', 'label', 'equipment', 'device', 'ip'])

/** Section titles found in a row, skipping the repeated cells of merged titles. */
function titlesInRow(sheet: ExcelJS.Worksheet, row: number) {
  const titles: Array<{ col: number; section: Section; modelLabel: string }> = []
  for (let col = 1; col <= sheet.columnCount; col++) {
    const cell = sheet.getRow(row).getCell(col)
    if (cell.isMerged && cell.master !== cell) continue
    const { section, ...rest } = parseTitle(cell.text.trim())
    if (section) titles.push({ col, section, ...rest })
  }
  return titles
}

/** The first row with section titles that has column headers directly beneath it. */
function findTitleRow(sheet: ExcelJS.Worksheet): number | null {
  for (let row = 1; row <= Math.min(20, sheet.rowCount); row++) {
    if (titlesInRow(sheet, row).length === 0) continue
    for (let col = 1; col <= sheet.columnCount; col++) {
      if (HEADER_WORDS.has(norm(cellText(sheet, row + 1, col)))) return row
    }
  }
  return null
}

function sectionFor(title: string): Section | null {
  const t = norm(title)
  if (t === 'atem') return 'atem'
  if (t === 'videohub' || t === 'smartvideohub' || t === 'hub') return 'videohub'
  if (['ip', 'ips', 'network', 'networkconfig', 'networkconfiguration'].includes(t)) return 'ip'
  return null
}

function cellText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  return sheet.getRow(row).getCell(col).text.trim()
}

interface PortColumns {
  inCol?: number
  inLabel?: number
  inShort?: number
  outCol?: number
  outLabel?: number
  outShort?: number
}

function portColumns(headers: Array<[number, string]>): PortColumns {
  const cols: PortColumns = {}
  const sides: Record<'in' | 'out', Array<[number, string]>> = { in: [], out: [] }
  let side: 'in' | 'out' | null = null
  for (const [col, header] of headers) {
    const h = norm(header)
    if (h === 'in' || h === 'input' || h === 'inputs') [side, cols.inCol] = ['in', col]
    else if (h === 'out' || h === 'output' || h === 'outputs') [side, cols.outCol] = ['out', col]
    else if (side && h) sides[side].push([col, h])
  }
  for (const s of ['in', 'out'] as const) {
    const find = (...names: string[]) => sides[s].find(([, h]) => names.includes(h))?.[0]
    const nameCol = find('name', 'longname', 'long')
    const labelCol = find('label', 'labels')
    const long = nameCol ?? labelCol
    const short = find('short', 'shortname') ?? (nameCol !== undefined ? labelCol : undefined)
    if (s === 'in') [cols.inLabel, cols.inShort] = [long, short]
    else [cols.outLabel, cols.outShort] = [long, short]
  }
  return cols
}

interface RawPort {
  kind: 'in' | 'aux'
  n: number
  label: string
  short: string
}

function readPorts(sheet: ExcelJS.Worksheet, cols: PortColumns, firstRow: number): RawPort[] {
  const ports: RawPort[] = []
  for (let row = firstRow; row <= sheet.rowCount; row++) {
    const read = (numCol?: number, labelCol?: number, shortCol?: number, isOutput = false) => {
      if (!numCol) return
      const id = cellText(sheet, row, numCol)
      const label = labelCol ? cellText(sheet, row, labelCol) : ''
      const short = shortCol ? cellText(sheet, row, shortCol) : ''
      // Numbered rows only; "MV 1" rows (multiview outputs, fixed on the ATEM) are skipped.
      if (/^\d+$/.test(id)) ports.push({ kind: isOutput ? 'aux' : 'in', n: Number(id), label, short })
    }
    read(cols.inCol, cols.inLabel, cols.inShort)
    read(cols.outCol, cols.outLabel, cols.outShort, true)
  }
  return ports
}

const maxN = (ports: RawPort[], kind: RawPort['kind']) => Math.max(0, ...ports.filter((p) => p.kind === kind).map((p) => p.n))

/** Only pick a catalog model when exactly one matches; otherwise leave it for the user. */
function uniqueMatch<T extends { id: string }>(models: T[], matches: (m: T) => boolean): string {
  const found = models.filter(matches)
  return found.length === 1 ? found[0]!.id : CUSTOM_MODEL
}

export async function importXlsx(buffer: Buffer, fallbackName: string): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new ImportError('The workbook has no sheets.')

  const titleRow = findTitleRow(sheet)
  if (!titleRow) throw new ImportError('No "ATEM", "Video Hub" or "IP" section with column headers found.')
  const headerRow = titleRow + 1
  const firstRow = titleRow + 2
  const titles = titlesInRow(sheet, titleRow)

  const data = newProjectData(fallbackName)
  const warnings: string[] = []

  titles.forEach(({ col: startCol, section, modelLabel }, i) => {
    const endCol = titles[i + 1] ? titles[i + 1]!.col - 1 : sheet.columnCount
    const headers: Array<[number, string]> = []
    for (let col = startCol; col <= endCol; col++) headers.push([col, cellText(sheet, headerRow, col)])

    if (section === 'atem') {
      const ports = readPorts(sheet, portColumns(headers), firstRow)
      const counts = { inputs: maxN(ports, 'in'), aux: maxN(ports, 'aux') }
      const model =
        ATEM_MODELS.find((m) => m.label === modelLabel)?.id ??
        uniqueMatch(ATEM_MODELS, (m) => m.inputs === counts.inputs && m.aux === counts.aux)
      const atem = buildAtem(model, counts, null)
      for (const p of ports) {
        const target =
          p.kind === 'in' ? atem.inputs.find((x) => x.n === p.n) : atem.outputs.find((x) => x.kind === p.kind && x.n === p.n)
        if (!target) continue
        target.long = p.label
        target.short = p.short && p.short !== autoShortName(p.label) ? p.short : null
      }
      data.atem = atem
      if (model === CUSTOM_MODEL) {
        warnings.push(`ATEM model not identified from the sheet ${atemModelLabel(atem).replace('Custom ATEM ', '')}. Choose it on the ATEM tab; labels are kept.`)
      }
    }

    if (section === 'videohub') {
      const ports = readPorts(sheet, portColumns(headers), firstRow)
      const counts = { inputs: maxN(ports, 'in'), outputs: maxN(ports, 'aux') }
      if (counts.inputs === 0 && counts.outputs === 0) return
      const model =
        VIDEOHUB_MODELS.find((m) => m.label === modelLabel)?.id ??
        uniqueMatch(VIDEOHUB_MODELS, (m) => m.inputs === counts.inputs && m.outputs === counts.outputs)
      const hub = buildVideohub(model, counts, null)
      for (const p of ports) {
        const list = p.kind === 'in' ? hub.inputs : hub.outputs
        const target = list.find((x) => x.n === p.n)
        if (target) target.label = p.label
      }
      data.videohub = hub
      if (model === CUSTOM_MODEL) {
        warnings.push(`Videohub model not identified from the sheet (${counts.inputs}x${counts.outputs}). Choose it on the Videohub tab; labels are kept.`)
      }
    }

    if (section === 'ip') {
      const nameCol = headers.find(([, h]) => ['equipment', 'device', 'name', 'devicename'].includes(norm(h)))?.[0]
      const ipCol = headers.find(([, h]) => ['ip', 'ipaddress', 'address'].includes(norm(h)))?.[0]
      if (!nameCol || !ipCol) {
        warnings.push('IP section found, but no "Equipment" and "IP" columns; network list skipped.')
        return
      }
      for (let row = firstRow; row <= sheet.rowCount; row++) {
        if (sheet.getRow(row).getCell(nameCol).isMerged) continue // role group header in exports
        const name = cellText(sheet, row, nameCol)
        let ip = cellText(sheet, row, ipCol)
        if (!name && !ip) continue
        const parsed = parseIp(ip)
        if (parsed?.leadingZero) {
          warnings.push(`${name || 'Unnamed device'}: changed ${ip} to ${parsed.normalized} (leading zero removed).`)
          ip = parsed.normalized
        }
        data.network.push({ id: newId(), name, ip })
      }
    }
  })

  // The ATEM / Videohub's own row in the network list becomes that device's name and IP rather
  // than a separate entry. Patchbook exports record the device names on a hidden sheet; in the
  // template, the row is the one named exactly "ATEM" / "Videohub".
  const meta = readMeta(workbook)
  const claim = (device: { name: string; ip: string } | null, metaName: string | undefined, pattern: RegExp) => {
    if (!device) return
    const entry = data.network.find((e) => (metaName ? e.name.trim() === metaName : pattern.test(e.name.trim())))
    if (!entry) return
    device.ip = entry.ip
    device.name = entry.name
    data.network = data.network.filter((e) => e !== entry)
  }
  claim(data.atem, meta.atem, /^atem$/i)
  claim(data.videohub, meta.videohub, /^(smart\s*)?video\s*hub$/i)

  data.subnet = inferSubnet([...data.network.map((e) => e.ip), data.atem?.ip ?? '', data.videohub?.ip ?? ''])
  return { data, warnings }
}

export class ImportError extends Error {}

/** Hidden sheet in Patchbook exports: which network rows are the ATEM and Videohub. */
const META_SHEET = 'Patchbook'

function readMeta(workbook: ExcelJS.Workbook): Partial<Record<'atem' | 'videohub', string>> {
  const sheet = workbook.getWorksheet(META_SHEET)
  const meta: Partial<Record<'atem' | 'videohub', string>> = {}
  sheet?.eachRow((row) => {
    const key = row.getCell(1).text.trim()
    const name = row.getCell(2).text.trim()
    if ((key === 'atem' || key === 'videohub') && name) meta[key] = name
  })
  return meta
}

// ---------------------------------------------------------------------------
// Export

const FONT = 'Calibri'

const COLORS = {
  ink: 'FF1B1E23',
  muted: 'FF69707B',
  sectionFill: 'FF14161A',
  sectionText: 'FFF5A524',
  headerFill: 'FFE6E8EC',
  band: 'FFF6F7F9',
  grid: 'FFD3D7DE',
}

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: COLORS.grid } }
const GRID: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin }

interface Column {
  header: string
  width: number
  kind: 'num' | 'text' | 'short' | 'ip'
  /** Max characters, enforced with an Excel data-validation warning. */
  max?: number
}

/** One table in the sheet: a title bar over a set of columns, filled row by row. */
interface Block {
  title: string
  columns: Column[]
  /** Cell values; null means no port there (e.g. below the last output), left blank and unstyled. */
  rows: Array<Array<string | number | null>>
  /** Rows that are group headers: merged across the block, with this text. */
  groupRows?: Map<number, ExcelJS.RichText[]>
}

function atemBlocks(data: ProjectData): Block[] {
  const atem = data.atem
  if (!atem) return []
  const cols = (num: string): Column[] => [
    { header: num, width: 6, kind: 'num' },
    { header: 'Name', width: 24, kind: 'text', max: ATEM_LONG_MAX },
    { header: 'Label', width: 8, kind: 'short', max: ATEM_SHORT_MAX },
  ]
  const outputs = atem.outputs
  // Inputs and outputs sit side by side under one title, separated by a gap column.
  return [
    {
      title: `ATEM — ${atemModelLabel(atem)}`,
      columns: [...cols('In'), GAP, ...cols('Out')],
      rows: Array.from({ length: Math.max(atem.inputs.length, outputs.length) }, (_, i) => {
        const inp = atem.inputs[i]
        const out = outputs[i]
        return [
          inp?.n ?? null,
          inp ? inp.long : null,
          inp ? resolveShort(inp) : null,
          null,
          out ? out.n : null,
          out ? out.long : null,
          out ? resolveShort(out) : null,
        ]
      }),
    },
  ]
}

const GAP: Column = { header: '', width: 2, kind: 'text' }

function videohubBlocks(data: ProjectData): Block[] {
  const hub = data.videohub
  if (!hub) return []
  return [
    {
      title: `Video Hub — ${videohubModelLabel(hub)}`,
      columns: [
        { header: 'In', width: 6, kind: 'num' },
        { header: 'Label', width: 24, kind: 'text' },
        GAP,
        { header: 'Out', width: 6, kind: 'num' },
        { header: 'Label', width: 24, kind: 'text' },
      ],
      rows: Array.from({ length: Math.max(hub.inputs.length, hub.outputs.length) }, (_, i) => [
        hub.inputs[i]?.n ?? null,
        hub.inputs[i]?.label ?? null,
        null,
        hub.outputs[i]?.n ?? null,
        hub.outputs[i]?.label ?? null,
      ]),
    },
  ]
}

/** Network list grouped by role, like the print view. */
function networkBlock(data: ProjectData): Block {
  const rows: Block['rows'] = []
  const groupRows: NonNullable<Block['groupRows']> = new Map()
  for (const group of networkGroups(data)) {
    if (rows.length > 0) rows.push([null, null]) // breathing space before each new group
    groupRows.set(rows.length, [
      { text: group.label, font: { name: FONT, bold: true, size: 11, color: { argb: COLORS.ink } } },
      ...(group.span ? [{ text: `   ${group.span}`, font: { name: 'Courier New', size: 10, color: { argb: COLORS.muted } } }] : []),
    ])
    rows.push(['', ''])
    for (const d of group.rows) rows.push([d.name, d.ip])
  }
  return {
    title: 'Network',
    columns: [
      { header: 'Equipment', width: 26, kind: 'text' },
      { header: 'IP', width: 17, kind: 'ip' },
    ],
    rows,
    groupRows,
  }
}

/**
 * Export in the template's layout (blocks side by side, so it re-imports), styled for
 * reading and printing: project header, section bars, banded rows, print setup.
 */
export async function exportXlsx(data: ProjectData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Patchbook'
  workbook.title = data.name
  const sheet = workbook.addWorksheet(data.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Patchbook', {
    properties: { defaultRowHeight: 18 },
  })

  const blocks = [...atemBlocks(data), ...videohubBlocks(data), networkBlock(data)]
  const totalCols = blocks.reduce((n, b) => n + b.columns.length + 1, -1)

  // Project header
  let row = 1
  sheet.mergeCells(row, 1, row, totalCols)
  Object.assign(sheet.getCell(row, 1), { value: data.name, font: { name: FONT, bold: true, size: 18, color: { argb: COLORS.ink } } })
  sheet.getRow(row).height = 28
  row++
  const exported = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  sheet.mergeCells(row, 1, row, totalCols)
  Object.assign(sheet.getCell(row, 1), {
    value: `Subnet ${data.subnet}  ·  Exported ${exported} from Patchbook`,
    font: { name: FONT, size: 10, color: { argb: COLORS.muted } },
  })
  row++
  if (data.notes.trim()) {
    sheet.mergeCells(row, 1, row, totalCols)
    Object.assign(sheet.getCell(row, 1), {
      value: data.notes.trim(),
      font: { name: FONT, size: 10, italic: true, color: { argb: COLORS.ink } },
      alignment: { wrapText: true, vertical: 'top' },
    })
    sheet.getRow(row).height = Math.min(90, 15 * (data.notes.trim().split('\n').length + 1))
    row++
  }
  row++ // spacer

  const titleRow = row
  const headerRow = row + 1
  const firstRow = row + 2
  sheet.getRow(titleRow).height = 22
  sheet.getRow(headerRow).height = 18

  let col = 1
  for (const block of blocks) {
    const lastCol = col + block.columns.length - 1

    sheet.mergeCells(titleRow, col, titleRow, lastCol)
    const title = sheet.getCell(titleRow, col)
    title.value = block.title
    title.font = { name: FONT, bold: true, size: 12, color: { argb: COLORS.sectionText } }
    title.fill = fill(COLORS.sectionFill)
    title.alignment = { vertical: 'middle', indent: 1 }

    block.columns.forEach((c, i) => {
      const colIndex = col + i
      sheet.getColumn(colIndex).width = c.width
      if (c === GAP) return
      const head = sheet.getCell(headerRow, colIndex)
      head.value = c.header
      head.font = { name: FONT, bold: true, size: 10, color: { argb: COLORS.ink } }
      head.fill = fill(COLORS.headerFill)
      head.border = GRID
      head.alignment = { horizontal: c.kind === 'num' || c.kind === 'short' ? 'center' : 'left', vertical: 'middle' }
    })

    let band = 0
    block.rows.forEach((values, r) => {
      const rowIndex = firstRow + r
      const group = block.groupRows?.get(r)
      if (group) {
        sheet.mergeCells(rowIndex, col, rowIndex, lastCol)
        const cell = sheet.getCell(rowIndex, col)
        cell.value = { richText: group }
        cell.alignment = { vertical: 'bottom' }
        cell.border = { bottom: { style: 'thin', color: { argb: COLORS.ink } } }
        band = 0
        return
      }
      const banded = band++ % 2 === 1
      block.columns.forEach((c, i) => {
        const value = values[i] ?? null
        if (c === GAP || value === null) return
        const cell = sheet.getCell(rowIndex, col + i)
        cell.value = value
        cell.border = GRID
        cell.font = { name: FONT, size: 11, color: { argb: COLORS.ink } }
        if (banded) cell.fill = fill(COLORS.band)
        if (c.kind === 'num') {
          cell.font = { name: FONT, color: { argb: COLORS.muted } }
          cell.alignment = { horizontal: 'center' }
        } else if (c.kind === 'short') {
          cell.font = { name: 'Courier New', bold: true, size: 10 }
          cell.alignment = { horizontal: 'center' }
        } else if (c.kind === 'ip') {
          cell.font = { name: 'Courier New', size: 10 }
        }
        if (c.max) {
          cell.dataValidation = {
            type: 'textLength',
            operator: 'lessThanOrEqual',
            formulae: [c.max],
            allowBlank: true,
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Too long for the ATEM',
            error: `ATEM ${c.kind === 'short' ? 'labels' : 'names'} can be at most ${c.max} characters.`,
          }
        }
      })
    })

    sheet.getColumn(lastCol + 1).width = 3 // gap between blocks
    col = lastCol + 2
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }]
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printTitlesRow: `${titleRow}:${headerRow}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
  }
  const footerName = data.name.replace(/&/g, '&&')
  sheet.headerFooter = { oddFooter: `&L&8${footerName}&R&8Page &P of &N` }

  const meta = workbook.addWorksheet(META_SHEET, { state: 'veryHidden' })
  if (data.atem) meta.addRow(['atem', data.atem.name])
  if (data.videohub) meta.addRow(['videohub', data.videohub.name])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
