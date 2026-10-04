import type { AtemNameWrite, AtemReading, Project, ProjectData, ProjectSummary, VideohubLabelWrite, VideohubReading } from '@patchbook/shared'

export class ConflictError extends Error {
  current: Project
  constructor(current: Project) {
    super('Project was changed elsewhere')
    this.current = current
  }
}

export interface ImportResponse {
  project: Project
  warnings: string[]
}

async function request<T>(method: string, url: string, body?: BodyInit | object, init: RequestInit = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': isRaw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  })
  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => ({}))
  if (res.status === 409 && json.current) throw new ConflictError(json.current)
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json as T
}

export const api = {
  list: () => request<ProjectSummary[]>('GET', '/api/projects'),
  get: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  create: (name: string) => request<Project>('POST', '/api/projects', { name }),
  // keepalive lets a save finish while the page closes, but browsers cap those bodies at 64 KB.
  save: (id: string, version: number, data: ProjectData, keepalive = false) =>
    request<Project>('PUT', `/api/projects/${id}`, { version, data }, { keepalive: keepalive && JSON.stringify(data).length < 60_000 }),
  remove: (id: string) => request<void>('DELETE', `/api/projects/${id}`),
  duplicate: (id: string, name?: string) => request<Project>('POST', `/api/projects/${id}/duplicate`, { name }),
  importXlsx: (file: File) => request<ImportResponse>('POST', `/api/import/xlsx?name=${encodeURIComponent(file.name)}`, file),
  importJson: async (file: File) => request<ImportResponse>('POST', '/api/import/json', JSON.parse(await file.text())),
  readAtem: (ip: string) => request<AtemReading>('POST', '/api/devices/atem/read', { ip }),
  readVideohub: (ip: string) => request<VideohubReading>('POST', '/api/devices/videohub/read', { ip }),
  writeAtem: (ip: string, ports: AtemNameWrite[]) => request<AtemReading>('POST', '/api/devices/atem/write', { ip, ports }),
  writeVideohub: (ip: string, ports: VideohubLabelWrite[]) => request<VideohubReading>('POST', '/api/devices/videohub/write', { ip, ports }),
  exportXlsxUrl: (id: string) => `/api/projects/${id}/export.xlsx`,
  exportJsonUrl: (id: string) => `/api/projects/${id}/export.json`,
}

/** Warnings from an import, shown once when the new project opens. */
export const importNotices = new Map<string, string[]>()
