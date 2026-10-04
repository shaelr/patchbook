import { ActionMenu } from './ActionMenu.tsx'
import { confirmDialog } from './Dialogs.tsx'

interface Props {
  device: string
  /** "inputs" or "outputs" */
  list: string
  /** Default name of the first port, for the confirmation text (e.g. "Camera 1"). */
  firstDefault: string
  /** Ports in this list with a name of their own. */
  named: number
  onReset: () => void
  onClear: () => void
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** ⋯ menu in a label list's header: reset or clear that list only. */
export function ListMenu({ device, list, firstDefault, named, onReset, onClear }: Props) {
  const heading = `${device} ${capitalize(list)}` // e.g. "Videohub Outputs"
  const singular = list.replace(/s$/, '')
  const what = device === 'ATEM' ? 'names and labels' : 'labels'
  return (
    <ActionMenu
      label={`${heading} options`}
      title={heading}
      actions={[
        {
          label: 'Reset to defaults',
          onSelect: async () => {
            const ok =
              !named ||
              (await confirmDialog({
                title: `Reset ${heading}?`,
                message: `Every ${singular} goes back to its default name (${firstDefault}…). ${named} ${device === 'ATEM' ? 'name' : 'label'}${named === 1 ? '' : 's'} you entered will be replaced.`,
                confirmLabel: 'Reset',
              }))
            if (ok) onReset()
          },
        },
        {
          label: 'Clear all',
          danger: true,
          onSelect: async () => {
            const ok = await confirmDialog({
              title: `Clear ${heading}?`,
              message: `Every ${singular} ${what.replace(/s\b/g, '')} will be emptied.`,
              confirmLabel: 'Clear all',
              danger: true,
            })
            if (ok) onClear()
          },
        },
      ]}
    />
  )
}
