const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const KINDS = new Set(['license', 'declaration', 'notice', 'referenced-terms'])
const NATURAL_TERMS = 'https://lauri.rooden.ee/mit-license.txt'
const CC_BY_TERMS = 'https://creativecommons.org/licenses/by/3.0/legalcode.txt'
const CC_ZERO_TERMS = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt'
const EXTERNAL_TERMS = new Set([NATURAL_TERMS, CC_BY_TERMS, CC_ZERO_TERMS])

function requireValue(condition, message) {
  if (!condition) throw new Error(`Invalid supplemental license provenance: ${message}`)
}

function shape(value, required, optional = []) {
  requireValue(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    'expected an object',
  )
  const allowed = new Set([...required, ...optional])
  requireValue(
    required.every(key => Object.hasOwn(value, key)),
    'missing required field',
  )
  requireValue(
    Object.keys(value).every(key => allowed.has(key)),
    'unknown field',
  )
}

function text(value, limit = 4096) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function relativePath(value) {
  return (
    text(value, 512) &&
    !/[\\:%?#]/.test(value) &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
  )
}

function httpsUrl(value) {
  requireValue(text(value), 'invalid source URL')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid supplemental license provenance: invalid source URL')
  }
  requireValue(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      url.href === value,
    'source URL must be canonical HTTPS without credentials, query or fragment',
  )
  return url
}

function integrity(value) {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return false
  const encoded = value.slice(7)
  const bytes = Buffer.from(encoded, 'base64')
  return bytes.length === 64 && bytes.toString('base64') === encoded
}

function registry(entry) {
  shape(entry.registry, ['url', 'integrity'], ['gitHead', 'attestationUrl'])
  const url = httpsUrl(entry.registry.url)
  let path
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('Invalid supplemental license provenance: invalid registry path')
  }
  requireValue(
    url.hostname === 'registry.npmjs.org' && path === `/${entry.name}/${entry.version}`,
    'registry identity mismatch',
  )
  requireValue(integrity(entry.registry.integrity), 'invalid registry SHA512 integrity')
  if (entry.registry.gitHead !== undefined) requireValue(COMMIT.test(entry.registry.gitHead), 'invalid registry commit')
  if (entry.registry.attestationUrl !== undefined) {
    const attestation = httpsUrl(entry.registry.attestationUrl)
    let path
    try {
      path = decodeURIComponent(attestation.pathname)
    } catch {
      throw new Error('Invalid supplemental license provenance: invalid attestation path')
    }
    requireValue(
      attestation.hostname === 'registry.npmjs.org' && path === `/-/npm/v1/attestations/${entry.name}@${entry.version}`,
      'attestation identity mismatch',
    )
  }
}

function sourceMatch(entry) {
  if (entry.sourceMatch === undefined) return
  const match = entry.sourceMatch
  shape(match, ['commit', 'publishedAt', 'archiveIntegrityVerified', 'files', 'manifestDifference'])
  requireValue(COMMIT.test(match.commit), 'invalid matched source commit')
  requireValue(text(match.publishedAt) && !Number.isNaN(Date.parse(match.publishedAt)), 'invalid publication time')
  requireValue(match.archiveIntegrityVerified === true, 'source archive integrity was not verified')
  requireValue(
    Array.isArray(match.files) && match.files.length > 0 && match.files.length <= 10000,
    'missing matched source files',
  )
  const published = new Set(),
    sources = new Set()
  for (const file of match.files) {
    shape(file, ['publishedPath', 'sourcePath', 'sha256'])
    requireValue(
      relativePath(file.publishedPath) && relativePath(file.sourcePath) && SHA256.test(file.sha256),
      'invalid matched source file',
    )
    requireValue(!published.has(file.publishedPath) && !sources.has(file.sourcePath), 'duplicate matched source file')
    published.add(file.publishedPath)
    sources.add(file.sourcePath)
  }
  shape(match.manifestDifference, ['version'])
  shape(match.manifestDifference.version, ['source', 'published'])
  requireValue(
    VERSION.test(match.manifestDifference.version.source) &&
      match.manifestDifference.version.published === entry.version &&
      match.manifestDifference.version.source !== entry.version,
    'source manifest difference must contain only the recorded release version change',
  )
  requireValue(
    entry.files.some(file => file.kind === 'license' && file.sourceCommit === match.commit),
    'source license is not pinned to matched source',
  )
}

function sourceAudit(entry) {
  if (entry.sourceAudit === undefined) return
  const audit = entry.sourceAudit
  shape(
    audit,
    ['commit', 'finding'],
    [
      'treeUrl',
      'matchingLicensePaths',
      'checkedDeclarationPath',
      'excludedLicenseFiles',
      'publishedDeclaration',
      'originalLicense',
      'sourceLicenseSha256',
      'releaseRef',
      'tagObject',
    ],
  )
  requireValue(
    entry.status === 'unresolved' && COMMIT.test(audit.commit) && text(audit.finding, 32768),
    'invalid unresolved source audit',
  )
  if (audit.treeUrl !== undefined) {
    let url
    try {
      url = new URL(audit.treeUrl)
    } catch {
      throw new Error('Invalid supplemental license provenance: invalid audit tree URL')
    }
    requireValue(
      text(audit.treeUrl) &&
        url.protocol === 'https:' &&
        url.hostname === 'api.github.com' &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash &&
        url.search === '?recursive=1' &&
        url.href === audit.treeUrl &&
        new RegExp(`^/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/git/trees/${audit.commit}$`).test(url.pathname),
      'invalid audit tree URL',
    )
  }
  if (audit.matchingLicensePaths !== undefined)
    requireValue(
      Array.isArray(audit.matchingLicensePaths) && audit.matchingLicensePaths.every(relativePath),
      'invalid audited license paths',
    )
  if (audit.checkedDeclarationPath !== undefined)
    requireValue(relativePath(audit.checkedDeclarationPath), 'invalid audited declaration path')
  if (audit.excludedLicenseFiles !== undefined) {
    requireValue(Array.isArray(audit.excludedLicenseFiles), 'invalid excluded audit files')
    for (const file of audit.excludedLicenseFiles) {
      shape(file, ['path', 'reason'])
      requireValue(
        relativePath(file.path) && text(file.reason, 32768) && audit.matchingLicensePaths?.includes(file.path),
        'invalid excluded audit file',
      )
    }
  }
  if (audit.publishedDeclaration !== undefined)
    requireValue(audit.publishedDeclaration === entry.declaredLicense, 'audit declaration mismatch')
  if (audit.originalLicense !== undefined) requireValue(text(audit.originalLicense, 128), 'invalid audited license')
  if (audit.sourceLicenseSha256 !== undefined)
    requireValue(
      SHA256.test(audit.sourceLicenseSha256) &&
        entry.files.some(file => file.sha256 === audit.sourceLicenseSha256 && file.sourceCommit === audit.commit),
      'audited license digest mismatch',
    )
  if (audit.releaseRef !== undefined)
    requireValue(
      audit.releaseRef === `refs/tags/v${entry.version}` || audit.releaseRef === `refs/tags/${entry.version}`,
      'audit release tag mismatch',
    )
  if (audit.tagObject !== undefined) requireValue(COMMIT.test(audit.tagObject), 'invalid audit tag object')
}

function rawSource(file) {
  const url = httpsUrl(file.sourceUrl)
  if (url.hostname === 'raw.githubusercontent.com') {
    requireValue(
      COMMIT.test(file.sourceCommit) && relativePath(file.sourcePath),
      'missing immutable source commit or path',
    )
    const parts = url.pathname.split('/')
    requireValue(
      parts.length >= 5 &&
        /^[A-Za-z0-9_.-]+$/.test(parts[1]) &&
        /^[A-Za-z0-9_.-]+$/.test(parts[2]) &&
        parts[3] === file.sourceCommit &&
        parts.slice(4).join('/') === file.sourcePath,
      'source URL differs from commit and path',
    )
    return
  }
  requireValue(EXTERNAL_TERMS.has(file.sourceUrl), 'unreviewed external source host or URL')
  requireValue(
    file.sourceCommit === undefined && file.sourcePath === undefined,
    'external referenced terms cannot claim a Git commit',
  )
}

function requiredChains(entry) {
  const has = (kind, license, sourceUrl) =>
    entry.files.some(file => file.kind === kind && file.license === license && file.sourceUrl === sourceUrl)
  const github = (repository, path, commit = entry.registry.gitHead) =>
    `https://raw.githubusercontent.com/${repository}/${commit}/${path}`
  const identity = `${entry.name}@${entry.version}`
  for (const file of entry.files.filter(file => EXTERNAL_TERMS.has(file.sourceUrl))) {
    const expected =
      file.sourceUrl === NATURAL_TERMS
        ? 'natural-compare@1.4.0'
        : file.sourceUrl === CC_BY_TERMS
          ? 'spdx-exceptions@2.5.0'
          : 'spdx-license-ids@3.0.23'
    requireValue(identity === expected, 'external terms do not belong to the reviewed package')
  }
  if (entry.status !== 'verified') return
  requireValue(
    entry.registry.gitHead || entry.registry.attestationUrl || entry.sourceMatch,
    'verified review has no recorded release source linkage',
  )
  const mainCommit = entry.sourceMatch?.commit ?? entry.registry.gitHead
  if (mainCommit)
    for (const file of entry.files) {
      const vendorAuthor =
        identity === 'qrcode-terminal@0.12.0' &&
        file.sourceUrl ===
          github('kazuhikoarase/qrcode-generator', 'LICENSE', '517b9e6c3882f3ad28e4f776bbf1e1495869dc4c')
      if (file.sourceCommit !== undefined && !vendorAuthor)
        requireValue(file.sourceCommit === mainCommit, 'source commit is not linked to the recorded release')
    }
  if (identity === 'natural-compare@1.4.0') {
    requireValue(
      entry.declaredLicense === 'MIT' &&
        has('declaration', 'MIT', github('litejs/natural-compare-lite', 'README.md')) &&
        has('license', 'MIT', NATURAL_TERMS),
      'natural author terms require the pinned package declaration',
    )
  }
  if (identity === 'spdx-exceptions@2.5.0' || identity === 'spdx-license-ids@3.0.23') {
    const exceptions = identity === 'spdx-exceptions@2.5.0'
    const license = exceptions ? 'CC-BY-3.0' : 'CC0-1.0'
    requireValue(
      entry.declaredLicense === license &&
        has(
          'license',
          license,
          github(exceptions ? 'kemitchell/spdx-exceptions.json' : 'jslicense/spdx-license-ids', 'README.md'),
        ) &&
        has('referenced-terms', license, exceptions ? CC_BY_TERMS : CC_ZERO_TERMS),
      'Creative Commons grant requires its complete referenced terms',
    )
  }
  if (identity === '@humanfs/types@0.15.0') {
    requireValue(
      entry.declaredLicense === 'Apache-2.0' &&
        has('license', 'Apache-2.0', github('humanwhocodes/humanfs', 'packages/types/README.md')) &&
        has('declaration', 'Apache-2.0', github('humanwhocodes/humanfs', 'packages/types/src/hfs-types.ts')) &&
        has('referenced-terms', 'Apache-2.0', github('humanwhocodes/humanfs', 'packages/core/LICENSE')),
      'humanfs grant requires attribution and complete same-commit terms',
    )
  }
  if (identity === 'qrcode-terminal@0.12.0') {
    requireValue(
      entry.declaredLicense === 'Apache-2.0' &&
        has('license', 'MIT', github('gtanner/qrcode-terminal', 'LICENSE')) &&
        has(
          'license',
          'MIT',
          github('kazuhikoarase/qrcode-generator', 'LICENSE', '517b9e6c3882f3ad28e4f776bbf1e1495869dc4c'),
        ),
      'qrcode vendor terms require the release grant and original author license',
    )
  } else {
    requireValue(
      entry.files.some(file => file.kind === 'license' && file.license === entry.declaredLicense),
      'verified review has no matching license grant',
    )
  }
}

/** Validate checked-in review data before any supplemental text can clear a gate. */
export function validateSupplementalProvenance(document) {
  shape(document, ['format', 'version', 'entries'])
  requireValue(
    document.format === 'arcadia.desktop-license-supplemental' && document.version === 1,
    'unsupported format',
  )
  requireValue(Array.isArray(document.entries) && document.entries.length <= 10000, 'invalid entries')
  const records = new Map()
  for (const entry of document.entries) {
    shape(
      entry,
      ['name', 'version', 'declaredLicense', 'status', 'registry', 'files'],
      ['note', 'sourceMatch', 'sourceAudit'],
    )
    requireValue(
      text(entry.name, 214) && NAME.test(entry.name) && text(entry.version, 128) && VERSION.test(entry.version),
      'invalid package identity',
    )
    requireValue(
      text(entry.declaredLicense, 128) && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(entry.declaredLicense),
      'invalid declared license',
    )
    requireValue(['verified', 'unresolved'].includes(entry.status), 'invalid review status')
    requireValue(entry.note === undefined || text(entry.note, 32768), 'invalid review note')
    requireValue(
      Array.isArray(entry.files) &&
        entry.files.length <= 1000 &&
        (entry.status !== 'verified' || entry.files.length > 0),
      'invalid reviewed file list',
    )
    registry(entry)
    const seen = new Set()
    for (const file of entry.files) {
      shape(file, ['file', 'sha256', 'license', 'kind', 'sourceUrl'], ['sourceCommit', 'sourcePath'])
      requireValue(relativePath(file.file) && SHA256.test(file.sha256), 'invalid local file or digest')
      requireValue(
        text(file.license, 128) && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(file.license) && KINDS.has(file.kind),
        'invalid file license or kind',
      )
      requireValue(!seen.has(file.file), 'duplicate reviewed file')
      seen.add(file.file)
      rawSource(file)
    }
    sourceMatch(entry)
    sourceAudit(entry)
    requiredChains(entry)
    const key = JSON.stringify([entry.name, entry.version])
    requireValue(!records.has(key), 'duplicate package identity')
    records.set(key, entry)
  }
  return records
}
