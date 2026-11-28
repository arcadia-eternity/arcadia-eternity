import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  parseEnvelope,
  parsePublicKey,
  parseRoot,
  signEnvelope,
  workshopKeyId,
  type WorkshopPublicKey,
  type WorkshopRoot,
} from '@arcadia-eternity/pack-loader/workshop'

export const registryUsage = [
  'arcadia-content registry keygen --public-out <file>',
  'arcadia-content registry root --registry <id> --version <n> --root-key <file>... --snapshot-key <file>... --mirror <url>... [--root-threshold <n>] [--expires-days <n>] --out <file>',
  'arcadia-content registry sign <envelope.json> --key-env <NAME>',
  'arcadia-content registry check [<directory>] [--project <id>]...',
  'arcadia-content registry build [<directory>] --out <directory> --key-env <NAME> [--published <url|directory>]... [--first] [--bump]',
].join('\n')

const signingKey = async (name: string | undefined) => {
  const value = name && /^[A-Z_][A-Z0-9_]*$/.test(name) ? process.env[name] : undefined
  if (!value) throw new Error(`Set the private key in the environment variable named by --key-env.\n${registryUsage}`)
  return importSigningKey(value)
}
const publicKeyFile = async (file: string) => parsePublicKey(JSON.parse(await readFile(resolve(file), 'utf8')))
const positive = (value: string | undefined, fallback: number) => {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(registryUsage)
  return number
}

export async function registryCli(args: string[]) {
  const [operation, ...rest] = args
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      'public-out': { type: 'string' },
      registry: { type: 'string' },
      version: { type: 'string' },
      'root-key': { type: 'string', multiple: true },
      'snapshot-key': { type: 'string', multiple: true },
      'root-threshold': { type: 'string' },
      mirror: { type: 'string', multiple: true },
      'expires-days': { type: 'string' },
      out: { type: 'string' },
      'key-env': { type: 'string' },
      project: { type: 'string', multiple: true },
      published: { type: 'string', multiple: true },
      first: { type: 'boolean' },
      bump: { type: 'boolean' },
    },
  })
  if (operation === 'keygen' && values['public-out'] && !positionals.length) {
    const key = await generateSigningKey()
    await writeFile(resolve(values['public-out']), JSON.stringify(key.publicKey, null, 2) + '\n', { flag: 'wx' })
    // The private key goes to stdout only, so it can be piped into a secret store without touching disk.
    process.stderr.write(`keyid ${key.keyid}\n`)
    process.stdout.write(key.pkcs8 + '\n')
    return
  }
  if (operation === 'root' && values.out && !positionals.length) {
    const keys: Record<string, WorkshopPublicKey> = {}
    const ids = async (files: string[] = []) => {
      const result: string[] = []
      for (const file of files) {
        const key = await publicKeyFile(file)
        const keyid = workshopKeyId(key)
        keys[keyid] = key
        result.push(keyid)
      }
      return result
    }
    const rootIds = await ids(values['root-key'])
    const snapshotIds = await ids(values['snapshot-key'])
    const root: WorkshopRoot = parseRoot({
      type: 'root',
      spec: 1,
      registry: values.registry,
      version: positive(values.version, 0),
      expires: new Date(Date.now() + positive(values['expires-days'], 365) * 86_400_000).toISOString(),
      keys,
      roles: {
        root: { keyids: rootIds, threshold: positive(values['root-threshold'], 1) },
        snapshot: { keyids: snapshotIds, threshold: 1 },
      },
      mirrors: values.mirror ?? [],
    })
    await writeFile(resolve(values.out), canonicalJson({ signed: root, signatures: [] }), { flag: 'wx' })
    return
  }
  if (operation === 'sign' && positionals.length === 1) {
    const file = resolve(positionals[0])
    const envelope = parseEnvelope(JSON.parse(await readFile(file, 'utf8')))
    const key = await signingKey(values['key-env'])
    if (envelope.signatures.some(item => item.keyid === key.keyid)) throw new Error(`Already signed by ${key.keyid}`)
    const signed = await signEnvelope(envelope.signed as unknown as { type: string }, [key])
    await writeFile(
      file,
      canonicalJson({ signed: envelope.signed, signatures: [...envelope.signatures, ...signed.signatures] }),
    )
    console.log(`Signed with ${key.keyid}`)
    return
  }
  const { buildRegistrySite, checkRegistrySource, loadRegistrySource, npmRegistry, readLatestPublishedState } =
    await import('./workshop-registry.ts')
  if (operation === 'check' && positionals.length <= 1) {
    const source = await loadRegistrySource(resolve(positionals[0] ?? '.'))
    const results = await checkRegistrySource(source, { npm: npmRegistry(), projects: values.project })
    for (const result of results) {
      console.log(`${result.project}: ${result.verified.length ? result.verified.join(', ') : 'no verified release'}`)
      for (const item of result.diagnostics) console.log(`  ${item.version} ${item.code} ${item.message}`)
    }
    if (results.some(result => !result.verified.length)) process.exitCode = 1
    return
  }
  if (operation === 'build' && values.out && positionals.length <= 1) {
    const source = await loadRegistrySource(resolve(positionals[0] ?? '.'))
    const signer = await signingKey(values['key-env'])
    const signal = AbortSignal.timeout(30 * 60_000)
    const published = values.published?.length ? values.published : source.root.mirrors
    if (!published.length) throw new Error('Declare a mirror in the root or pass --published.')
    const { latest: previous, found } = await readLatestPublishedState(
      published.map(item => (/^https:\/\//.test(item) ? item : resolve(item))),
      source,
      signal,
    )
    for (const item of found) console.log(`Published snapshot ${item.version} at ${item.base}`)
    // A transient 404 must not restart snapshot versions, which clients would reject as a rollback.
    if (!previous && !values.first)
      throw new Error(`No published snapshot at ${published.join(', ')}. Pass --first for the initial publish.`)
    if (previous && values.first) throw new Error(`Snapshot ${previous.snapshot.version} is already published.`)
    if (values.first && values.bump) throw new Error(registryUsage)
    const result = await buildRegistrySite(source, resolve(values.out), {
      npm: npmRegistry(),
      signer,
      previous,
      signal,
      bump: values.bump,
    })
    for (const item of result.diagnostics) console.log(`${item.project}@${item.version} ${item.code} ${item.message}`)
    console.log(
      result.changed ? `Snapshot ${result.snapshot.version} written` : `Snapshot ${result.snapshot.version} unchanged`,
    )
    console.log(`ARCADIA_RESULT=${JSON.stringify({ changed: result.changed, snapshot: result.snapshot.version })}`)
    return
  }
  throw new Error(registryUsage)
}
