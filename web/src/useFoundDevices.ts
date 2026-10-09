import { useEffect, useState } from 'react'
import type { FoundDevice } from '@patchbook/shared'
import { api } from './api.ts'

/** Blackmagic devices announced on the network, refreshed every few seconds while in use. */
export function useFoundDevices(kind?: FoundDevice['kind']): FoundDevice[] {
  const [devices, setDevices] = useState<FoundDevice[]>([])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = () =>
      api.foundDevices().then(
        (found) => !stopped && setDevices(found),
        // Discovery is a convenience: if it fails, the list stays as it was and typing an IP still works.
        () => {},
      ).finally(() => {
        if (!stopped) timer = setTimeout(poll, 3000)
      })
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])
  return kind ? devices.filter((d) => d.kind === kind) : devices
}
