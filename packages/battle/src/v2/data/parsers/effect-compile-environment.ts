import { battleExtractorRegistry } from '../../systems/extractor-registry.js'
import { BaseMarkSchema } from '../../schemas/mark.schema.js'
import { BaseSkillSchema } from '../../schemas/skill.schema.js'
import {
  createPathObjectState,
  createScalarValueState,
  type EffectCompileFieldSeed,
  type EffectCompileTypingEnvironment,
} from './effect-compile-validator.js'

const effectDefFieldSeeds: EffectCompileFieldSeed[] = [
  { owner: 'effectDef', path: 'id', valueType: createScalarValueState('string') },
  { owner: 'effectDef', path: 'triggers', valueType: createPathObjectState('effectDef', 'triggers') },
  { owner: 'effectDef', path: 'priority', valueType: createScalarValueState('number') },
  { owner: 'effectDef', path: 'condition', valueType: createPathObjectState('effectDef', 'condition') },
  { owner: 'effectDef', path: 'apply', valueType: createPathObjectState('effectDef', 'apply') },
  { owner: 'effectDef', path: 'consumesStacks', valueType: createScalarValueState('number') },
  { owner: 'effectDef', path: 'tags', valueType: createPathObjectState('effectDef', 'tags') },
]

const effectContextFieldSeeds: EffectCompileFieldSeed[] = [
  { owner: 'effectContext', path: 'trigger', valueType: createScalarValueState('string') },
  { owner: 'effectContext', path: 'sourceEntityId', valueType: createScalarValueState('string') },
  { owner: 'effectContext', path: 'triggerSourceEntityId', valueType: createScalarValueState('string') },
  { owner: 'effectContext', path: 'effectEntityId', valueType: createScalarValueState('string') },
  { owner: 'effectContext', path: 'effectId', valueType: createScalarValueState('string') },
  { owner: 'effectContext', path: 'available', valueType: createScalarValueState('boolean') },
  { owner: 'effectContext', path: 'effect', valueType: createPathObjectState('effectContext', 'effect') },
  { owner: 'effectContext', path: 'context', valueType: createPathObjectState('effectContext', 'context') },
  { owner: 'effectContext', path: 'useSkillContext', valueType: createPathObjectState('effectContext', 'useSkillContext') },
  { owner: 'effectContext', path: 'damageContext', valueType: createPathObjectState('effectContext', 'damageContext') },
  { owner: 'effectContext', path: 'healContext', valueType: createPathObjectState('effectContext', 'healContext') },
  { owner: 'effectContext', path: 'rageContext', valueType: createPathObjectState('effectContext', 'rageContext') },
  { owner: 'effectContext', path: 'addMarkContext', valueType: createPathObjectState('effectContext', 'addMarkContext') },
  { owner: 'effectContext', path: 'switchPetContext', valueType: createPathObjectState('effectContext', 'switchPetContext') },
  { owner: 'effectContext', path: 'turnContext', valueType: createPathObjectState('effectContext', 'turnContext') },
  { owner: 'effectContext', path: 'stackContext', valueType: createPathObjectState('effectContext', 'stackContext') },
  { owner: 'effectContext', path: 'consumeStackContext', valueType: createPathObjectState('effectContext', 'consumeStackContext') },
  { owner: 'effectContext', path: 'transformContext', valueType: createPathObjectState('effectContext', 'transformContext') },
  { owner: 'effectContext', path: 'removeMarkContext', valueType: createPathObjectState('effectContext', 'removeMarkContext') },
]

const nestedEffectFieldSeeds: EffectCompileFieldSeed[] = effectDefFieldSeeds.map(seed => {
  const nestedPath = `effect.${seed.path}`
  if (seed.valueType.kind === 'object') {
    return {
      owner: 'effectContext',
      path: nestedPath,
      valueType: createPathObjectState('effectContext', nestedPath),
    }
  }
  return {
    owner: 'effectContext',
    path: nestedPath,
    valueType: seed.valueType,
  }
})

export function createSeer2EffectCompileTypingEnvironment(): EffectCompileTypingEnvironment {
  return {
    extractorRegistry: battleExtractorRegistry,
    schemaOwners: [
      { owner: 'baseMark', schema: BaseMarkSchema },
      { owner: 'baseSkill', schema: BaseSkillSchema },
    ],
    fieldSeeds: [...effectDefFieldSeeds, ...effectContextFieldSeeds, ...nestedEffectFieldSeeds],
    relationSeeds: [
      {
        owner: 'effectContext',
        key: 'effect',
        target: 'effectDef',
        cardinality: 'one',
      },
    ],
  }
}

export const seer2EffectCompileTypingEnvironment = createSeer2EffectCompileTypingEnvironment()
