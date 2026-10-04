import { useState } from 'react'
import { allProjectIps, atemLabelIssues, ipIssues, type ProjectData } from '@patchbook/shared'
import { api, importNotices } from '../api.ts'
import { ActionMenu } from '../components/ActionMenu.tsx'
import { href, TABS, type Tab } from '../router.ts'
import { AtemTab } from '../tabs/AtemTab.tsx'
import { NetworkTab } from '../tabs/NetworkTab.tsx'
import { SettingsTab } from '../tabs/SettingsTab.tsx'
import { VideohubTab } from '../tabs/VideohubTab.tsx'
import { useProject, type SaveStatus } from '../useProject.ts'

const TAB_LABELS: Record<Tab, string> = { atem: 'ATEM', videohub: 'Videohub', network: 'Network', settings: 'Settings' }

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Offline — retrying',
  invalid: 'Not saved — fix errors',
  conflict: 'Not saved — conflict',
}

/** Problem counts shown as badges on the tabs. */
function tabIssues(data: ProjectData): Partial<Record<Tab, number>> {
  const allIps = allProjectIps(data)
  const ipProblems = (ip: string) => (ipIssues(ip, data.subnet, allIps).length ? 1 : 0)
  const atem = data.atem
    ? [...data.atem.inputs, ...data.atem.outputs].filter((p) => atemLabelIssues(p).length).length + ipProblems(data.atem.ip)
    : 0
  const videohub = data.videohub ? ipProblems(data.videohub.ip) : 0
  const network = data.network.reduce((n, e) => n + ipProblems(e.ip), 0) + (data.atem ? ipProblems(data.atem.ip) : 0) + videohub
  return { atem, videohub, network }
}

export function ProjectView({ id, tab }: { id: string; tab: Tab }) {
  const { project, loadError, status, conflict, update, resolveConflict } = useProject(id)
  const [notices, setNotices] = useState(() => importNotices.get(id) ?? [])

  if (loadError) {
    return (
      <div className="page">
        <main className="content">
          <div className="banner error">{loadError}</div>
          <a href={href.list()}>← All projects</a>
        </main>
      </div>
    )
  }
  if (!project) return <div className="page loading muted">Loading…</div>

  const { data } = project
  const issues = tabIssues(data)

  return (
    <div className="page">
      <div className="sticky-head">
      <header className="topbar">
        <div className="brand">
          <a href={href.list()} className="back" aria-label="All projects">
            ‹
          </a>
          <h1 className="project-name">{data.name || 'Untitled'}</h1>
          <span className={`save-status ${status}`} role="status">
            {STATUS_TEXT[status]}
          </span>
        </div>
        <ActionMenu
          className="phone-only"
          label="Project actions"
          title={data.name || 'Project'}
          actions={[
            { label: 'Print / PDF', href: href.print(id), newTab: true },
            { label: 'Export Excel', href: api.exportXlsxUrl(id), download: true },
            { label: 'Download backup', href: api.exportJsonUrl(id), download: true },
          ]}
        />
        <div className="actions desktop-only">
          <a className="button ghost" href={href.print(id)} target="_blank" rel="noreferrer">
            Print
          </a>
          <a className="button ghost" href={api.exportXlsxUrl(id)} download>
            Excel
          </a>
          <a className="button ghost" href={api.exportJsonUrl(id)} download>
            Backup
          </a>
        </div>
      </header>

      <nav className="tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <a key={t} href={href.project(id, t)} className={t === tab ? 'active' : undefined} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABELS[t]}
            {t === 'atem' && data.atem && <span className="tab-dot" aria-hidden />}
            {t === 'videohub' && data.videohub && <span className="tab-dot" aria-hidden />}
            {!!issues[t] && <span className="badge" title={`${issues[t]} to check`}>{issues[t]}</span>}
          </a>
        ))}
      </nav>
      </div>

      <main className="content">
        {conflict && (
          <div className="banner warn" role="alert">
            <span>This project was changed on another device. Which version do you want to keep?</span>
            <div className="row">
              <button type="button" onClick={() => resolveConflict('theirs')}>
                Use the other version
              </button>
              <button type="button" className="primary" onClick={() => resolveConflict('mine')}>
                Keep mine
              </button>
            </div>
          </div>
        )}
        {notices.length > 0 && (
          <div className="banner info">
            <div>
              <strong>Imported. A few things to check:</strong>
              <ul>
                {notices.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                importNotices.delete(id)
                setNotices([])
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {tab === 'atem' && <AtemTab data={data} update={update} />}
        {tab === 'videohub' && <VideohubTab data={data} update={update} />}
        {tab === 'network' && <NetworkTab data={data} update={update} projectId={id} />}
        {tab === 'settings' && <SettingsTab data={data} update={update} />}
      </main>
    </div>
  )
}
