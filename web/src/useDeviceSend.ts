import { useCallback, useState } from 'react'
import type { WritePlan } from '@patchbook/shared'
import { alertDialog, confirmDialog } from './components/Dialogs.tsx'

interface Options<P, R> {
  kind: 'ATEM' | 'Videohub'
  /** "name" for the ATEM (Name + Label), "label" for the Videohub. */
  unit: 'name' | 'label'
  write: (ip: string, ports: P[]) => Promise<R>
  /** The device's fresh state after a write, to refresh the comparison. */
  onReading: (reading: R) => void
  /** Previous device values that can be written back on undo (e.g. the ATEM can't take an empty Name). */
  restorable?: (port: P) => boolean
}

/** Send project names to a device: check, confirm, write, refresh, and offer undo for a few seconds. */
export function useDeviceSend<P, R>({ kind, unit, write, onReading, restorable = () => true }: Options<P, R>) {
  const [sending, setSending] = useState(false)
  const [undo, setUndo] = useState<{ ip: string; ports: P[]; message: string } | null>(null)
  const plural = (n: number) => `${n} ${unit}${n === 1 ? '' : 's'}`

  const send = async (ip: string, plan: WritePlan<P>) => {
    if (plan.problems.length) {
      await alertDialog({
        title: `Can't send these ${unit}s yet`,
        message: `${plan.problems.join('\n')}\n\nFix them in the project, then send again.`,
      })
      return
    }
    if (!plan.ports.length) {
      await alertDialog({
        title: 'Nothing to send',
        message: `The selected ports already match the ${kind}, or aren't set in the project (so the ${kind} keeps its ${unit}s).`,
      })
      return
    }
    const ok = await confirmDialog({
      title: `Send ${plural(plan.ports.length)} to the ${kind}?`,
      message: `The ${kind} at ${ip} will switch to the project's ${unit}s on these ports straight away${kind === 'ATEM' ? ': panels, multiviews and ATEM Software Control update immediately' : ''}.`,
      confirmLabel: `Send to ${kind}`,
    })
    if (!ok) return
    setSending(true)
    try {
      onReading(await write(ip, plan.ports))
      setUndo({ ip, ports: plan.undo.filter(restorable), message: `Sent ${plural(plan.ports.length)} to the ${kind}` })
    } catch (error) {
      await alertDialog({ title: `Not sent to the ${kind}`, message: (error as Error).message })
    } finally {
      setSending(false)
    }
  }

  const undoSend = async () => {
    const last = undo
    setUndo(null)
    if (!last?.ports.length) return
    setSending(true)
    try {
      onReading(await write(last.ip, last.ports))
    } catch (error) {
      await alertDialog({ title: `Couldn't undo on the ${kind}`, message: (error as Error).message })
    } finally {
      setSending(false)
    }
  }

  const dismissUndo = useCallback(() => setUndo(null), [])
  return { sending, send, undo, undoSend, dismissUndo }
}
