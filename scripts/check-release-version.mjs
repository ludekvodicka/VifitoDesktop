import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error(`Invalid release version: ${JSON.stringify(version)}`)

// pnpm forwards a bare `--` separator to the script, npm swallows it; accept both call styles.
const argument = process.argv.slice(2).filter((value) => value !== '--')[0]
const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
const tag = argument ?? environmentTag
if (tag && tag !== `v${version}`) throw new Error(`Tag ${JSON.stringify(tag)} does not match package version v${version}`)
console.log(`release version OK: ${version}${tag ? ` (${tag})` : ''}`)
