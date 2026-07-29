import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error('usage: pnpm run version:set -- X.Y.Z')
  process.exit(2)
}

const path = resolve('package.json')
const manifest = JSON.parse(readFileSync(path, 'utf8'))
manifest.version = version
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Vifito Desktop version -> ${version} (run "pnpm install" to update pnpm-lock.yaml)`)
