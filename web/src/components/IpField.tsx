import { IP_ISSUE_TEXT, parseIp, type IpIssue } from '@patchbook/shared'

interface Props {
  value: string
  issues: IpIssue[]
  onChange: (ip: string) => void
  inputProps?: Record<string, unknown>
  placeholder?: string
}

const SEVERE: IpIssue[] = ['invalid', 'duplicate', 'reserved']

export function IpField({ value, issues, onChange, inputProps, placeholder = '—' }: Props) {
  const severe = issues.some((i) => SEVERE.includes(i))
  const parsed = parseIp(value)
  return (
    <div className="ip-field">
      <input
        className={`mono ${severe ? 'is-error' : issues.length ? 'is-warn' : ''}`}
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        aria-invalid={severe}
        {...inputProps}
      />
      {issues.length > 0 && (
        <div className={`field-note ${severe ? 'error' : 'warn'}`}>
          {issues.map((i) => IP_ISSUE_TEXT[i]).join(' · ')}
          {issues.includes('leading-zero') && parsed && (
            <button type="button" className="link" onClick={() => onChange(parsed.normalized)}>
              Fix
            </button>
          )}
        </div>
      )}
    </div>
  )
}
