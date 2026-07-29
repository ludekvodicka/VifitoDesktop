import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Sourced from the installed pnpm production tree (`pnpm licenses list --prod --json`). The app has
// no native dependencies, so the inventory is identical on every packaged platform.
const root = JSON.parse(readFileSync('package.json', 'utf8'))
const licensesByGroup = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))

const packages = new Map()
for (const [licenseKey, entries] of Object.entries(licensesByGroup)) {
  for (const entry of entries) {
    const name = entry.name
    if (!name || name === root.name) continue
    const license = entry.license ?? licenseKey
    for (const version of entry.versions ?? []) {
      if (!version || !license) throw new Error(`Missing version/license metadata for ${name}`)
      packages.set(`${name}@${version}`, license)
    }
  }
}

const direct = Object.entries(root.dependencies ?? {}).sort(([left], [right]) => left.localeCompare(right))
const groups = new Map()
for (const [identity, license] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
  const values = groups.get(license) ?? []
  values.push(identity)
  groups.set(license, values)
}

const lines = [
  '# Third-party software',
  '',
  'Vifito Desktop is MIT-licensed. Its packaged application also contains the npm runtime',
  'dependencies below, plus the Electron runtime and the Chromium engine it embeds. This inventory',
  'is generated from the installed pnpm production tree. The dependency licenses remain in force for',
  'their respective components.',
  '',
  '## Direct runtime dependencies',
  '',
  ...direct.map(([name, version]) => `- \`${name}@${version}\``),
  '',
  '## Runtime inventory by declared license',
  '',
]
for (const [license, identities] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`### ${license}`, '', ...identities.map(identity => `- \`${identity}\``), '')
}
lines.push('License identifiers are SPDX expressions from each installed package. Full license texts are',
  'retained in the installed npm packages and are available from each package source.', '')
const output = `${lines.join('\n')}\n`

if (process.argv.includes('--check')) {
  const current = readFileSync('THIRD-PARTY.md', 'utf8')
  if (current !== output) throw new Error('THIRD-PARTY.md is stale; regenerate it with "pnpm run third-party:write"')
  console.log(`third-party inventory OK: ${packages.size} runtime packages`)
} else if (process.argv.includes('--write')) writeFileSync('THIRD-PARTY.md', output)
else process.stdout.write(output)
