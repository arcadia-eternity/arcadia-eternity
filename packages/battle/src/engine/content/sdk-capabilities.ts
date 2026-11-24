export const phaseOperations = [
  'dealDamage',
  'heal',
  'changeRage',
  'addMark',
  'removeMark',
  'transferMarks',
  'consumeMarkStacks',
] as const

/** Callable top-level capabilities shared by the injected SDK types and Arena. */
export const effectSdkFunctions = [
  ...phaseOperations,
  'compileEffect',
  'defineEffect',
  'defineEffects',
  'numberParam',
  'booleanParam',
  'stringParam',
  'selectFrom',
  'effectParameters',
  'hasAuthoredParameters',
  'defineCodeEffect',
  'codeEffectDefinition',
  'defineNativeEffect',
  'defineParameter',
  'parameterAddress',
  'defineNativeBehavior',
  'normalizeBehaviorDefinitions',
  'CreateStatStageMark',
  'defineEffectState',
  'getEffectState',
  'setEffectState',
] as const
