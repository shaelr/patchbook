import { mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { buildApp } from './app.ts'
import { defaultDataDir, moveLegacyData } from './dataDir.ts'
import { ProjectStore } from './store.ts'

const root = path.resolve(import.meta.dirname, '../..')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const dataDir = path.resolve(process.env.PATCHBOOK_DATA ?? defaultDataDir(root))

mkdirSync(dataDir, { recursive: true })
// Projects used to live in the project folder on the Mac too; bring them along once.
if (!process.env.PATCHBOOK_DATA) {
  const moved = moveLegacyData(path.join(root, 'data'), dataDir)
  if (moved) console.log(moved)
}
const store = new ProjectStore(path.join(dataDir, 'patchbook.db'))
const app = buildApp({ store, webDir: path.join(root, 'web/dist'), logger: process.env.NODE_ENV === 'production' })

await app.listen({ port, host })

const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a!.address}:${port}`)
console.log(`Patchbook server on http://localhost:${port}${lanAddresses.length ? ` (network: ${lanAddresses.join(', ')})` : ''}`)
console.log(`Data: ${dataDir}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    store.close()
    process.exit(0)
  })
}
