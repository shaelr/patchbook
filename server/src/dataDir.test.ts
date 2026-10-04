import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { newProjectData } from '@patchbook/shared'
import { defaultDataDir, moveLegacyData } from './dataDir.ts'
import { ProjectStore } from './store.ts'

describe('data folder', () => {
  test('Mac uses Application Support; the Pi keeps the project data folder', () => {
    assert.equal(defaultDataDir('/srv/patchbook', 'darwin', '/Users/me'), '/Users/me/Library/Application Support/Patchbook')
    assert.equal(defaultDataDir('/srv/patchbook', 'linux', '/home/pi'), '/srv/patchbook/data')
  })

  test('moves existing projects once, keeping the old file as a backup', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'patchbook-'))
    try {
      const from = path.join(base, 'old')
      const to = path.join(base, 'new')
      // a legacy store that is still open (like a server that hasn't been stopped yet)
      mkdirSync(from, { recursive: true })
      const legacy = new ProjectStore(path.join(from, 'patchbook.db'))
      legacy.create(newProjectData('Sample Show 2026'))
      const message = moveLegacyData(from, to)
      legacy.close()
      assert.match(message ?? '', /Moved projects/)
      assert.ok(existsSync(path.join(from, 'patchbook.db.moved')))
      const moved = new ProjectStore(path.join(to, 'patchbook.db'))
      assert.deepEqual(moved.list().map((p) => p.name), ['Sample Show 2026'])
      moved.close()
      assert.equal(moveLegacyData(from, to), null, 'only once')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
