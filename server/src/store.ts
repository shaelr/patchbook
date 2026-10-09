import { DatabaseSync } from 'node:sqlite'
import { newId, ProjectDataSchema, upgradeProjectData, type Project, type ProjectData, type ProjectSummary } from '@patchbook/shared'

interface Row {
  id: string
  version: number
  created_at: string
  updated_at: string
  data: string
}

export type UpdateResult = { ok: true; project: Project } | { ok: false; reason: 'not-found' } | { ok: false; reason: 'conflict'; current: Project }

/** Projects stored as JSON documents in SQLite, with a version number for optimistic concurrency. */
export class ProjectStore {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `)
  }

  list(): ProjectSummary[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as unknown as Row[]
    return rows.map((row) => {
      const { id, updatedAt, data } = toProject(row)
      return {
        id,
        name: data.name,
        updatedAt,
        atemModel: data.atem?.model ?? null,
        videohubModel: data.videohub?.model ?? null,
        networkCount: data.network.length,
        subnet: data.subnet,
      }
    })
  }

  get(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Row | undefined
    return row ? toProject(row) : null
  }

  create(data: ProjectData): Project {
    const now = new Date().toISOString()
    const project: Project = { id: newId(), version: 1, createdAt: now, updatedAt: now, data }
    this.db
      .prepare('INSERT INTO projects (id, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)')
      .run(project.id, project.version, now, now, JSON.stringify(data))
    return project
  }

  update(id: string, data: ProjectData, expectedVersion: number): UpdateResult {
    const now = new Date().toISOString()
    const result = this.db
      .prepare('UPDATE projects SET data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(JSON.stringify(data), now, id, expectedVersion)
    const current = this.get(id)
    if (!current) return { ok: false, reason: 'not-found' }
    if (result.changes === 0) return { ok: false, reason: 'conflict', current }
    return { ok: true, project: current }
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
  }

  close(): void {
    this.db.close()
  }
}

function toProject(row: Row): Project {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Parsing fills defaults for fields added since the project was saved.
    data: upgradeProjectData(ProjectDataSchema.parse(JSON.parse(row.data))),
  }
}
