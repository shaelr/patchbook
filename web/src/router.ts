import { useEffect, useState } from 'react'

export const TABS = ['atem', 'videohub', 'network', 'settings'] as const
export type Tab = (typeof TABS)[number]

export type Route =
  | { page: 'list' }
  | { page: 'project'; id: string; tab: Tab }
  | { page: 'print'; id: string }

export function parseRoute(hash: string): Route {
  const [, page, id, sub] = hash.replace(/^#/, '').split('/')
  if (page === 'p' && id) {
    if (sub === 'print') return { page: 'print', id }
    return { page: 'project', id, tab: TABS.includes(sub as Tab) ? (sub as Tab) : 'atem' }
  }
  return { page: 'list' }
}

export const href = {
  list: () => '#/',
  project: (id: string, tab: Tab = 'atem') => `#/p/${id}/${tab}`,
  print: (id: string) => `#/p/${id}/print`,
}

export function navigate(to: string): void {
  window.location.hash = to
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
