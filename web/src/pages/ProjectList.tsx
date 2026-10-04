import { useEffect, useRef, useState } from 'react'
import { ATEM_MODELS, CUSTOM_MODEL, VIDEOHUB_MODELS, type ProjectSummary } from '@patchbook/shared'
import { api, importNotices, type ImportResponse } from '../api.ts'
import { ActionMenu } from '../components/ActionMenu.tsx'
import { confirmDialog, promptDialog } from '../components/Dialogs.tsx'
import { href, navigate } from '../router.ts'
import { relativeTime } from '../time.ts'

function modelName(id: string | null, models: Array<{ id: string; label: string }>, custom: string): string | null {
  if (!id) return null
  if (id === CUSTOM_MODEL) return custom
  return models.find((m) => m.id === id)?.label.replace(/^ATEM /, '') ?? id
}

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const xlsxInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)

  const load = () =>
    api.list().then(setProjects, (e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const create = () =>
    run(async () => {
      if (!name.trim()) return
      const project = await api.create(name.trim())
      navigate(href.project(project.id))
    })

  const duplicate = (p: ProjectSummary) =>
    run(async () => {
      const copyName = await promptDialog({
        title: 'Duplicate project',
        inputLabel: 'Name for the copy',
        defaultValue: `${p.name} copy`,
        confirmLabel: 'Duplicate',
      })
      if (!copyName?.trim()) return
      const copy = await api.duplicate(p.id, copyName.trim())
      navigate(href.project(copy.id))
    })

  const remove = (p: ProjectSummary) =>
    run(async () => {
      const ok = await confirmDialog({
        title: `Delete “${p.name}”?`,
        message: "This can't be undone. Download a backup first if you might need it.",
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      await api.remove(p.id)
      await load()
    })

  const openImported = ({ project, warnings }: ImportResponse) => {
    if (warnings.length) importNotices.set(project.id, warnings)
    navigate(href.project(project.id))
  }

  const onFile = (kind: 'xlsx' | 'json') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void run(async () => openImported(await (kind === 'xlsx' ? api.importXlsx(file) : api.importJson(file))))
  }

  return (
    <div className="page">
      <div className="sticky-head">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <h1>Patchbook</h1>
        </div>
        <div className="phone-only header-buttons">
          <button type="button" className="primary icon-text" aria-label="New project" onClick={() => setCreating(true)}>
            +
          </button>
          <ActionMenu
            label="More"
            title="Projects"
            actions={[
              { label: 'Import Excel', onSelect: () => xlsxInput.current?.click() },
              { label: 'Restore backup', onSelect: () => jsonInput.current?.click() },
            ]}
          />
        </div>
        <div className="actions desktop-only">
          <button type="button" className="ghost" onClick={() => jsonInput.current?.click()}>
            Restore backup
          </button>
          <button type="button" onClick={() => xlsxInput.current?.click()}>
            Import Excel
          </button>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New project
          </button>
        </div>
        <input ref={xlsxInput} type="file" accept=".xlsx" hidden onChange={onFile('xlsx')} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={onFile('json')} />
      </header>
      </div>

      <main className="content">
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {creating && (
          <form
            className="card new-project"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <label className="field grow">
              <span>Project name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="primary" disabled={!name.trim()}>
              Create
            </button>
            <button type="button" className="ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </form>
        )}

        {projects === null && !error && <p className="muted">Loading…</p>}

        {projects?.length === 0 && !creating && (
          <section className="card empty">
            <h3>No projects yet</h3>
            <p className="muted">Start a new project, or import one of your existing show spreadsheets.</p>
            <div className="row">
              <button type="button" className="primary" onClick={() => setCreating(true)}>
                New project
              </button>
              <button type="button" onClick={() => xlsxInput.current?.click()}>
                Import Excel
              </button>
            </div>
          </section>
        )}

        {projects && projects.length > 0 && (
          <ul className="project-list">
            {projects.map((p) => {
              const gear = [modelName(p.atemModel, ATEM_MODELS, 'Custom ATEM'), modelName(p.videohubModel, VIDEOHUB_MODELS, 'Custom Videohub')]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={p.id} className="card project-row">
                  <a className="project-link" href={href.project(p.id)}>
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {gear || 'No devices'}
                      {p.networkCount ? ` · ${p.networkCount} network device${p.networkCount === 1 ? '' : 's'}` : ''}
                      <span className="phone-only"> · {relativeTime(p.updatedAt)}</span>
                    </span>
                  </a>
                  <span className="muted updated" title={new Date(p.updatedAt).toLocaleString()}>
                    {relativeTime(p.updatedAt)}
                  </span>
                  <div className="row-actions desktop-only">
                    <button type="button" className="ghost" onClick={() => duplicate(p)}>
                      Duplicate
                    </button>
                    <a className="button ghost" href={api.exportJsonUrl(p.id)} download>
                      Backup
                    </a>
                    <button type="button" className="ghost danger" onClick={() => remove(p)}>
                      Delete
                    </button>
                  </div>
                  <ActionMenu
                    className="phone-only"
                    label={`Actions for ${p.name}`}
                    title={p.name}
                    actions={[
                      { label: 'Duplicate', onSelect: () => duplicate(p) },
                      { label: 'Download backup', href: api.exportJsonUrl(p.id), download: true },
                      { label: 'Delete', danger: true, onSelect: () => remove(p) },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
