import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { projectIssues, suggestedSubnet, type IssueTarget, type ProjectData, type ProjectIssue } from '@patchbook/shared'
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

const lastTabKey = (id: string) => `patchbook.tab.${id}`

/** Where a show opens when the link names no tab: the tab you last used, else its first device. */
function openingTab(id: string, data: ProjectData): Tab {
  try {
    const saved = localStorage.getItem(lastTabKey(id))
    if (TABS.includes(saved as Tab)) return saved as Tab
  } catch {
    // Storage unavailable (private browsing): fall through.
  }
  if (data.atem) return 'atem'
  if (data.videohub) return 'videohub'
  return data.network.length ? 'network' : 'atem'
}

function issueSelector(target: IssueTarget): string {
  switch (target.kind) {
    case 'atem-port':
      return `input[data-grid="atem-${target.list}"][data-row="${target.index}"][data-col="${target.field}"]`
    case 'device-ip':
      return 'input[data-field="device-ip"]'
    case 'network-ip':
      return `input[data-grid="net"][data-key="${target.key}"]`
  }
}

/** Scroll to the field a problem is about and focus it. */
function showIssue(target: IssueTarget) {
  // Next frame: the tab may only just have switched.
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>(issueSelector(target))
    // On phones the field can be in a sheet or the other list; the top of the tab is the best we can do.
    if (!field) return window.scrollTo({ top: 0 })
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    field.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
    field.focus({ preventScroll: true })
  })
}

export function ProjectView({ id, tab }: { id: string; tab: Tab | null }) {
  const { project, loadError, status, conflict, update, resolveConflict } = useProject(id)
  const [notices, setNotices] = useState(() => importNotices.get(id) ?? [])
  // Pinned table headings sit just under the header, whose height changes when it wraps.
  const headRef = useRef<HTMLDivElement>(null)
  const loaded = project !== null
  useLayoutEffect(() => {
    const head = headRef.current
    if (!head) return
    const setHeight = () => document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`)
    setHeight()
    const observer = new ResizeObserver(setHeight)
    observer.observe(head)
    return () => observer.disconnect()
  }, [loaded])

  // Remember the tab per show, and open a show without a tab in its link where you left off.
  useEffect(() => {
    if (!tab) return
    try {
      localStorage.setItem(lastTabKey(id), tab)
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }, [id, tab])
  useEffect(() => {
    if (!tab && project) window.location.replace(href.project(id, openingTab(id, project.data)))
  }, [id, tab, project])

  // The tab whose problem list is open (from clicking its badge).
  const [checking, setChecking] = useState<Tab | null>(null)

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
  const allIssues = projectIssues(data)
  const issuesOn = (t: Tab): ProjectIssue[] => allIssues.filter((i) => i.tab === t)
  const listed = checking && checking === tab ? issuesOn(checking) : []
  const subnetSuggestion = suggestedSubnet(data)

  return (
    <div className="page">
      <div className="sticky-head" ref={headRef}>
      <header className="topbar project-bar">
        <div className="brand">
          <a href={href.list()} className="back" aria-label="All projects">
            ‹
          </a>
          <h1 className="project-name">{data.name || 'Untitled'}</h1>
          <span className={`save-status ${status}`} role="status">
            {STATUS_TEXT[status]}
          </span>
        </div>
        <nav className="tabs" aria-label="Project sections">
          {TABS.map((t) => (
            <a
              key={t}
              href={href.project(id, t)}
              className={t === tab ? 'active' : undefined}
              aria-current={t === tab ? 'page' : undefined}
              // The badge opens the list of problems on that tab (the link still switches to it).
              onClick={(e) => (e.target as Element).closest('.badge') && setChecking(t)}
            >
              {TAB_LABELS[t]}
              {t === 'atem' && data.atem && <span className="tab-dot" aria-hidden />}
              {t === 'videohub' && data.videohub && <span className="tab-dot" aria-hidden />}
              {issuesOn(t).length > 0 && (
                <span className="badge" title="Show what to check">
                  {issuesOn(t).length}
                </span>
              )}
            </a>
          ))}
        </nav>
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
        {subnetSuggestion && (
          <div className="banner info">
            <span>
              Every device in this show is on <strong className="figures">{subnetSuggestion}</strong>, but the show's subnet is{' '}
              <span className="figures">{data.subnet}</span>.
            </span>
            <button type="button" className="primary" onClick={() => update((d) => (d.subnet = subnetSuggestion))}>
              Use {subnetSuggestion}
            </button>
          </div>
        )}
        {listed.length > 0 && (
          <section className="card issues" aria-label="To check">
            <header className="card-head">
              <h3>
                {listed.length} to check
              </h3>
              <button type="button" className="ghost" onClick={() => setChecking(null)}>
                Done
              </button>
            </header>
            <ul>
              {listed.map((issue, i) => (
                <li key={i}>
                  <button type="button" className="issue" onClick={() => showIssue(issue.target)}>
                    {issue.text}
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
