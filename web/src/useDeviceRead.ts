import { useCallback, useRef, useState } from 'react'
import type { ReadState } from './components/CompareView.tsx'

/** Reads a device on demand and tracks reading / error / done for the compare view. */
export function useDeviceRead<R>(read: (ip: string) => Promise<R>) {
  const [state, setState] = useState<ReadState<R> | null>(null)
  const latest = useRef(0)

  const open = useCallback(
    (ip: string) => {
      const attempt = ++latest.current
      setState({ status: 'reading', ip })
      read(ip).then(
        (reading) => attempt === latest.current && setState({ status: 'done', ip, reading, at: new Date() }),
        (error: Error) => attempt === latest.current && setState({ status: 'error', ip, error: error.message }),
      )
    },
    [read],
  )

  const close = useCallback(() => {
    latest.current++
    setState(null)
  }, [])

  /** Replace the reading with a fresher one (e.g. what the device reported after a write). */
  const setReading = useCallback((reading: R) => {
    setState((s) => (s && s.status !== 'reading' ? { status: 'done', ip: s.ip, reading, at: new Date() } : s))
  }, [])

  return { state, open, close, setReading, reading: state?.status === 'done' ? state.reading : null }
}
