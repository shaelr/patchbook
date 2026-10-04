import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Where projects live: PATCHBOOK_DATA if set; otherwise, on a Mac, the standard per-user app data
 * folder (~/Library/Application Support/Patchbook); elsewhere (the Pi) the project's data folder.
 */
export function defaultDataDir(projectRoot: string, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Patchbook')
  return path.join(projectRoot, 'data')
}

/**
 * One-time move from the old location (the project's data folder) to the new one. Uses SQLite's
 * VACUUM INTO, which makes a consistent copy even if another server still has the old file open
 * (including changes not yet merged from its write-ahead log). The old files are kept, renamed
 * with ".moved", as a backup. Returns a message when something was moved.
 */
export function moveLegacyData(fromDir: string, toDir: string): string | null {
  const legacy = path.join(fromDir, 'patchbook.db')
  const target = path.join(toDir, 'patchbook.db')
  if (path.resolve(fromDir) === path.resolve(toDir) || !existsSync(legacy) || existsSync(target)) return null
  mkdirSync(toDir, { recursive: true })
  const db = new DatabaseSync(legacy)
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, `${legacy}${suffix}.moved`)
  }
  return `Moved projects from ${legacy} to ${target} (the old file is kept as patchbook.db.moved).`
}
