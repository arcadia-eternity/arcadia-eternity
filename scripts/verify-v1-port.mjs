import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { resolve, dirname } from 'node:path'
const source = 'c086289812885e7a4903b181e2b8989e201452b8'
const manifestPath = 'docs/v4/v1-port-provenance.json'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const core = JSON.parse(await readFile('docs/v4/v1-import-graph.json', 'utf8'))
const extra = JSON.parse(await readFile('docs/v4/v1-extra-source-map.json', 'utf8'))
const mapping = {
  ...Object.fromEntries(Object.keys(core).map(p => [`packages/battle/src/${p}`, `packages/battle/src/v4/${p}`])),
  ...extra,
}
if (process.argv.includes('--refresh')) {
  const files = []
  for (const [original, destination] of Object.entries(mapping)) {
    const bytes = execFileSync('git', ['show', `${source}:${original}`])
    const imported = await readFile(destination)
    files.push({
      original,
      destination,
      sourceBlob: execFileSync('git', ['rev-parse', `${source}:${original}`], { encoding: 'utf8' }).trim(),
      sourceSha256: digest(bytes),
      portedSha256: digest(imported),
      changed: !bytes.equals(imported),
    })
  }
  await writeFile(manifestPath, JSON.stringify({ source, coreFiles: Object.keys(core).length, files }, null, 2) + '\n')
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert.equal(manifest.source, source)
assert.equal(manifest.coreFiles, 42)
assert.deepEqual(
  manifest.files.map(f => [f.original, f.destination]),
  Object.entries(mapping),
)
for (const entry of manifest.files)
  assert.equal(
    digest(await readFile(entry.destination)),
    entry.portedSha256,
    `Unreviewed change or incomplete port: ${entry.destination}; review the source diff before refreshing provenance`,
  )
async function walk(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}
const packageJson = JSON.parse(await readFile('packages/battle/package.json', 'utf8'))
const dependencies = new Set(Object.keys(packageJson.dependencies))
const external = new Set()
const allowed = new Set([
  '@arcadia-eternity/const',
  'jsondiffpatch',
  'mitt',
  'nanoid',
  'zod',
  'zod-validation-error',
])
for (const path of (await walk('packages/battle/src/v4')).filter(p => p.endsWith('.ts'))) {
  const text = await readFile(path, 'utf8')
  for (const [, id] of text.matchAll(/(?:from\s*|import\()['"]([^'"\n]+)['"]/g)) {
    if (id.startsWith('.')) {
      const target = resolve(dirname(path), id.replace(/\.js$/, ''))
      let found = false
      for (const candidate of [target, `${target}.ts`, `${target}/index.ts`]) {
        try {
          await readFile(candidate)
          found = true
          break
        } catch {
          /* Try the next TS resolution. */
        }
      }
      assert.ok(found, `Missing internal dependency ${id} from ${path}`)
    } else {
      const pkg = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]
      assert.ok(dependencies.has(pkg) && allowed.has(pkg), `Undeclared or forbidden dependency ${id} from ${path}`)
      external.add(pkg)
    }
  }
}
console.log(
  JSON.stringify({
    source,
    coreFiles: 42,
    mappedFiles: manifest.files.length,
    byteIdentical: manifest.files.filter(f => !f.changed).length,
    modified: manifest.files.filter(f => f.changed).length,
    external: [...external].sort(),
  }),
)
