import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { validateSupplementalProvenance } from './desktop-license-provenance.mjs'

const commit = 'a'.repeat(40)
const digest = 'b'.repeat(64)
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`
const document = entries => ({ format: 'arcadia.desktop-license-supplemental', version: 1, entries })
function fixture() {
  return {
    name: '@example/native',
    version: '1.2.3',
    declaredLicense: 'MIT',
    status: 'verified',
    registry: { url: 'https://registry.npmjs.org/%40example%2Fnative/1.2.3', integrity, gitHead: commit },
    files: [
      {
        file: 'license.txt',
        sha256: digest,
        license: 'MIT',
        kind: 'license',
        sourceUrl: `https://raw.githubusercontent.com/example/native/${commit}/LICENSE`,
        sourceCommit: commit,
        sourcePath: 'LICENSE',
      },
    ],
  }
}
const readProvenance = async () =>
  JSON.parse(
    await readFile(new URL('./desktop-license-reference/supplemental/provenance.json', import.meta.url), 'utf8'),
  )

test('validates current reviewed sources and actual stored byte digests', async () => {
  const current = await readProvenance()
  const records = validateSupplementalProvenance(current)
  assert.equal(records.size, current.entries.length)
  for (const entry of records.values())
    for (const file of entry.files) {
      const bytes = await readFile(new URL(`./desktop-license-reference/supplemental/${file.file}`, import.meta.url))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    }
  assert.equal(records.get(JSON.stringify(['@npmcli/redact', '4.0.0'])).status, 'unresolved')
})

test('rejects registry identity changes, malformed integrity and ambiguous URLs', () => {
  for (const change of [
    entry => {
      entry.name = '@other/native'
    },
    entry => {
      entry.version = '1.2.4'
    },
    entry => {
      entry.registry.url = 'https://registry.example.test/%40example%2Fnative/1.2.3'
    },
    entry => {
      entry.registry.url += '?token=secret'
    },
    entry => {
      entry.registry.url += '#fragment'
    },
    entry => {
      entry.registry.url = 'https://user:secret@registry.npmjs.org/%40example%2Fnative/1.2.3'
    },
    entry => {
      entry.registry.integrity = `sha512-${'A'.repeat(85)}B==`
    },
    entry => {
      entry.registry.integrity = `sha256-${Buffer.alloc(32).toString('base64')}`
    },
    entry => {
      entry.registry.gitHead = 'main'
    },
    entry => {
      entry.registry.gitHead = 'd'.repeat(40)
    },
    entry => {
      entry.registry.attestationUrl = 'https://registry.npmjs.org/-/npm/v1/attestations/@other/native@1.2.3'
    },
  ]) {
    const entry = fixture()
    change(entry)
    assert.throws(() => validateSupplementalProvenance(document([entry])), /Invalid supplemental license provenance/)
  }
})

test('requires immutable consistent source URLs and contained local file names', () => {
  for (const change of [
    file => {
      file.sourceUrl = 'https://'
    },
    file => {
      file.sourceUrl += '?download=1'
    },
    file => {
      file.sourceUrl += '#license'
    },
    file => {
      file.sourceUrl = file.sourceUrl.replace('https://', 'https://user:secret@')
    },
    file => {
      file.sourceUrl = file.sourceUrl.replace(commit, 'main')
    },
    file => {
      file.sourceCommit = 'c'.repeat(40)
    },
    file => {
      file.sourcePath = 'COPYING'
    },
    file => {
      delete file.sourceCommit
    },
    file => {
      file.sourceUrl = 'https://example.test/LICENSE'
    },
    file => {
      file.file = '../license.txt'
    },
    file => {
      file.file = '/license.txt'
    },
    file => {
      file.file = 'C:\\license.txt'
    },
    file => {
      file.file = 'a/../../license.txt'
    },
    file => {
      file.file = 'a/%2e%2e/license.txt'
    },
    file => {
      file.sha256 = 'wrong'
    },
  ]) {
    const entry = fixture()
    change(entry.files[0])
    assert.throws(() => validateSupplementalProvenance(document([entry])), /Invalid supplemental license provenance/)
  }
})

test('rejects duplicate identities, unknown schema and unproved verified status', () => {
  assert.throws(() => validateSupplementalProvenance(document([fixture(), fixture()])), /duplicate package identity/)
  for (const change of [
    entry => {
      entry.extra = true
    },
    entry => {
      entry.registry.extra = true
    },
    entry => {
      entry.files[0].extra = true
    },
    entry => {
      entry.status = 'approved'
    },
    entry => {
      entry.files = []
    },
    entry => {
      entry.files[0].kind = 'declaration'
    },
    entry => {
      entry.declaredLicense = 'ISC'
    },
    entry => {
      entry.files.push({ ...entry.files[0] })
    },
  ]) {
    const entry = fixture()
    change(entry)
    assert.throws(() => validateSupplementalProvenance(document([entry])), /Invalid supplemental license provenance/)
  }
  const unresolved = fixture()
  unresolved.status = 'unresolved'
  unresolved.declaredLicense = 'ISC'
  assert.equal(
    validateSupplementalProvenance(document([unresolved])).size,
    1,
    'conflicting evidence remains representable as unresolved',
  )
})

test('curated grants retain their required referenced terms and original attribution', async () => {
  const current = await readProvenance()
  for (const name of ['natural-compare', 'spdx-exceptions', 'spdx-license-ids', '@humanfs/types', 'qrcode-terminal']) {
    const original = current.entries.find(entry => entry.name === name)
    assert.ok(original)
    assert.equal(validateSupplementalProvenance(document([original])).size, 1)
    const required =
      name === 'natural-compare'
        ? original.files.filter(file => file.kind === 'declaration' || file.sourceUrl.startsWith('https://lauri'))
        : name === 'qrcode-terminal'
          ? original.files
          : original.files.filter(
              file =>
                file.kind === 'referenced-terms' ||
                (name === '@humanfs/types' && file.sourcePath?.endsWith('hfs-types.ts')),
            )
    for (const omitted of required) {
      const changed = structuredClone(original)
      changed.files = changed.files.filter(file => file.file !== omitted.file)
      assert.throws(
        () => validateSupplementalProvenance(document([changed])),
        /Invalid supplemental license provenance/,
        `${name}: ${omitted.file}`,
      )
    }
  }
  const unrelated = fixture()
  unrelated.files[0] = structuredClone(
    current.entries
      .find(entry => entry.name === 'natural-compare')
      .files.find(file => file.sourceUrl.startsWith('https://lauri')),
  )
  assert.throws(() => validateSupplementalProvenance(document([unrelated])), /external terms do not belong/)
})

test('source-equivalence evidence permits only the recorded version difference', async () => {
  const entry = (await readProvenance()).entries.find(entry => entry.name === 'keyv')
  assert.ok(entry.sourceMatch)
  for (const change of [
    item => {
      item.sourceMatch.archiveIntegrityVerified = false
    },
    item => {
      item.sourceMatch.commit = 'd'.repeat(40)
    },
    item => {
      item.sourceMatch.files = []
    },
    item => {
      item.sourceMatch.files[0].publishedPath = '../outside'
    },
    item => {
      item.sourceMatch.manifestDifference.dependencies = {}
    },
    item => {
      item.sourceMatch.manifestDifference.version.published = '4.5.5'
    },
  ]) {
    const changed = structuredClone(entry)
    change(changed)
    assert.throws(() => validateSupplementalProvenance(document([changed])), /Invalid supplemental license provenance/)
  }
})

test('unresolved audit evidence cannot become approval or carry unrelated URLs and digests', async () => {
  const entries = (await readProvenance()).entries
  const agent = entries.find(entry => entry.name === '@npmcli/agent')
  for (const change of [
    item => {
      item.status = 'verified'
    },
    item => {
      item.sourceAudit.treeUrl += '&token=secret'
    },
    item => {
      item.sourceAudit.treeUrl = item.sourceAudit.treeUrl.replace('api.github.com', 'example.test')
    },
    item => {
      item.sourceAudit.treeUrl = item.sourceAudit.treeUrl.replace(item.sourceAudit.commit, 'e'.repeat(40))
    },
    item => {
      item.sourceAudit.excludedLicenseFiles[0].path = 'unlisted/LICENSE'
    },
  ]) {
    const changed = structuredClone(agent)
    change(changed)
    assert.throws(() => validateSupplementalProvenance(document([changed])), /Invalid supplemental license provenance/)
  }
  const redact = structuredClone(entries.find(entry => entry.name === '@npmcli/redact'))
  redact.sourceAudit.sourceLicenseSha256 = 'f'.repeat(64)
  assert.throws(() => validateSupplementalProvenance(document([redact])), /audited license digest mismatch/)
})
