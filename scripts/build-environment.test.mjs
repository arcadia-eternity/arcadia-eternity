import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import { identifyEnvironmentArtifact } from './build-battle-environment.mjs'
import { identifyBaseEnvironmentArtifact } from './build-base-environment.mjs'

/** Compile a real registered capability; the identifier stays fixed while semantics change. */
async function capabilityArtifact({ amountMaximum = 100, multiplier = 1 } = {}) {
  const registry = fileURLToPath(new URL('../packages/battle/src/v4/content/capabilities.ts', import.meta.url))
  const core = fileURLToPath(new URL('../packages/battle/src/v4/content/core-capabilities.ts', import.meta.url))
  const entry = '\0trusted-capability-identity-test'
  const bundle = await rolldown({
    input: entry,
    platform: 'browser',
    plugins: [
      {
        name: 'trusted-capability-fixture',
        resolveId: id => (id === entry ? entry : undefined),
        load: id =>
          id === entry
            ? `import { CapabilityRegistry, defineAction } from ${JSON.stringify(registry)};
               import { coreCapabilities } from ${JSON.stringify(core)};
               const original = coreCapabilities.actions[0];
               const params = { ...original.params, properties: {
                 amount: { ...original.params.properties.amount, maximum: ${amountMaximum} }
               } };
               export const registry = new CapabilityRegistry([defineAction({
                 id: 'host.controlled-heal', needs: ['ownerPet'], params,
                 execute(context, args) { context.ops.heal(context.ownerPet, args.amount * ${multiplier}); }
               })]);`
            : undefined,
      },
    ],
  })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: false })
    assert.equal(output.length, 1)
    assert.equal(output[0].type, 'chunk')
    return output[0].code
  } finally {
    await bundle.close()
  }
}

test('trusted identity tracks registered capability implementations and parameter contracts with a stable ID', async () => {
  const original = await capabilityArtifact()
  const repeated = await capabilityArtifact()
  const changedImplementation = await capabilityArtifact({ multiplier: 2 })
  const changedContract = await capabilityArtifact({ amountMaximum: 99 })
  assert.equal(original, repeated)
  const originalIdentity = identifyEnvironmentArtifact(original)
  assert.deepEqual(identifyEnvironmentArtifact(repeated), originalIdentity)
  for (const changed of [changedImplementation, changedContract]) {
    const identity = identifyEnvironmentArtifact(changed)
    assert.notEqual(identity.coreBuildId, originalIdentity.coreBuildId)
    assert.notEqual(identity.registryBuildId, originalIdentity.registryBuildId)
  }
  const installedIdentity = identifyBaseEnvironmentArtifact(original, originalIdentity)
  assert.notEqual(
    identifyBaseEnvironmentArtifact(changedImplementation, originalIdentity).registryBuildId,
    installedIdentity.registryBuildId,
  )
  assert.notEqual(
    identifyBaseEnvironmentArtifact(changedContract, originalIdentity).registryBuildId,
    installedIdentity.registryBuildId,
  )
})
