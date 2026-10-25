import { Type } from '@sinclair/typebox'
import { targets, values, bindings, ops, scopedRuleValue } from './authoring/runtime'
import { defineRuleValue, defineRuleOperation } from './rule-values'

const empty = Type.Object({}, { additionalProperties: false })
// Pet stat reads deliberately expose only the actual public stat vocabulary.
const petAttribute = Type.Union((['maxHp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map(key => Type.Literal(key)))
const numeric = Type.Number()
const finite = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('Invalid computed numeric value')
  return value
}
const ownerPet = defineRuleValue({
  id: 'core.ownerPet',
  params: empty,
  inputs: {},
  needs: ['ownerPet'],
  missing: 'empty',
  output: 'selectorPet',
  build: () => targets.ownerPet,
})
const opponentActive = defineRuleValue({
  id: 'core.opponentActive',
  params: empty,
  inputs: {},
  needs: ['ownerPet'],
  missing: 'empty',
  output: 'selectorPet',
  build: () => targets.opponentActive,
})
const sourceMark = defineRuleValue({
  id: 'core.sourceMark',
  params: empty,
  inputs: {},
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'empty',
  output: 'selectorMark',
  build: () => targets.sourceMark,
})
const firstPet = defineRuleValue({
  id: 'core.firstPet',
  params: empty,
  inputs: { target: 'selectorPet' },
  needs: [],
  missing: 'skip',
  output: 'valuePet',
  build: ({ inputs }) => inputs.target.first(),
})
const firstMark = defineRuleValue({
  id: 'core.firstMark',
  params: empty,
  inputs: { target: 'selectorMark' },
  needs: [],
  missing: 'skip',
  output: 'valueMark',
  build: ({ inputs }) => inputs.target.first(),
})
const readPetAttribute = defineRuleValue({
  id: 'core.petAttribute',
  params: Type.Object({ attribute: petAttribute }, { additionalProperties: false }),
  inputs: { target: 'valuePet' },
  needs: [],
  missing: 'skip',
  output: 'number',
  build: ({ params, inputs }) => inputs.target.attribute(params.attribute),
})
const markStack = defineRuleValue({
  id: 'core.markStack',
  params: empty,
  inputs: { target: 'valueMark' },
  needs: [],
  missing: 'skip',
  output: 'number',
  build: ({ inputs }) => inputs.target.attribute('stack'),
})
const number = defineRuleValue({
  id: 'core.number',
  params: Type.Object({ value: numeric }, { additionalProperties: false }),
  inputs: {},
  needs: [],
  missing: 'skip',
  output: 'number',
  build: ({ params }) => scopedRuleValue(() => params.value),
})
const multiply = defineRuleValue({
  id: 'core.multiply',
  params: empty,
  inputs: { left: 'number', right: 'number' },
  needs: [],
  missing: 'skip',
  output: 'number',
  build: ({ inputs }) => values.combine(inputs.left, inputs.right, (a, b) => finite(a * b)),
})
const followPet = defineRuleValue({
  id: 'core.followPet',
  params: empty,
  inputs: { target: 'valuePet' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'follow',
  output: 'boundPet',
  build: ({ key, inputs }) => inputs.target.follow({ key }),
})
const capturePet = defineRuleValue({
  id: 'core.capturePet',
  params: empty,
  inputs: { target: 'valuePet' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'capture-binding',
  output: 'boundPet',
  build: ({ key, inputs }) => inputs.target.capture({ key, scope: 'binding' }),
})
const followMark = defineRuleValue({
  id: 'core.followMark',
  params: empty,
  inputs: { target: 'valueMark' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'follow',
  output: 'boundMark',
  build: ({ key, inputs }) => inputs.target.follow({ key }),
})
const captureMark = defineRuleValue({
  id: 'core.captureMark',
  params: empty,
  inputs: { target: 'valueMark' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'capture-binding',
  output: 'boundMark',
  build: ({ key, inputs }) => inputs.target.capture({ key, scope: 'binding' }),
})
const followNumber = defineRuleValue({
  id: 'core.followNumber',
  params: empty,
  inputs: { value: 'number' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'follow',
  output: 'boundNumber',
  build: ({ key, inputs }) => inputs.value.follow({ key }),
})
const captureNumber = defineRuleValue({
  id: 'core.captureNumber',
  params: empty,
  inputs: { value: 'number' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'capture-binding',
  output: 'boundNumber',
  build: ({ key, inputs }) => inputs.value.capture({ key, scope: 'binding' }),
})
const temporal = {
  mode: Type.Union([Type.Literal('follow'), Type.Literal('capture')]),
  scope: Type.Optional(Type.Union([Type.Literal('input'), Type.Literal('binding')])),
}
function validateTemporal(params: { mode: 'follow' | 'capture'; scope?: 'input' | 'binding' }): void {
  if (
    (params.mode === 'follow' && params.scope !== undefined) ||
    (params.mode === 'capture' && params.scope === undefined)
  )
    throw new Error('Capture needs an explicit scope; follow must not specify a capture scope')
}
const boundPetAttribute = defineRuleValue({
  id: 'core.boundPetAttribute',
  params: Type.Object({ attribute: petAttribute, ...temporal }, { additionalProperties: false }),
  inputs: { target: 'boundPet' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'attribute-step',
  output: 'boundNumber',
  build: ({ key, params, inputs }) => {
    validateTemporal(params)
    const step = inputs.target.attribute(params.attribute)
    return params.mode === 'follow' ? step.follow({ key }) : step.capture({ key, scope: params.scope! })
  },
})
const boundMarkStack = defineRuleValue({
  id: 'core.boundMarkStack',
  params: Type.Object(temporal, { additionalProperties: false }),
  inputs: { target: 'boundMark' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'attribute-step',
  output: 'boundNumber',
  build: ({ key, params, inputs }) => {
    validateTemporal(params)
    const step = inputs.target.attribute('stack')
    return params.mode === 'follow' ? step.follow({ key }) : step.capture({ key, scope: params.scope! })
  },
})
const multiplyBinding = defineRuleValue({
  id: 'core.multiplyBinding',
  params: empty,
  inputs: { left: 'boundNumber', right: 'boundNumber' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  temporal: 'combine',
  output: 'boundNumber',
  build: ({ inputs }) => bindings.combine(inputs.left, inputs.right, (a, b) => finite(a * b)),
})
const damage = defineRuleOperation({
  id: 'core.dealDamage',
  params: empty,
  inputs: { target: 'selectorPet', amount: 'number' },
  inputSchemas: { amount: Type.Number({ minimum: 0 }) },
  needs: [],
  missing: 'skip',
  build: ({ inputs }) => inputs.target.apply(ops.dealDamage(inputs.amount)),
})
const bindAttribute = defineRuleOperation({
  id: 'core.bindAttribute',
  params: Type.Object(
    {
      attribute: petAttribute,
      operation: Type.Union([Type.Literal('delta'), Type.Literal('percent'), Type.Literal('override')]),
      lifetime: Type.Literal('sourceMark'),
      missing: Type.Literal('detach'),
      stacking: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('append')])),
    },
    { additionalProperties: false },
  ),
  inputs: { target: 'selectorPet', value: 'boundNumber' },
  needs: [],
  sourceKinds: ['petMark'],
  missing: 'detach',
  build: ({ key, inputs, params }) => inputs.target.apply(ops.bindAttribute({ key, ...params, value: inputs.value })),
})

export const coreRuleValues = Object.freeze([
  ownerPet,
  opponentActive,
  sourceMark,
  firstPet,
  firstMark,
  readPetAttribute,
  markStack,
  number,
  multiply,
  followPet,
  capturePet,
  followMark,
  captureMark,
  followNumber,
  captureNumber,
  boundPetAttribute,
  boundMarkStack,
  multiplyBinding,
])
export const coreRuleOperations = Object.freeze([damage, bindAttribute])
