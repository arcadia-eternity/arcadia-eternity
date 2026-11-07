import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSupplementalProvenance } from './desktop-license-provenance.mjs'

const LICENSE_NAME = /^(?:licen[cs]e|copying|notice|copyright(?:notice)?)(?:[._-].*)?$/i
const README_NAME = /^readme(?:[._-].*)?$/i
const MAX_TEXT_BYTES = 32 * 1024 * 1024
const supplementalRoot = fileURLToPath(new URL('./desktop-license-reference/supplemental/', import.meta.url))
let supplementalRecords

async function loadSupplementalRecords() {
  supplementalRecords ??= readFile(join(supplementalRoot, 'provenance.json'), 'utf8').then(text =>
    validateSupplementalProvenance(JSON.parse(text)),
  )
  return supplementalRecords
}

// Pinned SPDX originals are build-time reference material, never substituted for
// the license text supplied by a dependency. See desktop-license-reference/README.md.
const referenceNames = ['MIT-0', 'BlueOak-1.0.0', 'BSD-3-Clause']
const references = Object.fromEntries(
  referenceNames.map(name => {
    const bytes = readFileSync(new URL(`./desktop-license-reference/${name}.txt`, import.meta.url))
    return [name, bytes.toString('utf8')]
  }),
)

// These complete, package-supplied notices contain legitimate attribution or
// named BSD endorsements that the generic matcher cannot safely infer. The
// allowance applies only to the exact package version and exact original bytes.
// See desktop-license-reference/README.md for the preserved source texts.
const verifiedPackageTexts = new Map(
  [
    ['balanced-match', '4.0.4', 'balanced-match-4.0.4', 'MIT'],
    ['pngjs', '7.0.0', 'pngjs-7.0.0', 'MIT'],
    ['diff', '8.0.4', 'diff-8.0.4', 'BSD-3-Clause'],
    ['esquery', '1.7.0', 'esquery-1.7.0', 'BSD-3-Clause'],
    ['istanbul-lib-coverage', '3.2.2', 'istanbul-licenses', 'BSD-3-Clause'],
    ['istanbul-lib-report', '3.0.1', 'istanbul-licenses', 'BSD-3-Clause'],
    ['istanbul-reports', '3.2.0', 'istanbul-licenses', 'BSD-3-Clause'],
    ['source-map-js', '1.2.2', 'source-map-js-1.2.2', 'BSD-3-Clause'],
    ['tough-cookie', '5.1.2', 'tough-cookie-5.1.2', 'BSD-3-Clause'],
    ['@colors/colors', '1.5.0', 'colors-1.5.0', 'MIT'],
    ['@jitl/quickjs-ffi-types', '0.32.0', 'quickjs-0.32.0', 'MIT'],
    ['quickjs-emscripten', '0.32.0', 'quickjs-0.32.0', 'MIT'],
    ['quickjs-emscripten-core', '0.32.0', 'quickjs-0.32.0', 'MIT'],
    ['fast-uri', '3.1.8', 'fast-uri-3.1.8', 'BSD-3-Clause'],
    ['json-schema-typed', '8.0.2', 'json-schema-typed-8.0.2', 'BSD-2-Clause'],
    ['tslib', '2.9.1', 'tslib-2.9.1', '0BSD'],
    ['archy', '1.0.0', 'mit-publisher-no-holder', 'MIT'],
    ['github-from-package', '0.0.0', 'mit-publisher-no-holder', 'MIT'],
    ['json-stable-stringify-without-jsonify', '1.0.1', 'mit-publisher-no-holder', 'MIT'],
    ['minimist', '1.2.8', 'mit-publisher-no-holder', 'MIT'],
    ['text-table', '0.2.0', 'mit-publisher-no-holder', 'MIT'],
    ['pkce-challenge', '5.0.0', 'pkce-challenge-5.0.0', 'MIT'],
    ['nodemailer', '10.2.1', 'nodemailer-10.2.1', 'MIT-0'],
    ['chownr', '3.0.0', 'blueoak-published-dist', 'BlueOak-1.0.0', ['src']],
    ['glob', '13.0.6', 'blueoak-published-dist', 'BlueOak-1.0.0', ['src']],
    ['yallist', '5.0.0', 'blueoak-published-dist', 'BlueOak-1.0.0', ['src']],
  ].map(([name, version, file, license, absentPaths = []]) => [
    JSON.stringify([name, version]),
    {
      text: readFileSync(new URL(`./desktop-license-reference/packages/${file}.txt`, import.meta.url), 'utf8'),
      license,
      absentPaths,
    },
  ]),
)

function normalizedTerms(text) {
  return text
    .normalize('NFKC')
    .replace(/^\s*[123][.)]\s+/gm, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesReference(content, name, marker, titles, requireCopyright) {
  const index = content.toLowerCase().indexOf(marker)
  if (index < 0) return false
  const prefix = content.slice(0, index)
  let attributed = false
  for (const line of prefix.split(/\r?\n/)) {
    if (!line.trim()) continue
    const normalized = normalizedTerms(line)
    if (titles.includes(normalized) || normalized === 'all rights reserved') continue
    const copyright = /^\s*(?:copyright(?:\s*\(c\)|\s*©)?|©)\s+(.+)$/i.exec(line)?.[1]
    if (!copyright || !/[a-z]/i.test(copyright) || /<[^>]+>|\[(?:year|fullname)\]/i.test(copyright)) return false
    attributed = true
  }
  if (requireCopyright && !attributed) return false
  const standard = references[name]
  const standardStart = standard.toLowerCase().indexOf(marker)
  return standardStart >= 0 && normalizedTerms(content.slice(index)) === normalizedTerms(standard.slice(standardStart))
}

function inside(root, file) {
  const name = relative(root, file)
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

/** Conservative textual evidence only; uncertain or conflicting terms require manual review. */
function recognizedLicenseTexts(content) {
  const text = content.toLowerCase().replace(/\s+/g, ' ')
  const warranty = /provided.{0,80}as is/.test(text)
  const liability = /in no event shall/.test(text)
  const attributed = content.split(/\r?\n/).some(line => {
    const value = /^\s*(?:copyright(?:\s*\(c\)|\s*©)?|©)\s+(.+)$/i.exec(line)?.[1]
    return (
      !!value &&
      /[a-z]/i.test(value) &&
      !/^(?:notice|holders?)\b/i.test(value) &&
      !/(?:<year>|<copyright holder>|\[year\]|\[fullname\])/i.test(value)
    )
  })
  const found = []
  if (
    matchesReference(
      content,
      'MIT-0',
      'permission is hereby granted',
      ['mit no attribution', 'mit no attribution mit 0'],
      true,
    )
  )
    found.push('MIT-0')
  if (
    matchesReference(
      content,
      'BSD-3-Clause',
      'redistribution and use in source and binary forms',
      ['bsd 3 clause license', 'bsd 3 clause'],
      true,
    )
  )
    found.push('BSD-3-Clause')
  if (matchesReference(content, 'BlueOak-1.0.0', '# blue oak model license', [], false)) found.push('BlueOak-1.0.0')
  if (
    text.length >= 700 &&
    attributed &&
    /permission is hereby granted,? free of charge/.test(text) &&
    /deal in the software without restriction/.test(text) &&
    /copyright notice and this permission notice shall be included/.test(text) &&
    /sublicense,? and\/?or sell/.test(text) &&
    warranty &&
    liability
  )
    found.push('MIT')
  if (
    text.length >= 800 &&
    attributed &&
    /redistribution and use in source and binary forms/.test(text) &&
    /redistributions of source code must retain/.test(text) &&
    /redistributions in binary form must reproduce/.test(text) &&
    warranty &&
    liability &&
    !/\b(?:neither|endorse|promote)\b/.test(text)
  )
    found.push('BSD-2-Clause')
  if (
    text.length >= 500 &&
    attributed &&
    /permission to use, copy, modify, and\/?or distribute/.test(text) &&
    /copyright notice and this permission notice appear in all copies/.test(text) &&
    warranty &&
    liability
  )
    found.push('ISC')
  if (
    text.length >= 8000 &&
    /terms and conditions for use, reproduction, and distribution/.test(text) &&
    /end of terms and conditions/.test(text)
  )
    found.push('Apache-2.0')
  if (
    text.length >= 10000 &&
    /mozilla public license version 2\.0/.test(text) &&
    /2\.1\. grants/.test(text) &&
    /disclaimer of warranty/.test(text) &&
    /10\. versions of the license/.test(text)
  )
    found.push('MPL-2.0')
  if (
    text.length >= 6000 &&
    /artistic license 2\.0/.test(text) &&
    /permissions for redistribution of the standard version/.test(text) &&
    /patent license/.test(text) &&
    /disclaimer of warranty/.test(text)
  )
    found.push('Artistic-2.0')
  if (
    text.length >= 10000 &&
    /gnu general public license/.test(text) &&
    /terms and conditions/.test(text) &&
    /end of terms and conditions/.test(text) &&
    /disclaimer of warranty/.test(text)
  ) {
    const version = /gnu general public license version ([23])/.exec(text)?.[1]
    if (version) found.push(`GPL-${version}.0-only`)
  }
  if (
    text.length >= 5000 &&
    /cc0 1\.0 universal/.test(text) &&
    /waiver/.test(text) &&
    /limitations and disclaimers/.test(text)
  )
    found.push('CC0-1.0')
  if (
    text.length >= 700 &&
    /this is free and unencumbered software released into the public domain/.test(text) &&
    warranty
  )
    found.push('Unlicense')
  return found
}

function declarationMatches(declared, evidence) {
  if (!declared) return false
  // Unknown SPDX forms, including WITH exceptions, require review rather than inference.
  const clauses = declared.split(/\s+OR\s+/i).map(part => part.trim().replace(/^\(|\)$/g, ''))
  if (clauses.some(part => !/^[A-Za-z0-9.+-]+$/.test(part))) return false
  return clauses.some(part => evidence.has(part))
}

function packageDeclaration(metadata) {
  if (typeof metadata.license === 'string')
    return { value: metadata.license, source: 'license', original: metadata.license }
  if (metadata.license !== undefined || !Array.isArray(metadata.licenses) || metadata.licenses.length !== 1)
    return { value: null, source: null }
  const legacy = metadata.licenses[0]
  if (!legacy || typeof legacy.type !== 'string') return { value: null, source: null }
  const aliases = { 'Apache 2.0': 'Apache-2.0' }
  return { value: aliases[legacy.type] ?? legacy.type, source: 'licenses[0].type', original: legacy.type }
}

function sourceRepository(metadata) {
  const candidate = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
  if (typeof candidate !== 'string') return null
  try {
    const url = new URL(candidate.replace(/^git\+/, ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

async function regularFile(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_TEXT_BYTES)
    throw new Error(`Unsafe or oversized license source: ${file}`)
  return readFile(file)
}

async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Inventory actual distributed package license texts, preserving their source paths.
 * Returns { packages, missing, project, electron }; the caller decides whether to
 * reject missing texts. A declaration alone never counts as a distributed license.
 * Package symlinks are not followed: pnpm's physical packages are scanned separately.
 */
export async function collectDesktopLicenses(runtimeRoot, { repositoryLicense, electronLicense, electronNotices }) {
  const root = await realpath(resolve(runtimeRoot))
  const output = join(root, 'licenses')
  await mkdir(output, { recursive: true })
  if ((await lstat(output)).isSymbolicLink() || !inside(root, await realpath(output)))
    throw new Error(`License output escapes runtime: ${output}`)
  const packageRecords = []
  const missing = []
  const visited = new Set()
  const copied = new Map()
  const supplements = await loadSupplementalRecords()

  async function preserve(file, source) {
    const data = await regularFile(file)
    const digest = createHash('sha256').update(data).digest('hex')
    const destination = `licenses/${digest}.txt`
    if (!copied.has(digest)) {
      try {
        await writeFile(join(root, destination), data, { flag: 'wx' })
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (!(await regularFile(join(root, destination))).equals(data))
          throw new Error('Existing license digest file has different bytes', { cause: error })
      }
      copied.set(digest, destination)
    }
    return { source, sha256: digest, path: destination }
  }

  const project = await preserve(resolve(repositoryLicense), 'repository:LICENSE')
  const projectText = (await regularFile(resolve(repositoryLicense))).toString('utf8')
  const projectLicense = recognizedLicenseTexts(projectText).includes('MIT') ? 'MIT' : null
  const electron = [
    await preserve(resolve(electronLicense), 'electron:LICENSE'),
    await preserve(resolve(electronNotices), 'electron:LICENSES.chromium.html'),
  ]

  async function packageDir(directory, origin) {
    const path = resolve(directory)
    if (!inside(root, path)) throw new Error(`Package escapes runtime: ${path}`)
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) return
    const real = await realpath(path)
    if (!inside(root, real)) throw new Error(`Package escapes runtime: ${path}`)
    if (visited.has(real)) return
    visited.add(real)
    const packageFile = join(path, 'package.json')
    let metadata
    try {
      metadata = JSON.parse((await regularFile(packageFile)).toString('utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string')
      throw new Error(`Invalid package metadata: ${packageFile}`)
    const declaration = packageDeclaration(metadata)
    const declared = declaration.value
    const files = []
    const evidence = new Set()
    for (const entry of (await entries(path)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!LICENSE_NAME.test(entry.name) && !README_NAME.test(entry.name)) continue
      const file = join(path, entry.name)
      // A linked license or README can point outside the immutable staged tree.
      if (entry.isSymbolicLink()) throw new Error(`Unsafe linked license source: ${file}`)
      if (!entry.isFile()) continue
      const isNotice = /^(?:notice|copyright(?:notice)?)(?:[._-].*)?$/i.test(entry.name)
      const isLicense = LICENSE_NAME.test(entry.name) && !isNotice
      const content = await regularFile(file)
      const recognized = recognizedLicenseTexts(content.toString('utf8'))
      if (isLicense) {
        const verified = verifiedPackageTexts.get(JSON.stringify([metadata.name, metadata.version]))
        let excludedPathsAbsent = true
        for (const excluded of verified?.absentPaths ?? []) {
          try {
            await lstat(join(path, excluded))
            excludedPathsAbsent = false
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
        }
        if (
          verified?.text === content.toString('utf8') &&
          excludedPathsAbsent &&
          !recognized.includes(verified.license)
        )
          recognized.push(verified.license)
      }
      if (README_NAME.test(entry.name) && !recognized.length) continue
      files.push({
        ...(await preserve(file, relative(root, file).split(sep).join('/'))),
        recognizedLicenses: recognized,
      })
      if (isLicense || README_NAME.test(entry.name)) for (const license of recognized) evidence.add(license)
    }
    const supplement = supplements.get(JSON.stringify([metadata.name, metadata.version]))
    if (supplement?.declaredLicense === declared) {
      for (const matched of supplement.sourceMatch?.files ?? []) {
        const published = resolve(path, matched.publishedPath)
        if (
          isAbsolute(matched.publishedPath) ||
          !inside(path, published) ||
          !inside(path, await realpath(published)) ||
          createHash('sha256')
            .update(await regularFile(published))
            .digest('hex') !== matched.sha256
        )
          throw new Error('Published package differs from the reviewed upstream source match')
      }
      for (const file of supplement.files) {
        if (
          typeof file.file !== 'string' ||
          isAbsolute(file.file) ||
          !inside(supplementalRoot, resolve(supplementalRoot, file.file)) ||
          !/^[a-f0-9]{64}$/.test(file.sha256) ||
          typeof file.sourceUrl !== 'string' ||
          !file.sourceUrl.startsWith('https://')
        )
          throw new Error('Invalid supplemental license source')
        const source = resolve(supplementalRoot, file.file)
        if (!inside(await realpath(supplementalRoot), await realpath(source)))
          throw new Error('Supplemental license source escapes references')
        const bytes = await regularFile(source)
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
          throw new Error('Supplemental license bytes differ from provenance')
        const recognized =
          supplement.status === 'verified' && file.kind === 'license' && typeof file.license === 'string'
            ? [file.license]
            : []
        files.push({
          ...(await preserve(source, file.sourceUrl)),
          recognizedLicenses: recognized,
          provenance: {
            sourceCommit: file.sourceCommit ?? null,
            sourcePath: file.sourcePath ?? null,
            registry: supplement.registry,
            status: supplement.status,
            kind: file.kind,
          },
        })
        for (const license of recognized) evidence.add(license)
      }
    }
    // The repository MIT text applies only when it does not contradict an explicit package declaration.
    if (!evidence.size && origin === 'workspace' && projectLicense && declared === projectLicense) {
      files.push(project)
      evidence.add(projectLicense)
    }
    const record = {
      name: metadata.name,
      version: metadata.version,
      license: declared,
      licenseDeclarationSource: declaration.source,
      originalLicenseDeclaration: declaration.original ?? null,
      repository: sourceRepository(metadata),
      origin,
      packagePath: relative(root, path).split(sep).join('/'),
      recognizedLicenses: [...evidence].sort(),
      files,
      ...(supplement
        ? {
            supplementalReview: {
              status: supplement.declaredLicense === declared ? supplement.status : 'unresolved',
              note: supplement.note ?? null,
              expectedDeclaration: supplement.declaredLicense,
              registry: supplement.registry,
              ...(supplement.sourceAudit ? { sourceAudit: supplement.sourceAudit } : {}),
              ...(supplement.sourceMatch ? { sourceMatch: supplement.sourceMatch } : {}),
            },
          }
        : {}),
    }
    packageRecords.push(record)
    const unresolvedReview = supplement?.declaredLicense === declared && supplement.status === 'unresolved'
    const supplementMismatch = !!supplement && supplement.declaredLicense !== declared
    if (!declarationMatches(declared, evidence) || unresolvedReview || supplementMismatch)
      missing.push({
        name: record.name,
        version: record.version,
        license: declared,
        origin,
        packagePath: record.packagePath,
        repository: record.repository,
        reason: supplementMismatch
          ? 'supplemental-declaration-mismatch'
          : !declared
            ? 'missing-declaration'
            : unresolvedReview && declarationMatches(declared, evidence)
              ? 'supplemental-review-unresolved'
              : evidence.size
                ? 'unmatched-or-unsupported-declaration'
                : 'missing-or-unrecognized-license-text',
      })
    await physicalPackages(join(path, 'node_modules'), origin === 'workspace' ? 'pnpm' : origin)
  }

  async function physicalPackages(directory, origin) {
    // If a parent directory was replaced with a link, never inspect its target.
    try {
      const real = await realpath(directory)
      if (!inside(root, real)) throw new Error(`Package directory escapes runtime: ${directory}`)
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of (await entries(directory)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of (await entries(path)).sort((a, b) => a.name.localeCompare(b.name)))
          if (scoped.isDirectory() && !scoped.isSymbolicLink()) await packageDir(join(path, scoped.name), origin)
      } else await packageDir(path, origin)
    }
  }

  const store = join(root, 'node_modules', '.pnpm')
  try {
    if (!inside(root, await realpath(store))) throw new Error(`Package store escapes runtime: ${store}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const entry of (await entries(store)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'node_modules') continue
    await physicalPackages(join(store, entry.name, 'node_modules'), 'pnpm')
  }
  await physicalPackages(join(root, 'node_modules', '@arcadia-eternity'), 'workspace')
  // Windows installers use physical hoisted directories. Scan these too;
  // visited paths prevent counting workspace/nested packages a second time.
  await physicalPackages(join(root, 'node_modules'), 'pnpm')
  await packageDir(join(root, 'runtime', 'npm'), 'npm')

  packageRecords.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.packagePath.localeCompare(b.packagePath),
  )
  missing.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.packagePath.localeCompare(b.packagePath),
  )
  return { packages: packageRecords, missing, project, electron }
}
