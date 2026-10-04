import { z } from 'zod'

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

export const AtemSchema = z.object({
  model: z.string(),
  name: z.string(),
  ip: z.string(),
  inputs: z.array(AtemInputSchema),
  outputs: z.array(AtemOutputSchema),
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

/**
 * Projects saved before multiview rows were removed (multiviews are fixed outputs, not nameable on
 * the ATEM) may still have outputs with kind "mv"; drop them before validating.
 */
function dropMultiviewRows(raw: unknown): unknown {
  const atem = (raw as { atem?: { outputs?: unknown } } | null)?.atem
  if (!atem || !Array.isArray(atem.outputs)) return raw
  return { ...(raw as object), atem: { ...atem, outputs: atem.outputs.filter((o: { kind?: string }) => o?.kind !== 'mv') } }
}

export const ProjectDataSchema = z.preprocess(dropMultiviewRows, z.object({
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
}
