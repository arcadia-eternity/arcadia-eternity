import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const legacy = Type.Object({ kind: Type.Literal('legacy-v2') }, { additionalProperties: false })
const native = Type.Object(
  {
    kind: Type.Literal('native-v4'),
    build: Type.Object(
      {
        formatVersion: Type.Literal(1),
        coreBuildId: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        registryBuildId: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      },
      { additionalProperties: false },
    ),
    contentRevision: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)
const identity = Type.Union([legacy, native])
const request = Type.Union([
  legacy,
  Type.Object({ kind: Type.Literal('native-v4'), expected: Type.Optional(native) }, { additionalProperties: false }),
])
const descriptor = Type.Union([
  Type.Object({ runtime: legacy }, { additionalProperties: false }),
  Type.Object(
    {
      runtime: native,
      initial: Type.Object(
        { format: Type.Literal('arcadia.battle.native.v4'), version: Type.Literal(3), payload: Type.String() },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
])
const initialPayload = Type.Object(
  {
    battle: Type.Object({ boundary: Type.Literal('initial') }, { additionalProperties: true }),
    reconnect: Type.Array(Type.Unknown(), { maxItems: 0 }),
    teamSelection: Type.Null(),
  },
  { additionalProperties: false },
)

export type BattleRuntimeIdentity = Static<typeof identity>
export type NativeRuntimeIdentity = Static<typeof native>
export type BattleRuntimeDescriptor = Static<typeof descriptor>
export type BattleRuntimeRequest = Static<typeof request>

export function readRuntimeRequest(input: unknown): BattleRuntimeRequest {
  if (!Value.Check(request, input)) throw new Error('Invalid battle runtime request')
  return structuredClone(input) as BattleRuntimeRequest
}

export function readRuntimeIdentity(input: unknown): BattleRuntimeIdentity {
  if (!Value.Check(identity, input)) throw new Error('Invalid battle runtime identity')
  return structuredClone(input) as BattleRuntimeIdentity
}

/** Untagged historical records belong to V2; a damaged native record must never acquire that default. */
export function readRuntimeDescriptor(input: { runtime?: unknown; initial?: unknown }): BattleRuntimeDescriptor {
  if (input.runtime === undefined && input.initial === undefined) return { runtime: { kind: 'legacy-v2' } }
  const state = { runtime: input.runtime, ...(input.initial === undefined ? {} : { initial: input.initial }) }
  if (!Value.Check(descriptor, state)) throw new Error('Invalid battle runtime bootstrap descriptor')
  const result = structuredClone(state) as BattleRuntimeDescriptor
  if ('initial' in result) {
    let payload: unknown
    try {
      payload = JSON.parse(result.initial.payload)
    } catch {
      throw new Error('Invalid native initial snapshot payload')
    }
    if (!Value.Check(initialPayload, payload))
      throw new Error('Native bootstrap requires an initial snapshot with no reconnect windows')
  }
  return result
}
