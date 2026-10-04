import { useCallback, useEffect, useRef, useState } from 'react'
import { ProjectDataSchema, type Project, type ProjectData } from '@patchbook/shared'
import { api, ConflictError } from './api.ts'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'invalid' | 'conflict'

const SAVE_DELAY_MS = 600
const RETRY_DELAY_MS = 3000

/**
 * Loads a project and autosaves edits. Saves carry the version they were based on;
 * if another device saved in between, the server answers 409 and the user picks a side.
 */
export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<Project | null>(null)

  const current = useRef<Project | null>(null)
  const dirty = useRef(false)
  const saving = useRef(false)
  const blocked = useRef(false) // true while a conflict is unresolved
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = (p: Project) => {
    current.current = p
    setProject(p)
  }

  const flush = useCallback(async (keepalive = false) => {
    clearTimeout(timer.current)
    const sent = current.current
    if (!sent || !dirty.current || saving.current || blocked.current) return
    if (!ProjectDataSchema.safeParse(sent.data).success) {
      setStatus('invalid') // e.g. empty project name; saves resume once it's fixed
      return
    }
    saving.current = true
    dirty.current = false
    setStatus('saving')
    try {
      const saved = await api.save(sent.id, sent.version, sent.data, keepalive)
      // Keep any edits made while the request was in flight; take the new version.
      show({ ...current.current!, version: saved.version, updatedAt: saved.updatedAt })
      setStatus(dirty.current ? 'pending' : 'saved')
    } catch (error) {
      dirty.current = true
      if (error instanceof ConflictError) {
        blocked.current = true
        setConflict(error.current)
        setStatus('conflict')
      } else {
        setStatus('error')
        timer.current = setTimeout(() => void flush(), RETRY_DELAY_MS)
      }
    } finally {
      saving.current = false
    }
    if (dirty.current && !blocked.current) schedule()
  }, [])

  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }, [flush])

  /** Apply an edit. The recipe mutates a copy of the project data. */
  const update = useCallback(
    (recipe: (data: ProjectData) => void) => {
      const cur = current.current
      if (!cur) return
      const data = structuredClone(cur.data)
      recipe(data)
      show({ ...cur, data })
      dirty.current = true
      if (!blocked.current) {
        setStatus('pending')
        schedule()
      }
    },
    [schedule],
  )

  const resolveConflict = useCallback(
    (keep: 'mine' | 'theirs') => {
      const theirs = conflict
      if (!theirs || !current.current) return
      blocked.current = false
      setConflict(null)
      if (keep === 'theirs') {
        dirty.current = false
        show(theirs)
        setStatus('saved')
      } else {
        show({ ...current.current, version: theirs.version })
        dirty.current = true
        void flush()
      }
    },
    [conflict, flush],
  )

  useEffect(() => {
    let cancelled = false
    setProject(null)
    setLoadError(null)
    api
      .get(id)
      .then((p) => !cancelled && show(p))
      .catch((e: Error) => !cancelled && setLoadError(e.message))

    // Save before the page is hidden; pick up other devices' changes when it comes back.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush(true)
      else if (!dirty.current && !saving.current && current.current) {
        api.get(id).then((p) => {
          if (!dirty.current && !saving.current && p.version !== current.current?.version) show(p)
        }, () => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void flush(true)
    }
  }, [id, flush])

  return { project, loadError, status, conflict, update, resolveConflict }
}

export type ProjectUpdate = ReturnType<typeof useProject>['update']
