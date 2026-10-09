import { z } from 'zod'
import { findAtemModel } from './catalog.ts'

export const ATEM_LONG_MAX = 20
export const ATEM_SHORT_MAX = 4

export const AtemInputSchema = z.object({
  n: z.number().int().positive(),
  long: z.string(),
  /** null = auto-generated from the long name. */
  short: z.string().nullable(),
})

export const AtemOutputSchema = z.object({
  kind: z.literal('aux'),
  n: z.number().int().positive(),
  long: z.string(),
  short: z.string().nullable(),
})

/** A multiview output. Multiviews are fixed on the ATEM, so this is only a note for the patch sheet. */
export const AtemMultiviewSchema = z.object({
  n: z.number().int().positive(),
  note: z.string(),
})

export const AtemSchema = z.object({
  model: z.string(),
  name: z.string(),
  ip: z.string(),
  inputs: z.array(AtemInputSchema),
  outputs: z.array(AtemOutputSchema),
  multiviews: z.array(AtemMultiviewSchema),
})

export const VideohubPortSchema = z.object({
  n: z.number().int().positive(),
  label: z.string(),
})

export const VideohubSchema = z.object({
  model: z.string(),
  name: z.string(),
  ip: z.string(),
  inputs: z.array(VideohubPortSchema),
  outputs: z.array(VideohubPortSchema),
})

export const NetworkEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  ip: z.string(),
})

export const IpRangeSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Host offsets from the subnet's network address, inclusive. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
})

/** True for text that only names a multiview ("MV 1", "Multiview 2"), so isn't a note about it. */
export function isMultiviewPlaceholder(text: string): boolean {
  return /^(mv|multi ?view(er)?) ?\d*$/i.test(text.trim())
}

/**
 * Bring an ATEM saved by an older version up to date before validating:
 * - Multiview rows were once outputs with kind "mv" (multiviews are fixed, not nameable on the ATEM);
 *   they're dropped from the outputs, and any real name on one becomes that multiview's note.
 * - ATEMs saved before multiview notes existed get the model's multiviews (custom: one per old MV row).
 */
function upgradeAtem(raw: unknown): unknown {
  const atem = (raw as { atem?: Record<string, unknown> } | null)?.atem
  if (!atem || !Array.isArray(atem.outputs)) return raw
  type OldRow = { kind?: string; n?: number; long?: string }
  const outputs = atem.outputs as OldRow[]
  const mvRows = outputs.filter((o) => o?.kind === 'mv')
  let multiviews = atem.multiviews
  if (multiviews === undefined) {
    const count = typeof atem.model === 'string' ? (findAtemModel(atem.model)?.mvs ?? mvRows.length) : mvRows.length
    const oldNote = (n: number) => {
      const long = mvRows.find((o) => o.n === n)?.long?.trim() ?? ''
      return isMultiviewPlaceholder(long) ? '' : long
    }
    multiviews = Array.from({ length: count }, (_, i) => ({ n: i + 1, note: oldNote(i + 1) }))
  }
  return { ...(raw as object), atem: { ...atem, outputs: outputs.filter((o) => o?.kind !== 'mv'), multiviews } }
}

export const ProjectDataSchema = z.preprocess(upgradeAtem, z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string(),
  subnet: z.string(),
  ipRanges: z.array(IpRangeSchema),
  atem: AtemSchema.nullable(),
  videohub: VideohubSchema.nullable(),
  network: z.array(NetworkEntrySchema),
}))

export type AtemInput = z.infer<typeof AtemInputSchema>
export type AtemOutput = z.infer<typeof AtemOutputSchema>
export type AtemMultiview = z.infer<typeof AtemMultiviewSchema>
export type Atem = z.infer<typeof AtemSchema>
export type VideohubPort = z.infer<typeof VideohubPortSchema>
export type Videohub = z.infer<typeof VideohubSchema>
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>
export type IpRange = z.infer<typeof IpRangeSchema>
export type ProjectData = z.infer<typeof ProjectDataSchema>

export interface Project {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  data: ProjectData
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  atemModel: string | null
  videohubModel: string | null
  networkCount: number
  subnet: string
}
