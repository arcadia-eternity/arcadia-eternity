import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { mergeDesktopReleaseManifests, releaseVersion } from './merge-desktop-release-manifests.mjs'

const commit = 'abc123'.repeat(6) + 'abcd'
const matrix = [
  { platform: 'darwin', arch: 'x64', os: 'mac', extensions: ['zip'], manifest: 'latest-mac.yml' },
  { platform: 'darwin', arch: 'arm64', os: 'mac', extensions: ['zip'], manifest: 'latest-mac.yml' },
  { platform: 'win32', arch: 'x64', os: 'win', extensions: ['exe', 'zip'], manifest: 'latest.yml' },
  { platform: 'linux', arch: 'x64', os: 'linux', extensions: ['AppImage'], manifest: 'latest-linux.yml' },
]
const sha512 = value => createHash('sha512').update(value).digest('base64')

async function fixture(t, version = '4.1.0') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-release-merge-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = join(root, 'input')
  const output = join(root, 'output')
  await mkdir(input)
  const sources = []
  const builds = []
  for (const [index, target] of matrix.entries()) {
    const source = {
      artifactId: 100 + index,
      artifactName: `desktop-release-123-1-${target.platform}-${target.arch}`,
      platform: target.platform,
      arch: target.arch,
      digest: `sha256:${String(index).repeat(64)}`,
    }
    const directory = join(input, source.artifactName)
    await mkdir(directory)
    const receipt = {
      format: 'arcadia.desktop-release-build/1',
      version,
      commit,
      platform: target.platform,
      arch: target.arch,
    }
    await writeFile(join(directory, 'desktop-build.json'), JSON.stringify(receipt))
    const assets = []
    for (const extension of target.extensions) {
      const name = `Arcadia-Eternity-${version.replaceAll('+', '-')}-${target.os}-${target.arch}.${extension}`
      const content = Buffer.from(`isolated ${target.platform}/${target.arch} ${extension} fixture\n`)
      await writeFile(join(directory, name), content)
      assets.push({ name, content })
    }
    // These sidecars must be preserved even though update YAML references the installer.
    if (target.platform !== 'linux') {
      const name = `${assets[0].name}.blockmap`
      const content = Buffer.from(`blockmap for ${assets[0].name}\n`)
      await writeFile(join(directory, name), content)
      assets.push({ name, content })
    }
    const installer = assets[0]
    const manifest = {
      version,
      files: [{ url: installer.name, sha512: sha512(installer.content), size: installer.content.length }],
      path: installer.name,
      sha512: sha512(installer.content),
      releaseDate: index === 1 ? '2026-11-05T10:05:00.000Z' : '2026-11-05T10:00:00.000Z',
      releaseName: 'Desktop integration release',
      releaseNotes: 'Keep the existing release notes.',
    }
    const manifestText = `# original ${target.platform}/${target.arch} metadata\n${YAML.stringify(manifest)}`
    await writeFile(join(directory, target.manifest), manifestText)
    sources.push(source)
    builds.push({
      ...target,
      manifestName: target.manifest,
      directory,
      source,
      receipt,
      assets,
      manifest,
      manifestText,
    })
  }
  // Artifact arrival order must not decide which legacy Mac entry is selected.
  sources.reverse()
  return { root, input, output, version, commit, sources, builds }
}

async function replaceManifest(build, update) {
  const manifest = structuredClone(build.manifest)
  update(manifest)
  await writeFile(join(build.directory, build.manifestName), YAML.stringify(manifest))
}

async function rejectBeforeOutput(f, expected) {
  await assert.rejects(mergeDesktopReleaseManifests(f), expected)
  await assert.rejects(lstat(f.output), { code: 'ENOENT' })
}

test('release versions are normalized without accepting injected or ambiguous version text', () => {
  for (const [input, expected] of [
    ['v4.1.0', '4.1.0'],
    ['4.1.0-preview.2', '4.1.0-preview.2'],
    ['4.1.0+build.7', '4.1.0+build.7'],
  ])
    assert.equal(releaseVersion(input), expected)
  for (const value of [
    undefined,
    null,
    42,
    '',
    'v',
    'vv4.1.0',
    '4.1',
    '04.1.0',
    '4.1.0-preview.01',
    '9007199254740992.1.0',
    ' 4.1.0',
    '4.1.0\nnext=value',
    '../4.1.0',
    '4.1.0$(touch marker)',
    '4.1.0; echo injected',
    `4.1.0-${'a'.repeat(129)}`,
  ])
    assert.throws(() => releaseVersion(value), /valid SemVer/, String(value))
})

test('merging preserves every binary and source ID, merges Mac x64 first, and preserves other metadata bytes', async t => {
  const f = await fixture(t)
  const provenance = await mergeDesktopReleaseManifests({ ...f, version: `v${f.version}` })
  const mac = YAML.parse(await readFile(join(f.output, 'latest-mac.yml'), 'utf8'))
  assert.deepEqual(mac.files, [f.builds[0].manifest.files[0], f.builds[1].manifest.files[0]])
  assert.equal(mac.path, f.builds[0].assets[0].name)
  assert.equal(mac.sha512, f.builds[0].manifest.sha512)
  assert.equal(mac.releaseDate, f.builds[1].manifest.releaseDate)
  assert.equal(mac.releaseNotes, f.builds[0].manifest.releaseNotes)
  assert.equal(provenance.format, 'arcadia.desktop-release/1')
  assert.equal(provenance.version, f.version)
  assert.equal(provenance.commit, commit)
  assert.deepEqual(
    provenance.sources.map(source => source.artifactId),
    [100, 101, 102, 103],
  )
  for (const build of f.builds) {
    const recordedSource = provenance.sources.find(source => source.artifactId === build.source.artifactId)
    assert.deepEqual(recordedSource.build, build.receipt)
    assert.equal(recordedSource.digest, build.source.digest)
    for (const asset of build.assets) {
      assert.deepEqual(await readFile(join(f.output, asset.name)), asset.content)
      assert.deepEqual(
        provenance.files.find(file => file.name === asset.name),
        {
          name: asset.name,
          size: asset.content.length,
          sha512: sha512(asset.content),
          sourceId: build.source.artifactId,
        },
      )
    }
    if (build.platform !== 'darwin') {
      const name = matrix.find(target => target.platform === build.platform).manifest
      assert.equal(await readFile(join(f.output, name), 'utf8'), build.manifestText)
    }
  }
  const expected = [
    ...f.builds.flatMap(build => build.assets.map(asset => asset.name)),
    'latest-mac.yml',
    'latest.yml',
    'latest-linux.yml',
    'desktop-release-provenance.json',
  ]
  assert.deepEqual((await readdir(f.output)).sort(), expected.sort())
  assert.deepEqual(JSON.parse(await readFile(join(f.output, 'desktop-release-provenance.json'), 'utf8')), provenance)
  for (const entry of provenance.files) {
    const content = await readFile(join(f.output, entry.name))
    assert.equal(content.length, entry.size)
    assert.equal(sha512(content), entry.sha512)
  }
})

test('GitHub prerelease versions retain the generated latest channel manifests', async t => {
  const f = await fixture(t, '4.1.0-preview.2')
  await mergeDesktopReleaseManifests(f)
  assert.equal(YAML.parse(await readFile(join(f.output, 'latest-mac.yml'), 'utf8')).version, f.version)
  assert.equal(
    (await readdir(f.output)).some(name => name.startsWith('preview')),
    false,
  )
})

test('an unexpected generated prerelease channel is rejected before creating release output', async t => {
  const f = await fixture(t, '4.1.0-beta.2')
  await writeFile(join(f.builds[0].directory, 'beta-mac.yml'), f.builds[0].manifestText)
  await rejectBeforeOutput(f, /unexpected or missing asset/)
})

test('SemVer build metadata stays in update metadata while asset names are GitHub safe', async t => {
  const f = await fixture(t, '4.1.0+build.7')
  const provenance = await mergeDesktopReleaseManifests(f)
  assert.equal(provenance.version, '4.1.0+build.7')
  const mac = YAML.parse(await readFile(join(f.output, 'latest-mac.yml'), 'utf8'))
  assert.equal(mac.version, '4.1.0+build.7')
  assert.equal(mac.files[0].url, 'Arcadia-Eternity-4.1.0-build.7-mac-x64.zip')
  assert.equal(
    provenance.files.every(file => /^[A-Za-z0-9._-]+$/.test(file.name)),
    true,
  )
})

test('missing or duplicate targets and source identities reject before creating output', async t => {
  const cases = [
    ['missing target', f => f.sources.pop(), /all four native/],
    [
      'duplicate target',
      f =>
        Object.assign(f.sources[0], {
          platform: 'darwin',
          arch: 'x64',
          artifactName: 'desktop-release-124-1-darwin-x64',
        }),
      /duplicate native target/,
    ],
    [
      'duplicate artifact ID',
      f => {
        f.sources[0].artifactId = f.sources[1].artifactId
      },
      /artifact IDs/,
    ],
    [
      'duplicate artifact name',
      f => {
        f.sources[0].artifactName = f.sources[1].artifactName
      },
      /target does not match|duplicate artifact source/,
    ],
    [
      'source name traversal',
      f => {
        f.sources[0].artifactName = '../desktop-release-123-1-linux-x64'
      },
      /artifact source name/,
    ],
    [
      'invalid digest',
      f => {
        f.sources[0].digest = 'sha256:short'
      },
      /artifact digest/,
    ],
  ]
  for (const [name, mutate, error] of cases)
    await t.test(name, async t => {
      const f = await fixture(t)
      mutate(f)
      await rejectBeforeOutput(f, error)
    })
})

test('build and update metadata must agree on the requested version and commit', async t => {
  for (const [name, mutate] of [
    [
      'receipt version',
      receipt => {
        receipt.version = '4.0.0'
      },
    ],
    [
      'receipt commit',
      receipt => {
        receipt.commit = '0'.repeat(40)
      },
    ],
    [
      'receipt target',
      receipt => {
        receipt.arch = 'arm64'
      },
    ],
  ])
    await t.test(name, async t => {
      const f = await fixture(t)
      const receipt = { ...f.builds[2].receipt }
      mutate(receipt)
      await writeFile(join(f.builds[2].directory, 'desktop-build.json'), JSON.stringify(receipt))
      await rejectBeforeOutput(f, /build receipt does not match/)
    })
  await t.test('update version', async t => {
    const f = await fixture(t)
    await replaceManifest(f.builds[1], manifest => {
      manifest.version = '4.0.0'
    })
    await rejectBeforeOutput(f, /manifest version does not match/)
  })
})

test('installer bytes, size, local path, and legacy references are checked before output', async t => {
  const changes = [
    [
      'hash',
      manifest => {
        manifest.files[0].sha512 = sha512('different bytes')
      },
      /does not match its artifact/,
    ],
    [
      'size',
      manifest => {
        manifest.files[0].size++
      },
      /does not match its artifact/,
    ],
    [
      'remote URL',
      manifest => {
        manifest.files[0].url = 'https://example.invalid/installer.zip'
      },
      /does not match its artifact/,
    ],
    [
      'traversal path',
      manifest => {
        manifest.files[0].url = '../installer.zip'
      },
      /does not match its artifact/,
    ],
    [
      'legacy path',
      manifest => {
        manifest.path = 'another.zip'
      },
      /legacy update path\/hash/,
    ],
    [
      'legacy hash',
      manifest => {
        manifest.sha512 = sha512('another installer')
      },
      /legacy update path\/hash/,
    ],
  ]
  for (const [name, mutate, error] of changes)
    await t.test(name, async t => {
      const f = await fixture(t)
      await replaceManifest(f.builds[0], mutate)
      await rejectBeforeOutput(f, error)
    })
  await t.test('binary changed after manifest generation', async t => {
    const f = await fixture(t)
    await writeFile(join(f.builds[0].directory, f.builds[0].assets[0].name), 'replacement binary')
    await rejectBeforeOutput(f, /does not match its artifact/)
  })
})

test('conflicting common Mac release metadata cannot be silently selected from one architecture', async t => {
  const f = await fixture(t)
  await replaceManifest(f.builds[1], manifest => {
    manifest.releaseNotes = 'Different release instructions'
  })
  await rejectBeforeOutput(f, /Mac manifests disagree on common release metadata/)
})

test('unexpected files, missing required Windows ZIP, and linked assets are rejected without output', async t => {
  await t.test('unexpected binary', async t => {
    const f = await fixture(t)
    await writeFile(join(f.builds[0].directory, 'unverified.zip'), 'unverified')
    await rejectBeforeOutput(f, /unexpected or missing asset/)
  })
  await t.test('missing Windows ZIP', async t => {
    const f = await fixture(t)
    await rm(join(f.builds[2].directory, f.builds[2].assets[1].name))
    await rejectBeforeOutput(f, /unexpected or missing asset/)
  })
  await t.test('symlink with matching installer content', async t => {
    const f = await fixture(t)
    const build = f.builds[0]
    const asset = build.assets[0]
    const external = join(f.root, 'outside-installer.zip')
    await writeFile(external, asset.content)
    await rm(join(build.directory, asset.name))
    await symlink(external, join(build.directory, asset.name), 'file')
    await rejectBeforeOutput(f, /expected a regular file/)
  })
  await t.test('unexpected artifact directory', async t => {
    const f = await fixture(t)
    await mkdir(join(f.input, 'desktop-release-122-1-darwin-x64'))
    await rejectBeforeOutput(f, /unexpected or missing input artifact/)
  })
})

test('an existing output directory and its contents are never overwritten', async t => {
  const f = await fixture(t)
  await mkdir(f.output)
  await writeFile(join(f.output, 'previous-release'), 'preserve me')
  await assert.rejects(mergeDesktopReleaseManifests(f), { code: 'EEXIST' })
  assert.deepEqual(await readdir(f.output), ['previous-release'])
  assert.equal(await readFile(join(f.output, 'previous-release'), 'utf8'), 'preserve me')
})
