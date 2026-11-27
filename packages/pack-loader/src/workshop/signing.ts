import { canonicalJson, fail, fromBase64, sha256Hex, toBase64, utf8 } from './encoding'

export interface WorkshopPublicKey {
  keytype: 'ed25519'
  /** Raw 32-byte Ed25519 public key, base64. */
  public: string
}
export interface WorkshopSignature {
  keyid: string
  sig: string
}
export interface SignedEnvelope<T> {
  signed: T
  signatures: WorkshopSignature[]
}
export interface WorkshopRole {
  keyids: string[]
  threshold: number
}

const keyIdPattern = /^[a-f0-9]{64}$/
export const isKeyId = (value: unknown): value is string => typeof value === 'string' && keyIdPattern.test(value)

export function workshopKeyId(key: WorkshopPublicKey) {
  return sha256Hex(utf8(canonicalJson({ keytype: key.keytype, public: key.public })))
}

export function parsePublicKey(value: unknown): WorkshopPublicKey {
  const key = value as WorkshopPublicKey
  if (
    !key ||
    typeof key !== 'object' ||
    Object.keys(key).length !== 2 ||
    key.keytype !== 'ed25519' ||
    typeof key.public !== 'string' ||
    fromBase64(key.public).length !== 32
  )
    fail('WORKSHOP_KEY_INVALID')
  return { keytype: 'ed25519', public: key.public }
}

/** Signatures cover the canonical JSON of `signed`, prefixed by its metadata type to prevent cross-role reuse. */
export function signingPayload(signed: { type: string }) {
  return utf8(`arcadia-workshop:${signed.type}:` + canonicalJson(signed))
}

const verifierCache = new Map<string, Promise<CryptoKey>>()
function verifier(key: WorkshopPublicKey) {
  let cached = verifierCache.get(key.public)
  if (!cached) {
    cached = crypto.subtle.importKey('raw', fromBase64(key.public), { name: 'Ed25519' }, false, ['verify'])
    verifierCache.set(key.public, cached)
    if (verifierCache.size > 64) verifierCache.delete(verifierCache.keys().next().value!)
  }
  return cached
}

/** Count distinct role keys with a valid signature; unknown or duplicate signatures never contribute. */
export async function verifyThreshold(
  envelope: SignedEnvelope<{ type: string }>,
  keys: Record<string, WorkshopPublicKey>,
  role: WorkshopRole,
) {
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length > 32) fail('WORKSHOP_SIGNATURE_INVALID')
  const payload = signingPayload(envelope.signed)
  const accepted = new Set<string>()
  for (const signature of envelope.signatures) {
    if (
      !signature ||
      typeof signature !== 'object' ||
      !isKeyId(signature.keyid) ||
      typeof signature.sig !== 'string' ||
      signature.sig.length > 128
    )
      fail('WORKSHOP_SIGNATURE_INVALID')
    if (accepted.has(signature.keyid) || !role.keyids.includes(signature.keyid)) continue
    const key = keys[signature.keyid]
    if (!key) continue
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = fromBase64(signature.sig)
    } catch {
      continue
    }
    if (bytes.length !== 64) continue
    if (await crypto.subtle.verify('Ed25519', await verifier(key), bytes, payload)) accepted.add(signature.keyid)
  }
  if (accepted.size < role.threshold) fail('WORKSHOP_SIGNATURE_THRESHOLD', `Need ${role.threshold} valid signatures`)
}

export interface WorkshopSigningKey {
  keyid: string
  publicKey: WorkshopPublicKey
  privateKey: CryptoKey
}

/** Import a PKCS#8 Ed25519 private key, deriving its public key from the same material. */
export async function importSigningKey(pkcs8Base64: string): Promise<WorkshopSigningKey> {
  const pkcs8 = fromBase64(pkcs8Base64.trim())
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign'])
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  if (!jwk.x) fail('WORKSHOP_KEY_INVALID')
  const raw = fromBase64(
    jwk.x
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(jwk.x.length / 4) * 4, '='),
  )
  const publicKey: WorkshopPublicKey = { keytype: 'ed25519', public: toBase64(raw) }
  return { keyid: workshopKeyId(publicKey), publicKey, privateKey }
}

export async function generateSigningKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as unknown as {
    publicKey: CryptoKey
    privateKey: CryptoKey
  }
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const publicKey: WorkshopPublicKey = { keytype: 'ed25519', public: toBase64(raw) }
  const pkcs8 = toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)))
  return { keyid: workshopKeyId(publicKey), publicKey, pkcs8 }
}

export async function signEnvelope<T extends { type: string }>(
  signed: T,
  keys: WorkshopSigningKey[],
): Promise<SignedEnvelope<T>> {
  const payload = signingPayload(signed)
  const signatures = []
  for (const key of keys)
    signatures.push({
      keyid: key.keyid,
      sig: toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, payload))),
    })
  return { signed, signatures }
}
