// Hardware model catalog. Port counts let a show be planned offline; Phase 2
// detection reads the real counts from the device and covers anything missing here.
//
// ATEM counts come from Bitfocus Companion's ATEM module model specs
// (github.com/bitfocus/companion-module-bmd-atem, src/models): external video
// inputs, aux outputs, multiview count (MVs), and whether outputs are named "Aux" or "Output".
// Multiview outputs are fixed (not nameable on the ATEM); a layout only carries a note per multiview.

export const CUSTOM_MODEL = 'custom'

export interface AtemModel {
  id: string
  label: string
  family: string
  inputs: number
  aux: number
  /** Multiview outputs (0 where the multiview shares the main output). */
  mvs: number
  /** Default output naming: older switchers call them Aux, Mini/SDI/Constellation call them Output. */
  outputPrefix: 'Aux' | 'Output'
}

export interface VideohubModel {
  id: string
  label: string
  family: string
  inputs: number
  outputs: number
}

export const ATEM_MODELS: AtemModel[] = [
  // Mini / SDI — on the Mini and SDI the multiview shares the main output, so no MV rows.
  { id: 'mini', label: 'ATEM Mini', family: 'Mini & SDI', inputs: 4, aux: 1, mvs: 0, outputPrefix: 'Output' },
  { id: 'mini-pro', label: 'ATEM Mini Pro', family: 'Mini & SDI', inputs: 4, aux: 1, mvs: 1, outputPrefix: 'Output' },
  { id: 'mini-pro-iso', label: 'ATEM Mini Pro ISO', family: 'Mini & SDI', inputs: 4, aux: 1, mvs: 1, outputPrefix: 'Output' },
  { id: 'mini-extreme', label: 'ATEM Mini Extreme', family: 'Mini & SDI', inputs: 8, aux: 2, mvs: 1, outputPrefix: 'Output' },
  { id: 'mini-extreme-iso', label: 'ATEM Mini Extreme ISO', family: 'Mini & SDI', inputs: 8, aux: 2, mvs: 1, outputPrefix: 'Output' },
  { id: 'mini-extreme-iso-g2', label: 'ATEM Mini Extreme ISO G2', family: 'Mini & SDI', inputs: 8, aux: 3, mvs: 1, outputPrefix: 'Output' },
  { id: 'sdi', label: 'ATEM SDI', family: 'Mini & SDI', inputs: 4, aux: 2, mvs: 0, outputPrefix: 'Output' },
  { id: 'sdi-pro-iso', label: 'ATEM SDI Pro ISO', family: 'Mini & SDI', inputs: 4, aux: 2, mvs: 1, outputPrefix: 'Output' },
  { id: 'sdi-extreme-iso', label: 'ATEM SDI Extreme ISO', family: 'Mini & SDI', inputs: 8, aux: 4, mvs: 1, outputPrefix: 'Output' },

  { id: 'tvs', label: 'ATEM Television Studio', family: 'Television Studio', inputs: 6, aux: 1, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-hd', label: 'ATEM Television Studio HD', family: 'Television Studio', inputs: 8, aux: 1, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-pro-hd', label: 'ATEM Television Studio Pro HD', family: 'Television Studio', inputs: 8, aux: 1, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-pro-4k', label: 'ATEM Television Studio Pro 4K', family: 'Television Studio', inputs: 8, aux: 1, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-hd8', label: 'ATEM Television Studio HD8', family: 'Television Studio', inputs: 8, aux: 2, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-hd8-iso', label: 'ATEM Television Studio HD8 ISO', family: 'Television Studio', inputs: 8, aux: 2, mvs: 1, outputPrefix: 'Aux' },
  { id: 'tvs-4k8', label: 'ATEM Television Studio 4K8', family: 'Television Studio', inputs: 8, aux: 10, mvs: 1, outputPrefix: 'Output' },

  { id: 'ps-4k', label: 'ATEM Production Studio 4K', family: 'Production & Broadcast', inputs: 8, aux: 1, mvs: 1, outputPrefix: 'Aux' },
  { id: '1me', label: 'ATEM 1 M/E Production Switcher', family: 'Production & Broadcast', inputs: 8, aux: 3, mvs: 1, outputPrefix: 'Aux' },
  { id: '1me-4k', label: 'ATEM 1 M/E Production Studio 4K', family: 'Production & Broadcast', inputs: 10, aux: 3, mvs: 1, outputPrefix: 'Aux' },
  { id: '2me', label: 'ATEM 2 M/E Production Switcher', family: 'Production & Broadcast', inputs: 16, aux: 6, mvs: 2, outputPrefix: 'Aux' },
  { id: '2me-4k', label: 'ATEM 2 M/E Production Studio 4K', family: 'Production & Broadcast', inputs: 20, aux: 6, mvs: 2, outputPrefix: 'Aux' },
  { id: '2me-bs-4k', label: 'ATEM 2 M/E Broadcast Studio 4K', family: 'Production & Broadcast', inputs: 20, aux: 6, mvs: 2, outputPrefix: 'Aux' },
  { id: '4me-bs-4k', label: 'ATEM 4 M/E Broadcast Studio 4K', family: 'Production & Broadcast', inputs: 20, aux: 6, mvs: 2, outputPrefix: 'Aux' },

  { id: 'constellation-hd-1me', label: 'ATEM 1 M/E Constellation HD', family: 'Constellation', inputs: 10, aux: 6, mvs: 1, outputPrefix: 'Output' },
  { id: 'constellation-hd-2me', label: 'ATEM 2 M/E Constellation HD', family: 'Constellation', inputs: 20, aux: 12, mvs: 2, outputPrefix: 'Output' },
  { id: 'constellation-hd-4me', label: 'ATEM 4 M/E Constellation HD', family: 'Constellation', inputs: 40, aux: 24, mvs: 4, outputPrefix: 'Output' },
  { id: 'constellation-4k-1me', label: 'ATEM 1 M/E Constellation 4K', family: 'Constellation', inputs: 10, aux: 6, mvs: 1, outputPrefix: 'Output' },
  { id: 'constellation-4k-2me', label: 'ATEM 2 M/E Constellation 4K', family: 'Constellation', inputs: 20, aux: 12, mvs: 2, outputPrefix: 'Output' },
  { id: 'constellation-4k-4me', label: 'ATEM 4 M/E Constellation 4K', family: 'Constellation', inputs: 40, aux: 24, mvs: 4, outputPrefix: 'Output' },
  { id: 'constellation-4k-4me-plus', label: 'ATEM 4 M/E Constellation 4K Plus', family: 'Constellation', inputs: 80, aux: 48, mvs: 4, outputPrefix: 'Output' },
  { id: 'constellation-8k-hd', label: 'ATEM Constellation 8K (HD/4K mode)', family: 'Constellation', inputs: 40, aux: 24, mvs: 4, outputPrefix: 'Output' },
  { id: 'constellation-8k-8k', label: 'ATEM Constellation 8K (8K mode)', family: 'Constellation', inputs: 10, aux: 6, mvs: 1, outputPrefix: 'Output' },
]

export const VIDEOHUB_MODELS: VideohubModel[] = [
  { id: 'vh-10x10-12g', label: 'Videohub 10x10 12G', family: 'Videohub 12G', inputs: 10, outputs: 10 },
  { id: 'vh-20x20-12g', label: 'Videohub 20x20 12G', family: 'Videohub 12G', inputs: 20, outputs: 20 },
  { id: 'vh-40x40-12g', label: 'Videohub 40x40 12G', family: 'Videohub 12G', inputs: 40, outputs: 40 },
  { id: 'vh-80x80-12g', label: 'Videohub 80x80 12G', family: 'Videohub 12G', inputs: 80, outputs: 80 },
  { id: 'vh-120x120-12g', label: 'Videohub 120x120 12G', family: 'Videohub 12G', inputs: 120, outputs: 120 },

  { id: 'svh-12g-40x40', label: 'Smart Videohub 12G 40x40', family: 'Smart Videohub', inputs: 40, outputs: 40 },
  { id: 'svh-12x12', label: 'Smart Videohub 12x12', family: 'Smart Videohub', inputs: 12, outputs: 12 },
  { id: 'svh-cleanswitch-12x12', label: 'Smart Videohub CleanSwitch 12x12', family: 'Smart Videohub', inputs: 12, outputs: 12 },
  { id: 'svh-20x20', label: 'Smart Videohub 20x20', family: 'Smart Videohub', inputs: 20, outputs: 20 },
  { id: 'svh-40x40', label: 'Smart Videohub 40x40', family: 'Smart Videohub', inputs: 40, outputs: 40 },
  { id: 'svh-16x16', label: 'Smart Videohub 16x16', family: 'Smart Videohub', inputs: 16, outputs: 16 },

  { id: 'micro-vh-16x16', label: 'Micro Videohub 16x16', family: 'Other', inputs: 16, outputs: 16 },
  { id: 'vh-studio-16x16', label: 'Videohub Studio 16x16', family: 'Other', inputs: 16, outputs: 16 },
  { id: 'universal-vh-72', label: 'Universal Videohub 72', family: 'Other', inputs: 72, outputs: 72 },
  { id: 'universal-vh-288', label: 'Universal Videohub 288', family: 'Other', inputs: 288, outputs: 288 },
]

export function findAtemModel(id: string): AtemModel | undefined {
  return ATEM_MODELS.find((m) => m.id === id)
}

export function findVideohubModel(id: string): VideohubModel | undefined {
  return VIDEOHUB_MODELS.find((m) => m.id === id)
}

/** Group models by family, preserving catalog order. */
export function groupByFamily<T extends { family: string }>(models: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const m of models) {
    const list = groups.get(m.family) ?? []
    list.push(m)
    groups.set(m.family, list)
  }
  return [...groups]
}
