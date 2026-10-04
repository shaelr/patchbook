import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { z } from 'zod'
import { newProjectData, ProjectDataSchema, type ProjectData } from '@patchbook/shared'
import { parseIp, type AtemNameWrite, type AtemReading, type VideohubLabelWrite, type VideohubReading } from '@patchbook/shared'
import { readAtem, writeAtem } from './devices/atem.ts'
import { DeviceError } from './devices/errors.ts'
import { readVideohub, writeVideohub } from './devices/videohub.ts'
import type { ProjectStore } from './store.ts'
import { exportXlsx, ImportError, importXlsx } from './xlsx.ts'

export interface DeviceAccess {
  readAtem: (ip: string) => Promise<AtemReading>
  readVideohub: (ip: string) => Promise<VideohubReading>
  writeAtem: (ip: string, ports: AtemNameWrite[]) => Promise<AtemReading>
  writeVideohub: (ip: string, ports: VideohubLabelWrite[]) => Promise<VideohubReading>
}

const REAL_DEVICES: DeviceAccess = { readAtem, readVideohub, writeAtem, writeVideohub }

export interface AppOptions {
  store: ProjectStore
  /** Device access; tests pass stand-ins so no network is needed. */
  devices?: Partial<DeviceAccess>
  /** Built web UI to serve (web/dist). Skipped if missing, e.g. in development where Vite serves it. */
  webDir?: string
  logger?: boolean
}

const UpdateBody = z.object({ version: z.number().int(), data: ProjectDataSchema })
const CreateBody = z.object({ name: z.string().trim().min(1).max(120) })
const DuplicateBody = z.object({ name: z.string().trim().min(1).max(120).optional() })
const BackupSchema = z.object({ patchbook: z.literal(1), data: ProjectDataSchema })

/** Safe ASCII filename for Content-Disposition. */
function filename(name: string, ext: string): string {
  return `${name.replace(/[^\w .-]+/g, '').trim() || 'patchbook'}.${ext}`
}

const ReadBody = z.object({ ip: z.string() })
const AtemWriteBody = z.object({
  ip: z.string(),
  ports: z.array(z.object({ kind: z.enum(['in', 'aux']), n: z.number().int().positive(), long: z.string(), short: z.string() })).min(1),
})
const VideohubWriteBody = z.object({
  ip: z.string(),
  ports: z.array(z.object({ side: z.enum(['in', 'out']), n: z.number().int().positive(), label: z.string() })).min(1),
})

export function buildApp({ store, webDir, logger = false, devices: overrides = {} }: AppOptions): FastifyInstance {
  const devices: DeviceAccess = { ...REAL_DEVICES, ...overrides }
  const app = Fastify({ logger, bodyLimit: 20 * 1024 * 1024 })

  app.addContentTypeParser(
    ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid data', issues: error.issues })
    if (error instanceof ImportError) return reply.code(400).send({ error: error.message })
    if (error instanceof DeviceError) return reply.code(502).send({ error: error.message, code: error.code })
    app.log.error(error)
    const status = (error as { statusCode?: number }).statusCode ?? 500
    return reply.code(status).send({ error: status === 500 ? 'Server error' : (error as Error).message })
  })

  const getOr404 = (id: string) => {
    const project = store.get(id)
    if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 })
    return project
  }

  // Polled every few seconds by the Mac menu bar app; not worth a log line each time.
  app.get('/api/health', { logLevel: 'silent' }, async () => ({ ok: true }))

  // Device access is one connection at a time per device (ATEMs allow only a few): requests for
  // the same device queue behind each other, and simultaneous reads share a single connection.
  const queues = new Map<string, Promise<unknown>>()
  const pendingReads = new Map<string, Promise<unknown>>()
  const exclusive = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run)
    const settled = next.catch(() => {})
    queues.set(key, settled)
    void settled.then(() => queues.get(key) === settled && queues.delete(key))
    return next
  }
  const deviceKey = (kind: string, rawIp: string) => {
    const ip = parseIp(rawIp)
    if (!ip) throw Object.assign(new Error('Enter a valid IP address for the device first.'), { statusCode: 400 })
    return { ip: ip.normalized, key: `${kind}:${ip.normalized}` }
  }

  app.post<{ Params: { kind: string } }>('/api/devices/:kind/read', async (req, reply) => {
    const { kind } = req.params
    if (kind !== 'atem' && kind !== 'videohub') return reply.code(404).send({ error: 'Unknown device type' })
    const { ip, key } = deviceKey(kind, ReadBody.parse(req.body).ip)
    let read = pendingReads.get(key)
    if (!read) {
      read = exclusive<AtemReading | VideohubReading>(key, () => (kind === 'atem' ? devices.readAtem(ip) : devices.readVideohub(ip))).finally(() =>
        pendingReads.delete(key),
      )
      pendingReads.set(key, read)
    }
    return read
  })

  // Send names to a device; returns a fresh reading so the app can confirm what the device now has.
  app.post<{ Params: { kind: string } }>('/api/devices/:kind/write', async (req, reply) => {
    const { kind } = req.params
    if (kind === 'atem') {
      const body = AtemWriteBody.parse(req.body)
      const { ip, key } = deviceKey(kind, body.ip)
      return exclusive(key, () => devices.writeAtem(ip, body.ports))
    }
    if (kind === 'videohub') {
      const body = VideohubWriteBody.parse(req.body)
      const { ip, key } = deviceKey(kind, body.ip)
      return exclusive(key, () => devices.writeVideohub(ip, body.ports))
    }
    return reply.code(404).send({ error: 'Unknown device type' })
  })

  app.get('/api/projects', async () => store.list())

  app.post('/api/projects', async (req, reply) => {
    const { name } = CreateBody.parse(req.body)
    return reply.code(201).send(store.create(newProjectData(name)))
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => getOr404(req.params.id))

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const { version, data } = UpdateBody.parse(req.body)
    const result = store.update(req.params.id, data, version)
    if (result.ok) return result.project
    if (result.reason === 'not-found') return reply.code(404).send({ error: 'Project not found' })
    return reply.code(409).send({ error: 'Project was changed elsewhere', current: result.current })
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!store.delete(req.params.id)) return reply.code(404).send({ error: 'Project not found' })
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/api/projects/:id/duplicate', async (req, reply) => {
    const source = getOr404(req.params.id)
    const { name } = DuplicateBody.parse(req.body ?? {})
    const data: ProjectData = { ...structuredClone(source.data), name: name ?? `${source.data.name} copy` }
    return reply.code(201).send(store.create(data))
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/export.xlsx', async (req, reply) => {
    const { data } = getOr404(req.params.id)
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename(data.name, 'xlsx')}"`)
      .send(await exportXlsx(data))
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/export.json', async (req, reply) => {
    const { data } = getOr404(req.params.id)
    return reply
      .header('Content-Disposition', `attachment; filename="${filename(data.name, 'patchbook.json')}"`)
      .send({ patchbook: 1, exportedAt: new Date().toISOString(), data })
  })

  app.post<{ Querystring: { name?: string } }>('/api/import/xlsx', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'Send the .xlsx file as the request body.' })
    const name = req.query.name?.replace(/\.xlsx$/i, '').trim() || 'Imported project'
    const { data, warnings } = await importXlsx(req.body, name)
    return reply.code(201).send({ project: store.create(data), warnings })
  })

  app.post('/api/import/json', async (req, reply) => {
    const { data } = BackupSchema.parse(req.body)
    return reply.code(201).send({ project: store.create(data), warnings: [] })
  })

  if (webDir && existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not found' })
    })
  }

  return app
}
