import type { KeyboardEvent } from 'react'

/**
 * Spreadsheet-style movement for label grids. Cells carry data-grid / data-row / data-col;
 * Enter or ↓ moves down a row, Shift+Enter or ↑ moves up. Tab moves across natively.
 */
export function gridKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
  const { grid, row, col } = e.currentTarget.dataset
  if (!grid || row === undefined || !col) return
  let step = 0
  if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) step = 1
  else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) step = -1
  if (!step) return
  e.preventDefault()
  const next = document.querySelector<HTMLInputElement>(
    `input[data-grid="${grid}"][data-row="${Number(row) + step}"][data-col="${col}"]`,
  )
  if (next) {
    next.focus()
    next.select()
  } else if (e.key === 'Enter') {
    e.currentTarget.blur()
  }
}

export function cellProps(grid: string, row: number, col: string) {
  return { 'data-grid': grid, 'data-row': row, 'data-col': col, onKeyDown: gridKeyDown, autoComplete: 'off', spellCheck: false }
}
